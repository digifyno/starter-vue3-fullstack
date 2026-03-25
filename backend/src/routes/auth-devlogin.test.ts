import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { authRoutes } from './auth.js';
import { userRoutes } from './users.js';
import { UserService } from '../services/user-service.js';

// ── Hoisted mutable config (must be declared before vi.mock factories run) ────
const mockConfig = vi.hoisted(() => ({
  disableDevLogin: false,
  nodeEnv: 'test' as string,
  port: 4001,
  host: '127.0.0.1',
  jwtSecret: 'test-secret',
  jwtExpiresIn: '7d',
}));

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock('../database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] } as any);
  const queryOne = vi.fn().mockResolvedValue(null);
  const withTransaction = vi.fn().mockImplementation(
    async (fn: (client: { query: typeof query }) => Promise<unknown>) => fn({ query }),
  );
  return { query, queryOne, withTransaction };
});

vi.mock('../services/email.js', () => ({
  sendPin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/pin.js', () => ({
  generatePin: vi.fn().mockReturnValue('123456'),
  createPin: vi.fn().mockResolvedValue('123456'),
  verifyPin: vi.fn().mockResolvedValue(false),
}));

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

vi.mock('../config.js', () => ({ config: mockConfig }));

// ── Helper: build a test Fastify app ─────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(authRoutes);

  // Register user routes with the service decorator so /api/users/me works
  app.decorate('userService', new UserService());
  await app.register(userRoutes);

  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/auth/dev-login — IP restriction and env-var disable', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure dev-login is enabled by default for each test
    mockConfig.disableDevLogin = false;
  });

  afterEach(() => {
    // Restore config after each test in case it was mutated
    mockConfig.disableDevLogin = false;
  });

  // ── Test 1: reject non-localhost caller ────────────────────────────────────

  it('returns 403 when called from a non-localhost IP', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '203.0.113.42', // non-localhost public IP
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/localhost/i);
  });

  it('returns 403 for an RFC-1918 private IP that is not loopback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '192.168.1.100',
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for an X-Forwarded-For header with a non-localhost IP (trustProxy disabled)', async () => {
    // The app does NOT configure trustProxy, so request.ip is taken from the
    // socket peer address (remoteAddress), not from X-Forwarded-For.
    // Sending a non-localhost remoteAddress alongside a spoofed header must still 403.
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });

    expect(res.statusCode).toBe(403);
  });

  // ── Test 2: accept localhost caller ───────────────────────────────────────

  it('returns 200 with a token cookie when called from 127.0.0.1', async () => {
    const { queryOne, query } = await import('../database.js');

    // Simulate dev user and org already existing
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'dev-user-id', email: 'dev@localhost', name: 'Dev User', avatar_url: null, email_verified: true })
      .mockResolvedValueOnce({ id: 'dev-org-id', name: 'Development', slug: 'dev', logo_url: null, settings: {}, created_at: new Date() })
      .mockResolvedValueOnce({ id: 'membership-id' });
    vi.mocked(query).mockResolvedValue({ rows: [] } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '127.0.0.1',
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe('dev@localhost');
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].slug).toBe('dev');

    // Auth cookie must be set as httpOnly + SameSite=Strict
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    expect(cookieStr).toContain('token=mock-jwt-token');
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('samesite=strict');
  });

  it('returns 200 when called from the IPv6 loopback ::1', async () => {
    const { queryOne, query } = await import('../database.js');

    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'dev-user-id', email: 'dev@localhost', name: 'Dev User', avatar_url: null, email_verified: true })
      .mockResolvedValueOnce({ id: 'dev-org-id', name: 'Development', slug: 'dev', logo_url: null, settings: {}, created_at: new Date() })
      .mockResolvedValueOnce({ id: 'membership-id' });
    vi.mocked(query).mockResolvedValue({ rows: [] } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '::1',
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 200 when called from the IPv4-mapped IPv6 loopback ::ffff:127.0.0.1', async () => {
    const { queryOne, query } = await import('../database.js');

    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'dev-user-id', email: 'dev@localhost', name: 'Dev User', avatar_url: null, email_verified: true })
      .mockResolvedValueOnce({ id: 'dev-org-id', name: 'Development', slug: 'dev', logo_url: null, settings: {}, created_at: new Date() })
      .mockResolvedValueOnce({ id: 'membership-id' });
    vi.mocked(query).mockResolvedValue({ rows: [] } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '::ffff:127.0.0.1',
    });

    expect(res.statusCode).toBe(200);
  });

  it('cookie from dev-login grants access to GET /api/users/me', async () => {
    const { queryOne, query } = await import('../database.js');

    // Step 1: perform dev-login to receive the auth cookie
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'dev-user-id', email: 'dev@localhost', name: 'Dev User', avatar_url: null, email_verified: true })
      .mockResolvedValueOnce({ id: 'dev-org-id', name: 'Development', slug: 'dev', logo_url: null, settings: {}, created_at: new Date() })
      .mockResolvedValueOnce({ id: 'membership-id' });
    vi.mocked(query).mockResolvedValue({ rows: [] } as any);

    const loginRes = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '127.0.0.1',
    });

    expect(loginRes.statusCode).toBe(200);

    // Extract the token cookie value that was set
    const setCookieRaw = loginRes.headers['set-cookie'];
    const cookieStr: string = Array.isArray(setCookieRaw)
      ? (setCookieRaw[0] ?? '')
      : String(setCookieRaw ?? '');
    const tokenMatch = cookieStr.match(/token=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    const tokenValue: string = tokenMatch![1] as string;

    // Step 2: use the cookie to call GET /api/users/me
    // The mocked requireAuth accepts any cookie or Bearer token and sets userId='user-1'
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 'user-1',
      email: 'dev@localhost',
      name: 'Dev User',
      avatar_url: null,
      email_verified: true,
      settings: {},
    });

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      cookies: { token: tokenValue },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.body);
    expect(meBody.email).toBe('dev@localhost');
  });

  // ── Test 3: disabled via DISABLE_DEV_LOGIN env var ────────────────────────

  it('returns 403 when DISABLE_DEV_LOGIN is set, regardless of IP', async () => {
    mockConfig.disableDevLogin = true;

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '127.0.0.1', // localhost — would normally succeed
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/disabled/i);
  });

  it('returns 403 when DISABLE_DEV_LOGIN is set even for non-localhost IPs', async () => {
    mockConfig.disableDevLogin = true;

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '8.8.8.8',
    });

    // Still 403 — the disabled check runs before the IP check
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/disabled/i);
  });

  it('re-enables after DISABLE_DEV_LOGIN is cleared (afterEach restores)', async () => {
    // afterEach restores mockConfig.disableDevLogin = false before this test runs
    // Confirm dev-login works again from localhost
    const { queryOne, query } = await import('../database.js');

    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'dev-user-id', email: 'dev@localhost', name: 'Dev User', avatar_url: null, email_verified: true })
      .mockResolvedValueOnce({ id: 'dev-org-id', name: 'Development', slug: 'dev', logo_url: null, settings: {}, created_at: new Date() })
      .mockResolvedValueOnce({ id: 'membership-id' });
    vi.mocked(query).mockResolvedValue({ rows: [] } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-login',
      remoteAddress: '127.0.0.1',
    });

    expect(res.statusCode).toBe(200);
  });
});
