import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import type { Organization, OrgMembership, User } from '../types.js';
import { SETTINGS } from '../constants.js';


function isValidHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/organizations — list user's organizations
  app.get('/api/organizations', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              logo_url: { type: 'string', nullable: true },
              settings: { type: 'object', additionalProperties: true },
              created_at: { type: 'string' },
              role: { type: 'string' },
            },
          },
        },
      },
    },
    preHandler: [requireAuth],
  }, async (request) => {
    const orgs = await query<Organization & { role: string }>(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.settings, o.created_at, m.role FROM organizations o
       JOIN org_memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY o.name`,
      [request.userId],
    );
    return orgs.rows;
  });

  // POST /api/organizations — create organization
  app.post<{ Body: { name: string; slug: string } }>(
    '/api/organizations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string', maxLength: 255 },
            slug: { type: 'string', maxLength: 100 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              logo_url: { type: 'string', nullable: true },
              settings: { type: 'object', additionalProperties: true },
              created_at: { type: 'string' },
            },
          },
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { name, slug } = request.body;
      if (!name || !slug) return reply.status(400).send({ error: 'Name and slug required' });

      const existing = await queryOne<Organization>('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (existing) return reply.status(409).send({ error: 'Organization slug already taken' });

      const result = await queryOne<Organization>(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug, logo_url, settings, created_at',
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
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              logo_url: { type: 'string', nullable: true },
              settings: { type: 'object', additionalProperties: true },
              created_at: { type: 'string' },
            },
          },
        },
      },
      preHandler: [requireAuth, resolveOrg],
    },
    async (request) => {
      const org = await queryOne<Organization>(
        'SELECT id, name, slug, logo_url, settings, created_at FROM organizations WHERE id = $1',
        [request.organizationId],
      );
      return org;
    },
  );

  // PUT /api/organizations/:orgId — update organization
  app.put<{ Params: { orgId: string }; Body: { name?: string; logo_url?: string; settings?: Record<string, unknown> } }>(
    '/api/organizations/:orgId',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 255 },
            logo_url: { type: 'string', maxLength: 2048 },
            settings: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
        },
      },
      preHandler: [requireAuth, resolveOrg],
    },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const { name, logo_url, settings } = request.body;

      if (logo_url !== undefined && !isValidHttpUrl(logo_url)) {
        return reply.status(400).send({ error: 'logo_url must use http or https scheme' });
      }

      if (settings !== undefined && JSON.stringify(settings).length > SETTINGS.MAX_SIZE_BYTES) {
        return reply.status(400).send({ error: 'Settings payload too large' });
      }

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
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                user_id: { type: 'string' },
                organization_id: { type: 'string' },
                role: { type: 'string' },
                invited_by: { type: 'string', nullable: true },
                joined_at: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                avatar_url: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
      preHandler: [requireAuth, resolveOrg],
    },
    async (request) => {
      const members = await query<OrgMembership & Pick<User, 'email' | 'name' | 'avatar_url'>>(
        `SELECT m.id, m.user_id, m.organization_id, m.role, m.invited_by, m.joined_at, u.email, u.name, u.avatar_url FROM org_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 ORDER BY m.joined_at`,
        [request.organizationId],
      );
      return members.rows;
    },
  );
}
