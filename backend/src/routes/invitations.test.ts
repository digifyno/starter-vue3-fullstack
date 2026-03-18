import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { invitationRoutes } from './invitations.js';
import { InvitationService } from '../services/invitation-service.js';

vi.mock('../database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] } as any);
  const queryOne = vi.fn().mockResolvedValue(null);
  const withTransaction = vi.fn().mockImplementation(async (fn: any) => {
    return fn({ query });
  });
  return { query, queryOne, withTransaction };
});

vi.mock('../services/email.js', () => ({
  sendInvitation: vi.fn().mockResolvedValue(undefined),
  sendPin: vi.fn().mockResolvedValue(undefined),
  sendWelcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn().mockImplementation(async (request: any) => {
    request.userId = 'user-1';
    request.userEmail = 'user@example.com';
  }),
  signToken: vi.fn().mockReturnValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
}));

vi.mock('../middleware/org-context.js', () => ({
  resolveOrg: vi.fn().mockImplementation(async (request: any) => {
    request.organizationId = (request.headers as any)['x-organization-id'] || 'org-1';
    request.orgRole = 'owner';
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    appUrl: 'http://localhost:5173',
    disableDevLogin: false,
    nodeEnv: 'test',
    port: 4001,
    host: '127.0.0.1',
    jwtSecret: 'test-secret',
    jwtExpiresIn: '7d',
    hub: { url: '', token: '' },
  },
}));

describe('Invitation Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorate('invitationService', new InvitationService());
    await app.register(invitationRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  // ── POST /api/invitations ───────────────────────────────────────────────

  describe('POST /api/invitations', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        payload: { email: 'invite@example.com' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when non-admin member tries to invite', async () => {
      const { resolveOrg } = await import('../middleware/org-context.js');
      vi.mocked(resolveOrg).mockImplementationOnce(async (request: any) => {
        request.organizationId = 'org-1';
        request.orgRole = 'member';
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'invite@example.com' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'not-an-email' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid role (superadmin)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'invite@example.com', role: 'superadmin' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid role');
    });

    it('returns 400 for owner role (owners cannot be invited)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'invite@example.com', role: 'owner' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid role');
    });

    it('accepts valid roles: admin, member, viewer', async () => {
      const { queryOne } = await import('../database.js');
      for (const role of ['admin', 'member', 'viewer']) {
        vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' });
        vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' });
        const res = await app.inject({
          method: 'POST',
          url: '/api/invitations',
          headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
          payload: { email: `invite-${role}@example.com`, role },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('creates invitation and sends email to invitee', async () => {
      const { queryOne } = await import('../database.js');
      const { sendInvitation } = await import('../services/email.js');

      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' }); // inviter
      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' }); // org

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'newuser@example.com', role: 'member' },
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(sendInvitation)).toHaveBeenCalledWith(
        'newuser@example.com',
        'Test Org',
        'Alice',
        expect.stringContaining('/invite/'),
      );
    });

    it('returns 503 when email hub is unavailable and does not insert invitation record', async () => {
      const { queryOne, withTransaction } = await import('../database.js');
      const { sendInvitation } = await import('../services/email.js');

      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' }); // inviter
      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' }); // org
      vi.mocked(sendInvitation).mockRejectedValueOnce(new Error('Hub API error 503: service unavailable'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'newuser@example.com', role: 'member' },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toMatch(/email service unavailable/i);
      // withTransaction must NOT have been called — no invitation record inserted
      expect(vi.mocked(withTransaction)).not.toHaveBeenCalled();
    });

    it('allows admin role to send invitations', async () => {
      const { resolveOrg } = await import('../middleware/org-context.js');
      vi.mocked(resolveOrg).mockImplementationOnce(async (request: any) => {
        request.organizationId = 'org-1';
        request.orgRole = 'admin';
      });

      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Bob' });
      vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { email: 'another@example.com' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── GET /api/invitations/:token ─────────────────────────────────────────

  describe('GET /api/invitations/:token', () => {
    it('returns 404 for expired or invalid token', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({ method: 'GET', url: '/api/invitations/expired-token' });
      expect(res.statusCode).toBe(404);
    });

    it('returns invitation details for valid token', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'inv-1',
        email: 'invite@example.com',
        role: 'member',
        org_name: 'Test Org',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });

      const res = await app.inject({ method: 'GET', url: '/api/invitations/valid-token' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.email).toBe('invite@example.com');
      expect(body.organization).toBe('Test Org');
      expect(body.role).toBe('member');
    });
  });

  // ── POST /api/invitations/:token/accept ─────────────────────────────────

  describe('POST /api/invitations/:token/accept', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations/some-token/accept',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for invalid or expired invitation', async () => {
      const { query } = await import('../database.js');
      // FOR UPDATE query returns no rows
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations/bad-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(404);
    });


    it('returns 404 when invitation token has expired (expires_at in the past)', async () => {
      const { query } = await import('../database.js');
      // The SQL WHERE clause includes expires_at > NOW(), so an expired token returns no rows
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations/expired-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('expired');
    });
    it('returns 404 when invitation has already been accepted (accepted_at IS NOT NULL)', async () => {
      const { query } = await import('../database.js');
      // The SQL WHERE clause includes `AND accepted_at IS NULL`, so a previously-accepted
      // token is indistinguishable from a missing/expired token — both return no rows.
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations/already-accepted-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('expired');
    });

    it('returns 200 with "Already a member" when user is already a member', async () => {
      const { query } = await import('../database.js');
      // FOR UPDATE: invitation found
      vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'member', invited_by: 'admin-1' }] } as any);
      // INSERT ON CONFLICT DO NOTHING: conflict (already member)
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0 } as any);
      // UPDATE accepted_at: success
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations/valid-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Already a member of this organization');
    });

    it('accepts invitation and adds user to org membership', async () => {
      const { query } = await import('../database.js');
      // FOR UPDATE: invitation found
      vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'member', invited_by: 'admin-1' }] } as any);
      // INSERT: new membership row inserted
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 1 } as any);
      // UPDATE accepted_at: success
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/invitations/valid-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Invitation accepted');
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO org_memberships'),
        expect.arrayContaining(['user-1', 'org-1', 'member']),
      );
    });

    it('marks invitation as accepted regardless of existing membership', async () => {
      const { query } = await import('../database.js');
      vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'viewer', invited_by: 'admin-1' }] } as any);
      vi.mocked(query).mockResolvedValueOnce({ rowCount: 0 } as any);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      await app.inject({
        method: 'POST',
        url: '/api/invitations/valid-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE invitations SET accepted_at'),
        ['inv-1'],
      );
    });

    it('is idempotent: accepting same token twice returns success both times', async () => {
      const { query } = await import('../database.js');

      // First accept: new membership inserted
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'member', invited_by: 'admin-1' }] } as any)
        .mockResolvedValueOnce({ rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/invitations/valid-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res1.statusCode).toBe(200);
      expect(JSON.parse(res1.body).message).toBe('Invitation accepted');

      vi.clearAllMocks();

      // Second accept: ON CONFLICT DO NOTHING (already a member)
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'member', invited_by: 'admin-1' }] } as any)
        .mockResolvedValueOnce({ rowCount: 0 } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/invitations/valid-token/accept',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res2.body).message).toBe('Already a member of this organization');
    });
  });
});

describe('Duplicate invitation edge cases', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorate('invitationService', new InvitationService());
    await app.register(invitationRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('returns non-500 when same email is invited twice to the same org', async () => {
    const { queryOne } = await import('../database.js');

    // First invitation
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' }); // inviter
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' }); // org
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
      payload: { email: 'dup@example.com' },
    });
    expect(res1.statusCode).toBe(200);

    // Second invitation for same email — current behaviour: allowed (no unique constraint)
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' }); // inviter
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' }); // org
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
      payload: { email: 'dup@example.com' },
    });
    // Must not return 500; currently returns 200 (duplicates allowed — no unique constraint)
    expect(res2.statusCode).not.toBe(500);
    expect(res2.statusCode).toBe(200);
  });

  it('returns 409 when the database rejects a duplicate invitation with a unique constraint violation', async () => {
    // If a UNIQUE constraint is later added on (organization_id, email, accepted_at IS NULL),
    // the route should catch PostgreSQL error code 23505 and return 409 rather than 500.
    const { queryOne, withTransaction } = await import('../database.js');
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Alice' }); // inviter
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Test Org' }); // org

    // Simulate a PG unique violation (code 23505)
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    vi.mocked(withTransaction).mockRejectedValueOnce(pgError);

    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
      payload: { email: 'already-invited@example.com' },
    });

    // Should return 409 Conflict, not 500 Internal Server Error
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/invitation.*already|already.*sent|duplicate/i);
  });
});
