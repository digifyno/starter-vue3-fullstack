import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { organizationRoutes } from './organizations.js';
import { OrganizationService } from '../services/organization-service.js';
import { SETTINGS } from '../constants.js';

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return {
    query: vi.fn().mockResolvedValue({ rows: [] } as any),
    queryOne: vi.fn().mockResolvedValue(null),
    queryWithContext: vi.fn().mockResolvedValue({ rows: [] } as any),
    buildUpdateClause: actual.buildUpdateClause,
  };
});

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

describe('Organization Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorate('orgService', new OrganizationService());
    await app.register(organizationRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  // ── GET /api/organizations ──────────────────────────────────────────────

  describe('GET /api/organizations', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({ method: 'GET', url: '/api/organizations' });
      expect(res.statusCode).toBe(401);
    });

    it('returns list of organizations for authenticated user', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({
        rows: [{ id: 'org-1', name: 'Org One', slug: 'org-one', role: 'owner' }],
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/organizations',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].name).toBe('Org One');
    });

    it('returns empty array when user has no organizations', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/organizations',
        headers: { Authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });
  });

  // ── POST /api/organizations ─────────────────────────────────────────────

  describe('POST /api/organizations', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        payload: { name: 'Test Org', slug: 'test-org' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when slug is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { name: 'Test Org' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { slug: 'test-org' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 409 when slug is already taken', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'existing-org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { name: 'Test Org', slug: 'taken-slug' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('creates organization and adds creator as owner', async () => {
      const { queryOne, query } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null); // slug not taken
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'new-org', name: 'New Org', slug: 'new-org' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { name: 'New Org', slug: 'new-org' },
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO org_memberships'),
        expect.arrayContaining(['user-1', 'new-org']),
      );
    });
  });

  // ── GET /api/organizations/:orgId ───────────────────────────────────────

  describe('GET /api/organizations/:orgId', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({ method: 'GET', url: '/api/organizations/org-1' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when user is not a member', async () => {
      const { resolveOrg } = await import('../middleware/org-context.js');
      vi.mocked(resolveOrg).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(403).send({ error: 'Not a member of this organization' });
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns org details for members', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: [{ id: 'org-1', name: 'Test Org', slug: 'test-org' }] } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).name).toBe('Test Org');
    });
  });

  // ── PUT /api/organizations/:orgId ───────────────────────────────────────

  describe('PUT /api/organizations/:orgId', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        payload: { name: 'Updated Name' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when member role tries to update org', async () => {
      const { resolveOrg } = await import('../middleware/org-context.js');
      vi.mocked(resolveOrg).mockImplementationOnce(async (request: any) => {
        request.organizationId = 'org-1';
        request.orgRole = 'member';
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { name: 'Updated Name' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows owner to update organization name', async () => {
      const { queryWithContext } = await import('../database.js');

      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { name: 'Updated Name' },
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(queryWithContext)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE organizations SET'),
        expect.arrayContaining(['Updated Name', 'org-1']),
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('returns no changes message when body has no valid fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).message).toBe('No changes');
    });
  });

  // ── GET /api/organizations/:orgId/members ───────────────────────────────

  describe('GET /api/organizations/:orgId/members', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({ method: 'GET', url: '/api/organizations/org-1/members' });
      expect(res.statusCode).toBe(401);
    });

    it('returns members list', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({
        rows: [
          { id: 'mem-1', user_id: 'user-1', organization_id: 'org-1', role: 'owner', email: 'user@example.com', name: 'Test User' },
        ],
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/organizations/org-1/members',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].role).toBe('owner');
    });
  });

  // ── PUT /api/organizations/:orgId — URL validation ──────────────────────

  describe('PUT /api/organizations/:orgId — logo_url validation', () => {
    it('rejects javascript: scheme in logo_url', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { logo_url: 'javascript:alert(1)' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('http or https');
    });

    it('rejects data: URI scheme in logo_url', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { logo_url: 'data:text/html,<script>alert(1)</script>' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts https:// URL in logo_url', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { logo_url: 'https://cdn.example.com/logo.png' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── PUT /api/organizations/:orgId — JSONB size limit ────────────────────

  describe('PUT /api/organizations/:orgId — settings size limit', () => {
    it('rejects settings payload exceeding 10KB', async () => {
      const oversized = { data: 'x'.repeat(10_001) };
      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { settings: oversized },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('too large');
    });

    it('accepts settings payload exactly at the 10KB limit', async () => {
      const key = 'data';
      const wrapper = `{"${key}":""}`;
      const fillLen = SETTINGS.MAX_SIZE_BYTES - wrapper.length;
      const settings = { [key]: 'x'.repeat(fillLen) };
      expect(JSON.stringify(settings).length).toBe(SETTINGS.MAX_SIZE_BYTES);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/organizations/org-1',
        headers: { Authorization: 'Bearer mock-token', 'X-Organization-Id': 'org-1' },
        payload: { settings },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
