/**
 * required-fields.test.ts
 *
 * Comprehensive required-field validation tests for all POST/PUT endpoints.
 * Each test verifies that omitting or supplying a malformed required field
 * produces a 400 (Bad Request) response, not a 5xx or silently incorrect result.
 *
 * Endpoints covered:
 *   POST /api/auth/register          — email, name
 *   POST /api/auth/login             — email
 *   POST /api/auth/verify-pin        — email, pin
 *   POST /api/auth/passkey/login/begin     — email
 *   POST /api/auth/passkey/login/complete  — email, response
 *   POST /api/auth/passkey/register/complete — response
 *   POST /api/organizations          — name, slug
 *   PUT  /api/users/me               — validates optional fields (empty name, bad URLs)
 *   PUT  /api/users/me/settings      — settings
 *   POST /api/invitations            — email
 *   POST /api/ai/chat                — message
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { App } from '../index.js';

// ── Route imports ────────────────────────────────────────────────────────────
import { authRoutes } from './auth.js';
import { organizationRoutes } from './organizations.js';
import { invitationRoutes } from './invitations.js';
import { userRoutes } from './users.js';
import { aiRoutes } from './ai.js';

// ── Service imports (needed for Fastify decorators) ──────────────────────────
import { OrganizationService } from '../services/organization-service.js';
import { InvitationService } from '../services/invitation-service.js';
import { UserService } from '../services/user-service.js';

// ── Global mocks ─────────────────────────────────────────────────────────────

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return {
    query: vi.fn().mockResolvedValue({ rows: [] } as any),
    queryOne: vi.fn().mockResolvedValue(null),
    queryWithContext: vi.fn().mockResolvedValue({ rows: [] } as any),
    withTransaction: vi.fn().mockImplementation(async (fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
    buildUpdateClause: actual.buildUpdateClause,
  };
});

vi.mock('../services/email.js', () => ({
  sendPin: vi.fn().mockResolvedValue(undefined),
  sendWelcome: vi.fn().mockResolvedValue(undefined),
  sendInvitation: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../middleware/org-context.js', () => ({
  resolveOrg: vi.fn().mockImplementation(async (request: any) => {
    request.organizationId = (request.headers as any)['x-organization-id'] || 'org-1';
    request.orgRole = 'owner';
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    disableDevLogin: false,
    nodeEnv: 'test',
    port: 4001,
    host: '127.0.0.1',
    jwtSecret: 'test-secret',
    appUrl: 'http://localhost:5173',
    rpId: 'localhost',
    rpName: 'Test App',
    jwtExpiresIn: '7d',
    hub: { url: '', token: '' },
  },
}));

vi.mock('../services/hub-client.js', () => ({
  hubClient: {
    isConfigured: true,
    request: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../services/ai.js', () => ({
  chat: vi.fn().mockResolvedValue({ reply: 'ok', model: 'claude-3' }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const AUTH_HEADERS = { authorization: 'Bearer mock-token' };
const ORG_HEADERS = { ...AUTH_HEADERS, 'x-organization-id': 'org-1' };

function is400(res: { statusCode: number }): void {
  expect(res.statusCode).toBe(400);
}

// ── Test suites ──────────────────────────────────────────────────────────────

// ── Auth routes ──────────────────────────────────────────────────────────────

describe('Required field validation — POST /api/auth/register', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when both email and name are missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {} });
    is400(res);
  });

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Alice' },
    });
    is400(res);
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@example.com' },
    });
    is400(res);
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: '', name: 'Alice' },
    });
    is400(res);
  });

  it('returns 400 when name is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@example.com', name: '' },
    });
    is400(res);
  });

  it('returns 400 when email is not a valid email address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', name: 'Alice' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid email/i);
  });

  it('returns 400 when name is whitespace-only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@example.com', name: '   ' },
    });
    is400(res);
  });

  it('returns 400 when name exceeds 255 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@example.com', name: 'A'.repeat(256) },
    });
    is400(res);
  });
});

describe('Required field validation — POST /api/auth/login', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    is400(res);
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: '' },
    });
    is400(res);
  });

  it('returns 400 when email is malformed (missing @)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'notanemail' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid email/i);
  });

  it('returns 400 when email is malformed (missing domain)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@' },
    });
    is400(res);
  });

  it('returns 400 when email is malformed (missing local part)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: '@example.com' },
    });
    is400(res);
  });
});

describe('Required field validation — POST /api/auth/verify-pin', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when both email and pin are missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify-pin', payload: {} });
    is400(res);
  });

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { pin: '123456' },
    });
    is400(res);
  });

  it('returns 400 when pin is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { email: 'user@example.com' },
    });
    is400(res);
  });

  it('returns 400 when email is malformed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { email: 'bad', pin: '123456' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid email/i);
  });

  it('returns 400 when pin contains non-digit characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { email: 'user@example.com', pin: 'abcdef' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('PIN must be 6 digits');
  });

  it('returns 400 when pin has fewer than 6 digits', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { email: 'user@example.com', pin: '12345' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('PIN must be 6 digits');
  });

  it('returns 400 when pin has more than 6 digits', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { email: 'user@example.com', pin: '1234567' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('PIN must be 6 digits');
  });

  it('returns 400 when pin is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-pin',
      payload: { email: 'user@example.com', pin: '' },
    });
    is400(res);
  });
});

describe('Required field validation — POST /api/auth/passkey/login/begin', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/begin',
      payload: {},
    });
    is400(res);
  });

  it('returns 400 when email is malformed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/begin',
      payload: { email: 'not-an-email' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid email/i);
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/begin',
      payload: { email: '' },
    });
    is400(res);
  });
});

describe('Required field validation — POST /api/auth/passkey/login/complete', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when both email and response are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/complete',
      payload: {},
    });
    is400(res);
  });

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/complete',
      payload: { response: { id: 'cred-id', rawId: 'cred-id', type: 'public-key', response: {} } },
    });
    is400(res);
  });

  it('returns 400 when response is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/complete',
      payload: { email: 'user@example.com' },
    });
    is400(res);
  });

  it('returns 400 when email is malformed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/login/complete',
      payload: {
        email: 'notvalid',
        response: { id: 'cred-id', rawId: 'cred-id', type: 'public-key', response: {} },
      },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid email/i);
  });
});

describe('Required field validation — POST /api/auth/passkey/register/complete', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when response is missing (authenticated request)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/register/complete',
      headers: AUTH_HEADERS,
      payload: {},
    });
    is400(res);
  });

  it('returns 401 without authentication even if response is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey/register/complete',
      payload: { response: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── Organization routes ──────────────────────────────────────────────────────

describe('Required field validation — POST /api/organizations', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    app.decorate('orgService', new OrganizationService());
    await app.register(organizationRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when both name and slug are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: {},
    });
    is400(res);
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: { slug: 'my-org' },
    });
    is400(res);
  });

  it('returns 400 when slug is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: { name: 'My Org' },
    });
    is400(res);
  });

  it('returns 400 when name is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: { name: '', slug: 'my-org' },
    });
    is400(res);
  });

  it('returns 400 when slug is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: { name: 'My Org', slug: '' },
    });
    is400(res);
  });

  it('returns 400 when name exceeds 255 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: { name: 'A'.repeat(256), slug: 'my-org' },
    });
    is400(res);
  });

  it('returns 400 when slug exceeds 100 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/organizations',
      headers: AUTH_HEADERS,
      payload: { name: 'My Org', slug: 'a'.repeat(101) },
    });
    is400(res);
  });
});

// ── Invitation routes ────────────────────────────────────────────────────────

describe('Required field validation — POST /api/invitations', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    app.decorate('invitationService', new InvitationService());
    await app.register(invitationRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: ORG_HEADERS,
      payload: {},
    });
    is400(res);
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: ORG_HEADERS,
      payload: { email: '' },
    });
    is400(res);
  });

  it('returns 400 when email is not a valid email address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: ORG_HEADERS,
      payload: { email: 'not-valid' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid email/i);
  });

  it('returns 400 when role is an invalid value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: ORG_HEADERS,
      payload: { email: 'user@example.com', role: 'superadmin' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid role/i);
  });

  it('returns 400 when role is "owner" (cannot be invited)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: ORG_HEADERS,
      payload: { email: 'user@example.com', role: 'owner' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/invalid role/i);
  });

  it('accepts valid roles: admin, member, viewer', async () => {
    const { queryOne } = await import('../database.js');
    for (const role of ['admin', 'member', 'viewer'] as const) {
      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' }); // inviter
      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' }); // org
      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: ORG_HEADERS,
        payload: { email: `role-test-${role}@example.com`, role },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});

// ── User routes ──────────────────────────────────────────────────────────────

describe('Required field validation — PUT /api/users/me', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    app.decorate('userService', new UserService());
    await app.register(userRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when name is an empty string', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: AUTH_HEADERS,
      payload: { name: '' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/name cannot be empty/i);
  });

  it('returns 400 when name is whitespace-only', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: AUTH_HEADERS,
      payload: { name: '   ' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/name cannot be empty/i);
  });

  it('returns 400 when avatar_url uses javascript: scheme', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: AUTH_HEADERS,
      payload: { avatar_url: 'javascript:alert(1)' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/http or https/i);
  });

  it('returns 400 when avatar_url uses data: scheme', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: AUTH_HEADERS,
      payload: { avatar_url: 'data:text/html,<script>alert(1)</script>' },
    });
    is400(res);
  });

  it('returns 200 with "No changes" when payload is empty (no required fields)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: AUTH_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe('No changes');
  });

  it('returns 400 when name exceeds 255 characters', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: AUTH_HEADERS,
      payload: { name: 'A'.repeat(256) },
    });
    is400(res);
  });
});

describe('Required field validation — PUT /api/users/me/settings', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    app.decorate('userService', new UserService());
    await app.register(userRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when settings field is missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/settings',
      headers: AUTH_HEADERS,
      payload: {},
    });
    is400(res);
  });

  it('returns 400 when settings is null', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/settings',
      headers: AUTH_HEADERS,
      payload: { settings: null },
    });
    is400(res);
  });

  it('returns 400 when settings is a string instead of an object', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/settings',
      headers: AUTH_HEADERS,
      payload: { settings: 'dark' },
    });
    is400(res);
  });

  it('returns 400 when settings payload exceeds size limit', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/settings',
      headers: AUTH_HEADERS,
      payload: { settings: { data: 'x'.repeat(10_001) } },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toMatch(/too large/i);
  });

  it('returns 200 when settings is a valid object', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/settings',
      headers: AUTH_HEADERS,
      payload: { settings: { theme: 'dark' } },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── AI routes ────────────────────────────────────────────────────────────────

describe('Required field validation — POST /api/ai/chat', () => {
  let app: App;

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    await app.register(aiRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when message is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: {},
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('Message is required');
  });

  it('returns 400 when message is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: { message: '' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('Message is required');
  });

  it('returns 400 when message is whitespace-only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: { message: '   ' },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('Message is required');
  });

  it('returns 400 when message exceeds 4000 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: { message: 'a'.repeat(4001) },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('Message too long');
    expect(JSON.parse(res.body).maxLength).toBe(4000);
  });

  it('returns 400 when history exceeds 50 items', async () => {
    const history = Array.from({ length: 51 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: { message: 'Hello', history },
    });
    is400(res);
    expect(JSON.parse(res.body).error).toBe('History too long');
  });

  it('returns 200 when message is exactly 4000 characters', async () => {
    const { hubClient } = await import('../services/hub-client.js');
    vi.mocked(hubClient as any).isConfigured = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: { message: 'a'.repeat(4000) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 when history has exactly 50 items', async () => {
    const { hubClient } = await import('../services/hub-client.js');
    vi.mocked(hubClient as any).isConfigured = true;

    const history = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: AUTH_HEADERS,
      payload: { message: 'Hello', history },
    });
    expect(res.statusCode).toBe(200);
  });
});
