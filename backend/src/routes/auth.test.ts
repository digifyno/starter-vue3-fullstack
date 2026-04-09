import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
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
  signToken: vi.fn().mockResolvedValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
  requireAuth: vi.fn().mockImplementation(async (request: any, reply: any) => {
    const cookieToken = request.cookies?.token;
    const auth = request.headers?.authorization;
    if (!cookieToken && !auth?.startsWith('Bearer ')) {
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
    jwtExpiresIn: '7d',
  },
}));

/** Build a test app with cookie + optional rate-limit support */
async function buildApp(withRateLimit = false) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  if (withRateLimit) {
    await app.register(rateLimit, { global: false, hook: 'preHandler' });
  }
  await app.register(authRoutes);
  await app.ready();
  return app;
}

describe('Auth Routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
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

    it('returns 503 when sendPin throws (email hub unavailable)', async () => {
      const { queryOne } = await import('../database.js');
      const { sendPin } = await import('../services/email.js');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'Test User' });
      vi.mocked(sendPin).mockRejectedValueOnce(new Error('Hub timeout'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'user@example.com' },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toMatch(/email service unavailable/i);
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

    it('sets httpOnly auth cookie and returns user info on valid PIN', async () => {
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
      // Token must NOT appear in response body
      expect(body.token).toBeUndefined();
      // User info is returned
      expect(body.user.email).toBe('user@example.com');
      expect(Array.isArray(body.organizations)).toBe(true);
      // Auth cookie must be set as httpOnly
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(cookieStr).toContain('token=mock-jwt-token');
      expect(cookieStr.toLowerCase()).toContain('httponly');
      expect(cookieStr.toLowerCase()).toContain('samesite=strict');
      expect(cookieStr.toLowerCase()).toContain('path=/');
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
  });

  // ── PIN invalidation on re-login ──────────────────────────────────────────

  describe('PIN invalidation on re-login', () => {
    it('old PIN is rejected and new PIN succeeds after a second login request', async () => {
      const { createPin, verifyPin } = await import('../services/pin.js');
      const { queryOne, query } = await import('../database.js');

      const userRow = { id: 'user-1', email: 'user@example.com', name: 'Test User' };

      // First login — PIN1 issued
      vi.mocked(queryOne).mockResolvedValueOnce(userRow);
      vi.mocked(createPin).mockResolvedValueOnce('111111');
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'user@example.com' },
      });
      expect(res1.statusCode).toBe(200);

      // Second login — PIN2 issued; createPin marks PIN1 as used before inserting PIN2
      vi.mocked(queryOne).mockResolvedValueOnce(userRow);
      vi.mocked(createPin).mockResolvedValueOnce('222222');
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'user@example.com' },
      });
      expect(res2.statusCode).toBe(200);

      // Old PIN1 is now invalid — verifyPin returns false (simulating the invalidated record)
      vi.mocked(verifyPin).mockResolvedValueOnce(false);
      const resOldPin = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: '111111' },
      });
      expect(resOldPin.statusCode).toBe(401);
      expect(JSON.parse(resOldPin.body).error).toMatch(/invalid|expired/i);

      // New PIN2 is still valid — verifyPin returns true
      vi.mocked(verifyPin).mockResolvedValueOnce(true);
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatar_url: null,
        email_verified: true,
      });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const resNewPin = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'user@example.com', pin: '222222' },
      });
      expect(resNewPin.statusCode).toBe(200);
    });
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

    it('rotates cookie and returns success with a valid bearer token', async () => {
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
      expect(JSON.parse(res.body).success).toBe(true);
      // New cookie must be set
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(cookieStr).toContain('token=mock-jwt-token');
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

    it('accepts cookie token and issues a new cookie', async () => {
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
        cookies: { token: 'valid-cookie-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(cookieStr).toContain('token=mock-jwt-token');
      expect(cookieStr.toLowerCase()).toContain('httponly');
    });

    it('returns 401 with neither cookie nor bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /api/auth/logout ─────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('clears the auth cookie and returns success', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
      // Cookie must be cleared (max-age=0 or expires in the past)
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      expect(cookieStr).toContain('token=');
      // clearCookie must expire the cookie (Max-Age=0 or Expires=epoch)
      expect(cookieStr.toLowerCase()).toMatch(/max-age=0|expires=thu, 01 jan 1970/i);
    });

    it('subsequent request to protected endpoint after cookie is cleared returns 401', async () => {
      // clearCookie instructs the browser to delete the cookie; next requests arrive without it.
      // Simulate by sending an empty token cookie (the cleared value before browser fully discards it).
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { token: '' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Rate Limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    let rateLimitApp: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
      rateLimitApp = await buildApp(true);
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
    it('verify-pin rate limit is isolated per email: exhausting one email does not block another', async () => {
      // The keyGenerator uses `${ip}:${email}` — different emails from the same IP
      // must have independent quotas (cross-account brute-force isolation).

      // Exhaust the 10-request limit for cross-a@example.com
      for (let i = 0; i < 10; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/verify-pin',
          payload: { email: 'cross-a@example.com', pin: '000000' },
        });
      }

      // cross-a is now rate limited
      const resA = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'cross-a@example.com', pin: '000000' },
      });
      expect(resA.statusCode).toBe(429);

      // cross-b from the same IP has a separate bucket — must NOT be rate limited
      const resB = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        payload: { email: 'cross-b@example.com', pin: '000000' },
      });
      // 401 (invalid PIN), not 429 — confirms independent per-email quotas
      expect(resB.statusCode).toBe(401);
    });



    it('verify-pin rate limit uses compound IP:email key — different IPs for same email get independent buckets', async () => {
      // Exhaust the 10-request limit for ip-test-alice@example.com from IP 1.2.3.4
      for (let i = 0; i < 10; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/verify-pin',
          remoteAddress: '1.2.3.4',
          payload: { email: 'ip-test-alice@example.com', pin: '000000' },
        });
      }

      // 1.2.3.4 + ip-test-alice is now rate limited
      const resExhausted = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        remoteAddress: '1.2.3.4',
        payload: { email: 'ip-test-alice@example.com', pin: '000000' },
      });
      expect(resExhausted.statusCode).toBe(429);

      // Same email from a DIFFERENT IP (5.6.7.8) — independent bucket, NOT exhausted
      const resDifferentIp = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        remoteAddress: '5.6.7.8',
        payload: { email: 'ip-test-alice@example.com', pin: '000000' },
      });
      expect(resDifferentIp.statusCode).toBe(401);
    });

    it('verify-pin rate limit accumulates independently per IP:email pair', async () => {
      // 9 attempts from IP 2.3.4.5 for compound-alice@example.com (one under the limit)
      for (let i = 0; i < 9; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/verify-pin',
          remoteAddress: '2.3.4.5',
          payload: { email: 'compound-alice@example.com', pin: '000000' },
        });
      }

      // 9 attempts from a DIFFERENT IP 3.4.5.6 for the same email (also one under the limit)
      for (let i = 0; i < 9; i++) {
        await rateLimitApp.inject({
          method: 'POST',
          url: '/api/auth/verify-pin',
          remoteAddress: '3.4.5.6',
          payload: { email: 'compound-alice@example.com', pin: '000000' },
        });
      }

      // The 10th attempt from 2.3.4.5 still succeeds (uses up the last slot in that bucket)
      const resTenth = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        remoteAddress: '2.3.4.5',
        payload: { email: 'compound-alice@example.com', pin: '000000' },
      });
      expect(resTenth.statusCode).toBe(401);

      // The 11th attempt from 2.3.4.5 hits the rate limit for that IP:email pair
      const resEleventh = await rateLimitApp.inject({
        method: 'POST',
        url: '/api/auth/verify-pin',
        remoteAddress: '2.3.4.5',
        payload: { email: 'compound-alice@example.com', pin: '000000' },
      });
      expect(resEleventh.statusCode).toBe(429);
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


  describe('body limit', () => {
    let bodyLimitApp: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      bodyLimitApp = Fastify({ logger: false, bodyLimit: 100 * 1024 });
      await bodyLimitApp.register(fastifyCookie);
      await bodyLimitApp.register(authRoutes);
      await bodyLimitApp.ready();
    });

    afterAll(() => bodyLimitApp.close());

    it('returns 413 when request body exceeds the body limit', async () => {
      const oversizedBody = JSON.stringify({ email: 'a'.repeat(200 * 1024) });
      const res = await bodyLimitApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: oversizedBody,
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(413);
    });
  });
});

// ── requireAuth middleware — real cookie extraction ──────────────────────
// These tests bypass the module-level mock and exercise the actual token
// extraction logic (cookie → Bearer fallback) implemented in middleware/auth.ts.
describe('requireAuth middleware — real cookie extraction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let realApp: any;

  beforeAll(async () => {
    const { requireAuth } = await vi.importActual<typeof import('../middleware/auth.js')>(
      '../middleware/auth.js',
    );
    const testApp = Fastify({ logger: false });
    await testApp.register(fastifyCookie);
    // Minimal protected route to assert middleware behaviour
    testApp.get('/protected', { preHandler: [requireAuth as any] }, async (req: any) => {
      return { userId: req.userId };
    });
    await testApp.ready();
    realApp = testApp;
  });

  afterAll(async () => realApp?.close());

  it('accepts a valid JWT issued as a cookie', async () => {
    const { signToken } = await vi.importActual<typeof import('../middleware/auth.js')>(
      '../middleware/auth.js',
    );
    // Sign with the same secret used by the mocked config (jwtSecret: 'test-secret')
    const token = await (signToken as typeof import('../middleware/auth.js').signToken)({
      userId: 'real-user',
      email: 'real@example.com',
    });

    const res = await realApp.inject({
      method: 'GET',
      url: '/protected',
      cookies: { token },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).userId).toBe('real-user');
  });

  it('returns 401 when neither cookie nor bearer token is present', async () => {
    const res = await realApp.inject({
      method: 'GET',
      url: '/protected',
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Authentication required');
  });

  it('returns 401 for a tampered or malformed cookie token', async () => {
    const res = await realApp.inject({
      method: 'GET',
      url: '/protected',
      cookies: { token: 'not.a.valid.jwt' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid|expired/i);
  });

  it('empty token cookie — as set by clearCookie after logout — results in 401', async () => {
    // When the browser honours a clearCookie directive it stops sending the cookie entirely.
    // An empty string value is the edge case between "cookie present but empty" and "no cookie";
    // both must be treated as unauthenticated.
    const res = await realApp.inject({
      method: 'GET',
      url: '/protected',
      cookies: { token: '' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Authentication required');
  });
});

// ── POST /api/auth/refresh — expired & malformed JWT ─────────────────────
// These tests bypass the module-level requireAuth mock and exercise the actual
// JWT verification path (expired token, malformed token) against the refresh route.
describe('POST /api/auth/refresh — expired & malformed JWT', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let realRefreshApp: any;

  beforeAll(async () => {
    const { requireAuth } = await vi.importActual<typeof import('../middleware/auth.js')>(
      '../middleware/auth.js',
    );
    const testApp = Fastify({ logger: false });
    await testApp.register(fastifyCookie);
    // Minimal refresh route with the real requireAuth so JWT validation runs
    testApp.post(
      '/api/auth/refresh',
      { preHandler: [requireAuth as any] },
      async (_req: any) => ({ success: true }),
    );
    await testApp.ready();
    realRefreshApp = testApp;
  });

  afterAll(async () => realRefreshApp?.close());

  it('returns 401 with an expired JWT in the Bearer header', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode('test-secret');
    const expiredToken = await new SignJWT({ userId: 'user-1', email: 'user@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1 hour ago
      .sign(secret);

    const res = await realRefreshApp.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid|expired/i);
  });

  it('returns 401 with a malformed JWT string in the Bearer header', async () => {
    const res = await realRefreshApp.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { authorization: 'Bearer not.a.jwt' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid|expired/i);
  });
});
