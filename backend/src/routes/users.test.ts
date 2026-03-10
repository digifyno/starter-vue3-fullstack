import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { userRoutes } from './users.js';

vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] } as any),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn().mockImplementation(async (request: any) => {
    request.userId = 'user-1';
    request.userEmail = 'user@example.com';
  }),
  signToken: vi.fn().mockReturnValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
}));

describe('User Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(userRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  // ── GET /api/users/me ───────────────────────────────────────────────────

  describe('GET /api/users/me', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({ method: 'GET', url: '/api/users/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when user is not found', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns user data for authenticated user', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
        settings: { theme: 'light' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.email).toBe('user@example.com');
      expect(body.name).toBe('Test User');
      expect(body.email_verified).toBe(true);
    });

    it('does not expose sensitive fields', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
        settings: {},
        password_hash: 'secret',
        last_login_at: '2024-01-01',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: { Authorization: 'Bearer mock-token' },
      });
      const body = JSON.parse(res.body);
      expect(body.password_hash).toBeUndefined();
    });
  });

  // ── PUT /api/users/me ───────────────────────────────────────────────────

  describe('PUT /api/users/me', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me',
        payload: { name: 'New Name' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('updates name and returns success message', async () => {
      const { query } = await import('../database.js');

      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { name: 'New Name' },
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        expect.arrayContaining(['New Name', 'user-1']),
      );
    });

    it('updates avatar_url', async () => {
      const { query } = await import('../database.js');

      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { avatar_url: 'https://example.com/avatar.png' },
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        expect.arrayContaining(['https://example.com/avatar.png', 'user-1']),
      );
    });

    it('returns no changes message when body is empty', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me',
        headers: { Authorization: 'Bearer mock-token' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toBe('No changes');
    });
  });

  // ── PUT /api/users/me/settings ──────────────────────────────────────────

  describe('PUT /api/users/me/settings', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me/settings',
        payload: { settings: { theme: 'dark' } },
      });
      expect(res.statusCode).toBe(401);
    });

    it('updates settings and returns success message', async () => {
      const { query } = await import('../database.js');

      const res = await app.inject({
        method: 'PUT',
        url: '/api/users/me/settings',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { settings: { theme: 'dark', notifications: true } },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toBe('Settings updated');
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET settings'),
        expect.arrayContaining(['user-1']),
      );
    });

    it('stores serialized settings JSON', async () => {
      const { query } = await import('../database.js');
      const settings = { theme: 'dark', language: 'en' };

      await app.inject({
        method: 'PUT',
        url: '/api/users/me/settings',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { settings },
      });

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.any(String),
        [JSON.stringify(settings), 'user-1'],
      );
    });
  });
});
