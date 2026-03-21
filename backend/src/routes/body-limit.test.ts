import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { authRoutes } from './auth.js';
import { SETTINGS } from '../constants.js';

// Mock all dependencies — same as auth.test.ts
vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  queryOne: vi.fn().mockResolvedValue(null),
  withTransaction: vi.fn().mockImplementation(async (fn: (client: any) => Promise<unknown>) => {
    return fn({ query: vi.fn().mockResolvedValue({ rows: [] }) });
  }),
}));

vi.mock('../services/email.js', () => ({
  sendPin: vi.fn().mockResolvedValue(undefined),
  sendWelcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/pin.js', () => ({
  generatePin: vi.fn().mockReturnValue('123456'),
  createPin: vi.fn().mockResolvedValue('123456'),
  verifyPin: vi.fn().mockResolvedValue(false),
}));

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

vi.mock('../config.js', () => ({
  config: {
    disableDevLogin: false,
    nodeEnv: 'test',
    port: 4001,
    host: '127.0.0.1',
    jwtSecret: 'test-secret',
  },
}));

describe('Request body size limits', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false, bodyLimit: SETTINGS.BODY_LIMIT_BYTES });
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('rejects requests with body larger than 100KB', async () => {
    // email value of 110 KB ensures the JSON body exceeds the 100 KB limit
    const largePayload = { email: 'a'.repeat(110 * 1024) };
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: largePayload,
    });
    expect(response.statusCode).toBe(413);
  });

  it('accepts requests within the body size limit', async () => {
    const normalPayload = { email: 'user@example.com' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: normalPayload,
    });
    expect(response.statusCode).not.toBe(413);
  });
});
