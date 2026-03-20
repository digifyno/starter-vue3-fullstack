import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './user-service.js';
import { SETTINGS } from '../constants.js';

vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  buildUpdateClause: (fields: Record<string, unknown>, startIndex = 1) => {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = startIndex;
    for (const [col, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      setClauses.push(`${col} = $${idx++}`);
      values.push(val);
    }
    return { setClauses, values };
  },
}));

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService();
  });

  describe('getUser', () => {
    it('returns null when user does not exist', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await service.getUser('nonexistent-id');
      expect(result).toBeNull();
    });

    it('returns the user when found', async () => {
      const { queryOne } = await import('../database.js');
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      vi.mocked(queryOne).mockResolvedValueOnce(mockUser as any);

      const result = await service.getUser('user-123');
      expect(result).toEqual(mockUser);
      expect(vi.mocked(queryOne)).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['user-123'],
      );
    });
  });

  describe('updateUser', () => {
    it('rejects an empty name string', async () => {
      const result = await service.updateUser('user-123', { name: '' });
      expect(result).toEqual({ error: 'Name cannot be empty', status: 400 });
    });

    it('rejects a whitespace-only name', async () => {
      const result = await service.updateUser('user-123', { name: '   ' });
      expect(result).toEqual({ error: 'Name cannot be empty', status: 400 });
    });

    it('rejects avatar_url without http/https scheme', async () => {
      const result = await service.updateUser('user-123', { avatar_url: 'ftp://example.com/img.png' });
      expect(result).toEqual({ error: 'avatar_url must use http or https scheme', status: 400 });
    });

    it('rejects javascript: scheme in avatar_url', async () => {
      const result = await service.updateUser('user-123', { avatar_url: 'javascript:alert(1)' });
      expect(result).toEqual({ error: 'avatar_url must use http or https scheme', status: 400 });
    });

    it('returns no-changes when no fields are provided', async () => {
      const result = await service.updateUser('user-123', {});
      expect(result).toEqual({ message: 'No changes' });
    });

    it('updates name successfully', async () => {
      const { query } = await import('../database.js');
      const result = await service.updateUser('user-123', { name: 'New Name' });
      expect(result).toEqual({ message: 'Profile updated' });
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        expect.arrayContaining(['New Name', 'user-123']),
      );
    });

    it('updates avatar_url with valid https URL successfully', async () => {
      const { query } = await import('../database.js');
      const result = await service.updateUser('user-123', { avatar_url: 'https://cdn.example.com/avatar.png' });
      expect(result).toEqual({ message: 'Profile updated' });
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        expect.arrayContaining(['https://cdn.example.com/avatar.png', 'user-123']),
      );
    });
  });

  describe('updateUserSettings', () => {
    it('rejects settings payload exceeding MAX_SIZE_BYTES', async () => {
      // Build a settings object that exceeds the limit
      const largeSettings = { data: 'x'.repeat(SETTINGS.MAX_SIZE_BYTES + 100) };
      const result = await service.updateUserSettings('user-123', largeSettings);
      expect(result).toEqual({ error: 'Settings payload too large', status: 400 });
    });

    it('accepts settings at exactly MAX_SIZE_BYTES - 1', async () => {
      // Build a settings object just under the limit
      const json = `{"data":"${'x'.repeat(SETTINGS.MAX_SIZE_BYTES - 12)}"}`;
      expect(json.length).toBeLessThan(SETTINGS.MAX_SIZE_BYTES);
      const small = JSON.parse(json);
      const result = await service.updateUserSettings('user-123', small);
      expect(result).toEqual({ message: 'Settings updated' });
    });

    it('updates settings in the database', async () => {
      const { query } = await import('../database.js');
      const settings = { theme: 'dark', notifications: true };
      const result = await service.updateUserSettings('user-123', settings);
      expect(result).toEqual({ message: 'Settings updated' });
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        'UPDATE users SET settings = $1 WHERE id = $2',
        [JSON.stringify(settings), 'user-123'],
      );
    });
  });

  describe('deletePasskey', () => {
    it('returns true when passkey is deleted', async () => {
      const { query } = await import('../database.js');
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const result = await service.deletePasskey('cred-id', 'user-123');
      expect(result).toBe(true);
    });

    it('returns false when passkey does not belong to user or does not exist', async () => {
      const { query } = await import('../database.js');
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await service.deletePasskey('cred-id', 'user-123');
      expect(result).toBe(false);
    });

    it('scopes deletion to the requesting user', async () => {
      const { query } = await import('../database.js');
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      await service.deletePasskey('cred-id', 'user-123');
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('AND user_id = $2'),
        ['cred-id', 'user-123'],
      );
    });
  });
});
