import type { App } from '../index.js';
import { Type } from '@fastify/type-provider-typebox';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import { RATE_LIMITS } from '../constants.js';

const errorSchema = { type: 'object', properties: { error: { type: 'string' } } } as const;

export async function organizationRoutes(app: App): Promise<void> {
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
  app.post(
    '/api/organizations',
    {
      config: { rateLimit: RATE_LIMITS.ORG_CREATE },
      schema: {
        body: Type.Object({
          name: Type.String({ maxLength: 255 }),
          slug: Type.String({ maxLength: 100 }),
        }, { additionalProperties: false }),
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
          400: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { name, slug } = request.body;
      if (!name || !slug) return reply.status(400).send({ error: 'Name and slug required' });

      const result = await app.orgService.createOrg(request.userId!, name, slug);
      if (!result.org) return reply.status(result.status as 400 | 409 | 500).send({ error: result.error! });
      return result.org;
    },
  );

  // GET /api/organizations/:orgId — get organization details
  app.get(
    '/api/organizations/:orgId',
    {
      schema: {
        params: Type.Object({ orgId: Type.String() }),
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
  app.put(
    '/api/organizations/:orgId',
    {
      config: { rateLimit: RATE_LIMITS.ORG_UPDATE },
      schema: {
        params: Type.Object({ orgId: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String({ maxLength: 255 })),
          logo_url: Type.Optional(Type.String({ maxLength: 2048 })),
          settings: Type.Optional(Type.Object({}, { additionalProperties: true })),
        }, { additionalProperties: false }),
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
          403: errorSchema,
        },
      },
      preHandler: [requireAuth, resolveOrg],
    },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const result = await app.orgService.updateOrg(request.organizationId!, request.userId!, request.body);
      if ('error' in result) return reply.status(result.status as 400).send({ error: result.error });
      return result;
    },
  );

  // GET /api/organizations/:orgId/members — list members
  app.get(
    '/api/organizations/:orgId/members',
    {
      schema: {
        params: Type.Object({ orgId: Type.String() }),
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

  // DELETE /api/organizations/:orgId/members/:userId — remove a member
  app.delete(
    '/api/organizations/:orgId/members/:userId',
    {
      schema: {
        params: Type.Object({ orgId: Type.String(), userId: Type.String() }),
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
      preHandler: [requireAuth, resolveOrg],
    },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const result = await app.orgService.removeMember(request.organizationId!, request.params.userId, request.orgRole);
      if ('error' in result) return reply.status(result.status as 400 | 403 | 404).send({ error: result.error });
      return result;
    },
  );
}
