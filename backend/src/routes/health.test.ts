import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './health.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });

vi.mock('../database.js', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
  query: vi.fn().mockResolvedValue({ rows: [] } as any),
  queryOne: vi.fn().mockResolvedValue(null),
}));

describe('Health Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(healthRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/health', () => {
    it('returns 200 with status ok when database is reachable', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const res = await app.inject({ method: 'GET', url: '/api/health' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.database).toBe(true);
      expect(typeof body.timestamp).toBe('string');
    });

    it('returns 200 with status degraded when database is unreachable', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await app.inject({ method: 'GET', url: '/api/health' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('degraded');
      expect(body.database).toBe(false);
      expect(typeof body.timestamp).toBe('string');
    });

    it('includes a valid ISO timestamp in the response', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const before = Date.now();
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      const after = Date.now();

      const body = JSON.parse(res.body);
      const ts = new Date(body.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
