import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available when vi.mock factories run (which are hoisted above imports)
const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
  const clientRelease = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: clientRelease });
  return { clientQuery, clientRelease, connect };
});

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn().mockImplementation(function() { return { connect: mocks.connect, on: vi.fn() }; }),
  },
}));

vi.mock('./config.js', () => ({
  config: { databaseUrl: 'postgresql://test:test@localhost:5432/test' },
}));

vi.mock('./logger.js', () => ({
  logger: { error: vi.fn() },
}));

const { queryWithContext } = await import('./database.js');

describe('queryWithContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery.mockResolvedValue({ rows: [] });
  });

  describe('UUID validation', () => {
    it('throws for invalid userId format', async () => {
      await expect(
        queryWithContext('SELECT 1', [], { userId: 'not-a-uuid' }),
      ).rejects.toThrow(/invalid userId/i);
    });

    it('throws for invalid orgId format', async () => {
      await expect(
        queryWithContext('SELECT 1', [], { orgId: 'invalid' }),
      ).rejects.toThrow(/invalid orgId/i);
    });

    it('throws for SQL-injection attempt in userId', async () => {
      await expect(
        queryWithContext('SELECT 1', [], { userId: "'; DROP TABLE users; --" }),
      ).rejects.toThrow(/invalid userId/i);
    });

    it('accepts valid UUID for userId', async () => {
      await expect(
        queryWithContext('SELECT 1', [], { userId: '550e8400-e29b-41d4-a716-446655440000' }),
      ).resolves.toBeDefined();
    });

    it('accepts valid UUID for orgId', async () => {
      await expect(
        queryWithContext('SELECT 1', [], { orgId: 'b0000000-0000-0000-0000-000000000001' }),
      ).resolves.toBeDefined();
    });
  });

  describe('RLS context injection', () => {
    it('sets app.current_user_id when userId is provided', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      await queryWithContext('SELECT 1', [], { userId });

      const setLocalCall = mocks.clientQuery.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('app.current_user_id'),
      );
      expect(setLocalCall).toBeDefined();
      expect(setLocalCall![0]).toContain(userId);
    });

    it('sets app.current_org_id when orgId is provided', async () => {
      const orgId = 'b0000000-0000-0000-0000-000000000001';
      await queryWithContext('SELECT 1', [], { orgId });

      const setLocalCall = mocks.clientQuery.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('app.current_org_id'),
      );
      expect(setLocalCall).toBeDefined();
      expect(setLocalCall![0]).toContain(orgId);
    });

    it('does not set user_id variable when userId is omitted', async () => {
      await queryWithContext('SELECT 1', [], { orgId: 'b0000000-0000-0000-0000-000000000001' });

      const userIdCall = mocks.clientQuery.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('app.current_user_id'),
      );
      expect(userIdCall).toBeUndefined();
    });

    it('runs the main query after setting context', async () => {
      const sql = 'SELECT id FROM organizations WHERE id = $1';
      const params = ['b0000000-0000-0000-0000-000000000001'];
      await queryWithContext(sql, params, { userId: '550e8400-e29b-41d4-a716-446655440000' });

      const mainCall = mocks.clientQuery.mock.calls.find(
        (call: unknown[]) => call[0] === sql,
      );
      expect(mainCall).toBeDefined();
      expect(mainCall![1]).toEqual(params);
    });

    it('returns the query result', async () => {
      const expected = { rows: [{ id: 'org-1' }], rowCount: 1 };
      mocks.clientQuery.mockImplementation((sql: string) => {
        if (sql.startsWith('SET')) return Promise.resolve({ rows: [] });
        return Promise.resolve(expected);
      });

      const result = await queryWithContext('SELECT id FROM organizations', [], {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.rows).toEqual([{ id: 'org-1' }]);
    });
  });

  describe('resource cleanup', () => {
    it('releases client on success', async () => {
      await queryWithContext('SELECT 1', [], { userId: '550e8400-e29b-41d4-a716-446655440000' });
      expect(mocks.clientRelease).toHaveBeenCalledOnce();
    });

    it('releases client even when query throws', async () => {
      mocks.clientQuery.mockImplementation((sql: string) => {
        if (sql.startsWith('SET')) return Promise.resolve({ rows: [] });
        return Promise.reject(new Error('DB error'));
      });

      await expect(
        queryWithContext('SELECT 1', [], { userId: '550e8400-e29b-41d4-a716-446655440000' }),
      ).rejects.toThrow('DB error');
      expect(mocks.clientRelease).toHaveBeenCalledOnce();
    });
  });

  describe('empty context', () => {
    it('works with empty context object', async () => {
      await expect(queryWithContext('SELECT 1', [], {})).resolves.toBeDefined();
    });
  });
});
