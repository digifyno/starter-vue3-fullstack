import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import type { Organization, OrgMembership, User } from '../types.js';

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/organizations — list user's organizations
  app.get('/api/organizations', { preHandler: [requireAuth] }, async (request) => {
    const orgs = await query<Organization & { role: string }>(
      `SELECT o.*, m.role FROM organizations o
       JOIN org_memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY o.name`,
      [request.userId],
    );
    return orgs.rows;
  });

  // POST /api/organizations — create organization
  app.post<{ Body: { name: string; slug: string } }>(
    '/api/organizations',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { name, slug } = request.body;
      if (!name || !slug) return reply.status(400).send({ error: 'Name and slug required' });

      const existing = await queryOne<Organization>('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (existing) return reply.status(409).send({ error: 'Organization slug already taken' });

      const result = await queryOne<Organization>(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING *',
        [name, slug],
      );
      if (!result) return reply.status(500).send({ error: 'Failed to create organization' });

      // Add creator as owner
      await query(
        "INSERT INTO org_memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')",
        [request.userId, result.id],
      );

      return result;
    },
  );

  // GET /api/organizations/:orgId — get organization details
  app.get<{ Params: { orgId: string } }>(
    '/api/organizations/:orgId',
    { preHandler: [requireAuth, resolveOrg] },
    async (request) => {
      const org = await queryOne<Organization>(
        'SELECT * FROM organizations WHERE id = $1',
        [request.organizationId],
      );
      return org;
    },
  );

  // PUT /api/organizations/:orgId — update organization
  app.put<{ Params: { orgId: string }; Body: { name?: string; logo_url?: string; settings?: Record<string, unknown> } }>(
    '/api/organizations/:orgId',
    { preHandler: [requireAuth, resolveOrg] },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const { name, logo_url, settings } = request.body;
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
      if (logo_url !== undefined) { updates.push(`logo_url = $${idx++}`); values.push(logo_url); }
      if (settings !== undefined) { updates.push(`settings = $${idx++}`); values.push(JSON.stringify(settings)); }

      if (updates.length === 0) return { message: 'No changes' };

      values.push(request.organizationId);
      await query(`UPDATE organizations SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      return { message: 'Organization updated' };
    },
  );

  // GET /api/organizations/:orgId/members — list members
  app.get<{ Params: { orgId: string } }>(
    '/api/organizations/:orgId/members',
    { preHandler: [requireAuth, resolveOrg] },
    async (request) => {
      const members = await query<OrgMembership & Pick<User, 'email' | 'name' | 'avatar_url'>>(
        `SELECT m.*, u.email, u.name, u.avatar_url FROM org_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 ORDER BY m.joined_at`,
        [request.organizationId],
      );
      return members.rows;
    },
  );
}
