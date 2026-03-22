import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import { RATE_LIMITS } from '../constants.js';

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
    return app.orgService.listUserOrgs(request.userId!);
  });

  // POST /api/organizations — create organization
  app.post<{ Body: { name: string; slug: string } }>(
    '/api/organizations',
    {
      config: { rateLimit: RATE_LIMITS.ORG_CREATE },
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

      const result = await app.orgService.createOrg(request.userId!, name, slug);
      if (!result.org) return reply.status(result.status).send({ error: result.error });
      return result.org;
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
      return app.orgService.getOrgById(request.organizationId!, request.userId!);
    },
  );

  // PUT /api/organizations/:orgId — update organization
  app.put<{ Params: { orgId: string }; Body: { name?: string; logo_url?: string; settings?: Record<string, unknown> } }>(
    '/api/organizations/:orgId',
    {
      config: { rateLimit: RATE_LIMITS.ORG_UPDATE },
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

      const result = await app.orgService.updateOrg(request.organizationId!, request.userId!, request.body);
      if ('error' in result) return reply.status(result.status).send({ error: result.error });
      return result;
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
      return app.orgService.listMembers(request.organizationId!, request.userId!);
    },
  );
}
