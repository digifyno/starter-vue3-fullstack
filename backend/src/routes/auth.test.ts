import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { authRoutes } from './auth.js';

// Mock database — no real PG connection needed
vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] } as any),
  queryOne: vi.fn().mockResolvedValue(null),
}));

// Mock email hub — no real emails sent
vi.mock('../services/email.js', () => ({
  sendPin: vi.fn().mockResolvedValue(undefined),
  sendWelcome: vi.fn().mockResolvedValue(undefined),
}));

// Mock PIN service — control behaviour per test
vi.mock('../services/pin.js', () => ({
  createPin: vi.fn().mockResolvedValue('123456'),
  verifyPin: vi.fn().mockResolvedValue(false),
}));

// Mock JWT signing
vi.mock('../middleware/auth.js', () => ({
  signToken: vi.fn().mockReturnValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
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

    it('returns 404 when no account exists for that email', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'notfound@example.com' },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('register');
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
      // last_login_at UPDATE + orgs query
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
});
