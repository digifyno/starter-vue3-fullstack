import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-secret-for-auth-middleware',
    jwtExpiresIn: '7d',
  },
}));

// Import after mocking config
const { requireAuth, optionalAuth, signToken } = await import('./auth.js');

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    cookies: {},
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeReply(): { statusCode: number | null; body: unknown; status: (code: number) => { send: (body: unknown) => void }; _sent: boolean } {
  const reply = {
    statusCode: null as number | null,
    body: undefined as unknown,
    _sent: false,
    status(code: number) {
      reply.statusCode = code;
      return {
        send(body: unknown) {
          reply.body = body;
          reply._sent = true;
        },
      };
    },
  };
  return reply;
}

describe('signToken', () => {
  it('returns a JWT string', async () => {
    const token = await signToken({ userId: 'u1', email: 'a@b.com' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });
});

describe('requireAuth', () => {
  let reply: ReturnType<typeof makeReply>;

  beforeEach(() => {
    reply = makeReply();
  });

  it('returns 401 when no cookie and no Authorization header', async () => {
    const request = makeRequest();
    await requireAuth(request, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as any).error).toBe('Authentication required');
  });

  it('returns 401 when cookie token is invalid', async () => {
    const request = makeRequest({ cookies: { token: 'bad.token.here' } });
    await requireAuth(request, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as any).error).toBe('Invalid or expired token');
  });

  it('returns 401 when Bearer token is invalid', async () => {
    const request = makeRequest({ headers: { authorization: 'Bearer not-a-real-jwt' } });
    await requireAuth(request, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as any).error).toBe('Invalid or expired token');
  });

  it('sets userId and userEmail on a valid cookie token', async () => {
    const token = await signToken({ userId: 'u-cookie', email: 'cookie@example.com' });
    const request = makeRequest({ cookies: { token } });
    await requireAuth(request, reply as unknown as FastifyReply);
    expect(reply._sent).toBe(false);
    expect(request.userId).toBe('u-cookie');
    expect(request.userEmail).toBe('cookie@example.com');
  });

  it('sets userId and userEmail on a valid Bearer token', async () => {
    const token = await signToken({ userId: 'u-bearer', email: 'bearer@example.com' });
    const request = makeRequest({ headers: { authorization: `Bearer ${token}` } });
    await requireAuth(request, reply as unknown as FastifyReply);
    expect(reply._sent).toBe(false);
    expect(request.userId).toBe('u-bearer');
    expect(request.userEmail).toBe('bearer@example.com');
  });

  it('cookie takes precedence over Bearer when both are present', async () => {
    const cookieToken = await signToken({ userId: 'u-from-cookie', email: 'cookie@example.com' });
    const bearerToken = await signToken({ userId: 'u-from-bearer', email: 'bearer@example.com' });
    const request = makeRequest({
      cookies: { token: cookieToken },
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    await requireAuth(request, reply as unknown as FastifyReply);
    expect(request.userId).toBe('u-from-cookie');
    expect(request.userEmail).toBe('cookie@example.com');
  });
});

describe('optionalAuth', () => {
  it('does not modify request or error when no token present', async () => {
    const request = makeRequest();
    await optionalAuth(request);
    expect(request.userId).toBeUndefined();
    expect(request.userEmail).toBeUndefined();
  });

  it('sets userId and userEmail on a valid token', async () => {
    const token = await signToken({ userId: 'u-opt', email: 'opt@example.com' });
    const request = makeRequest({ headers: { authorization: `Bearer ${token}` } });
    await optionalAuth(request);
    expect(request.userId).toBe('u-opt');
    expect(request.userEmail).toBe('opt@example.com');
  });

  it('ignores invalid token silently', async () => {
    const request = makeRequest({ headers: { authorization: 'Bearer garbage-token' } });
    await optionalAuth(request);
    expect(request.userId).toBeUndefined();
    expect(request.userEmail).toBeUndefined();
  });
});
