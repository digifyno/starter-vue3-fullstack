import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './auth.js';

// Mock database — no real PG connection needed
vi.mock('../database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] } as any);
  const queryOne = vi.fn().mockResolvedValue(null);
  // withTransaction delegates to the mocked query so assertions on query still work
  const withTransaction = vi.fn().mockImplementation(async (fn: (client: { query: typeof query }) => Promise<unknown>) => {
    return fn({ query });
  });
  return { query, queryOne, withTransaction };
});

// Mock email hub — no real emails sent
vi.mock('../services/email.js', () => ({
  sendPin: vi.fn().mockResolvedValue(undefined),
  sendWelcome: vi.fn().mockResolvedValue(undefined),
}));

// Mock PIN service — control behaviour per test
vi.mock('../services/pin.js', () => ({
  generatePin: vi.fn().mockReturnValue('123456'),
  createPin: vi.fn().mockResolvedValue('123456'),
  verifyPin: vi.fn().mockResolvedValue(false),
}));

// Mock JWT signing + auth middleware
vi.mock('../middleware/auth.js', () => ({
  signToken: vi.fn().mockReturnValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
  requireAuth: vi.fn().mockImplementation(async (request: any, reply: any) => {
    const auth = request.headers?.authorization;
    if (!auth?.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Authentication required' });
      return;
    }
    request.userId = 'user-1';
    request.userEmail = 'user@example.com';
  }),
}));

// Provide minimal config
vi.mock('../config.js', () => ({
  config: {
    disableDevLogin: false,
    nodeEnv: 'test',
    port: 4001,
    host: '127.0.0.1',
    jwtSecret: 'test-secret',
  },
}));

describe('Auth Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    // authRoutes defines full paths like /api/auth/login — register without prefix
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => vi.clearAllMocks());

  // ── POST /api/auth/login ──────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 400 when email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for an invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'bad' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid email');
    });

    it('returns 200 without revealing account existence', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'notfound@example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toContain('If an account exists');
    });

    it('sends a PIN and returns 200 when user exists', async () => {
      const { queryOne } = await import('../database.js');
      const { sendPin } = await import('../services/email.js');

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(sendPin)).toHaveBeenCalledWith('user@example.com', '123456');
    });

    it('lowercases the email before lookup', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });

      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'User@Example.COM' },
      });

      expect(vi.mocked(queryOne)).toHaveBeenCalledWith(
        expect.any(String),
        ['user@example.com'],
      );
    });
  });

  // ── POST /api/auth/register ───────────────────────────────────────────────

  describe('POST /api/auth/register', () => {
    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'new@example.com' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name: 'Alice' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for an invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'not-an-email', name: 'Alice' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid email');
    });

    it('returns 409 when user already exists', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'existing-user',
        email: 'existing@example.com',
        name: 'Existing',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'existing@example.com', name: 'Existing' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('creates user and sends PIN when email is new', async () => {
      const { queryOne, query } = await import('../database.js');
      const { sendPin } = await import('../services/email.js');

      vi.mocked(queryOne).mockResolvedValueOnce(null); // no existing user

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'new@example.com', name: 'Alice' },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining(['new@example.com', 'Alice']),
      );
      expect(vi.mocked(sendPin)).toHaveBeenCalledWith('new@example.com', '123456');
    });

    it('returns 503 when email hub is unreachable without creating a user row', async () => {
      const { queryOne, withTransaction } = await import('../database.js');
      const { sendPin } = await import('../services/email.js');

      vi.mocked(queryOne).mockResolvedValueOnce(null); // no existing user
      vi.mocked(sendPin).mockRejectedValueOnce(new Error('Hub API error 503: service unavailable'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'new@example.com', name: 'Alice' },
      });

      // Email fails before DB write → 503, no user created
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toMatch(/email service unavailable/i);
      // withTransaction must NOT have been called — no DB writes
      expect(vi.mocked(withTransaction)).not.toHaveBeenCalled();
    });

    it('allows re-registration after email failure (no 409 conflict)', async () => {
      const { queryOne } = await import('../database.js');
      const { sendPin } = await import('../services/email.js');

      // First attempt: email fails before DB write → no user row created
      vi.mocked(queryOne).mockResolvedValueOnce(null);
      vi.mocked(sendPin).mockRejectedValueOnce(new Error('Hub unreachable'));
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'retry@example.com', name: 'Alice' },
      });
      expect(res1.statusCode).toBe(503);

      // Second attempt: no user in DB (never written), email now succeeds
      vi.mocked(queryOne).mockResolvedValueOnce(null); // still no user
      vi.mocked(sendPin).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'retry@example.com', name: 'Alice' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── POST /api/auth/verify-pin ─────────────────────────────────────────────

  describe('POST /api/auth/verify-pin', () => {
    it('returns 400 when pin is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { pin: '123456' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for non-digit PIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: 'abc' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('PIN must be 6 digits');
    });

    it('returns 400 for PIN with wrong length (7 digits)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: '1234567' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('PIN must be 6 digits');
    });

    it('returns 400 for an invalid email format in verify-pin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'notanemail', pin: '123456' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid email');
    });

    it('returns 401 for an invalid or expired PIN', async () => {
      const { verifyPin } = await import('../services/pin.js');
      vi.mocked(verifyPin).mockResolvedValueOnce(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: '000000' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toContain('Invalid');
    });

    it('rejects an expired PIN (verifyPin returns false for expired records)', async () => {
      const { verifyPin } = await import('../services/pin.js');
      vi.mocked(verifyPin).mockResolvedValueOnce(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: '123456' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toContain('expired');
    });

    it('returns a JWT and user info on valid PIN', async () => {
      const { verifyPin } = await import('../services/pin.js');
      const { queryOne, query } = await import('../database.js');

      vi.mocked(verifyPin).mockResolvedValueOnce(true);
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
      });
      // orgs query (parallel) + last_login_at fire-and-forget
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: '123456' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBe('mock-jwt-token');
      expect(body.user.email).toBe('user@example.com');
      expect(Array.isArray(body.organizations)).toBe(true);
    });
  });

    it('returns 401 (not 404) for valid PIN format with non-existent email', async () => {
      const { verifyPin } = await import('../services/pin.js');
      const { queryOne } = await import('../database.js');

      vi.mocked(verifyPin).mockResolvedValueOnce(true);
      vi.mocked(queryOne).mockResolvedValueOnce(null); // no user row

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'ghost@example.com', pin: '654321' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('Invalid or expired PIN');
    });

  // ── POST /api/auth/refresh ────────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('returns 401 without a token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns a new JWT with a valid token', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).token).toBe('mock-jwt-token');
    });

    it('returns 401 when user is not found', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── Rate Limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    let rateLimitApp: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      rateLimitApp = Fastify({ logger: false });
      await rateLimitApp.register(rateLimit, { global: false });
      await rateLimitApp.register(authRoutes);
      await rateLimitApp.ready();
    });

    afterAll(() => rateLimitApp.close());

    it('returns 429 after exhausting verify-pin rate limit from same IP+email', async () => {
      const { verifyPin } = await import('../services/pin.js');
      // verifyPin is already mocked to return false; exhaust the 10-request limit
      for (let i = 0; i < 10; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/verify-pin',
          payload: { email: 'ratelimit@example.com', pin: '000000' },
        });
      }

      const res = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'ratelimit@example.com', pin: '000000' },
      });

      expect(res.statusCode).toBe(429);
      // Suppress unused var warning
      void verifyPin;
    });

    it('returns 429 after exhausting login rate limit from same IP', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValue(null);

      // Exhaust the 5-request login limit
      for (let i = 0; i < 5; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: `ratelimit${i}@example.com` },
        });
      }

      const res = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ratelimit-final@example.com' },
      });

      expect(res.statusCode).toBe(429);
    });

    it('returns 429 after exhausting refresh rate limit from same IP', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
      } as any);

      // Exhaust the 10-request refresh limit
      for (let i = 0; i < 10; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/refresh',
          headers: { authorization: 'Bearer valid-token' },
        });
      }

      const res = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(429);
    });
  });

});