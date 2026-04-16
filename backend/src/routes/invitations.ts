import type { App } from '../index.js';
import { Type } from '@fastify/type-provider-typebox';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import { RATE_LIMITS } from '../constants.js';

const errorSchema = { type: 'object', properties: { error: { type: 'string' } } } as const;

const ALLOWED_ROLES = ['admin', 'member', 'viewer'] as const;

export async function invitationRoutes(app: App): Promise<void> {
  // POST /api/invitations — send invitation
  app.post(
    '/api/invitations',
    {
      schema: {
        body: Type.Object({
          email: Type.String({ maxLength: 255 }),
          role: Type.Optional(Type.String()),
        }, { additionalProperties: false }),
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
          403: errorSchema,
          409: errorSchema,
          503: errorSchema,
        },
      },
      preHandler: [requireAuth, resolveOrg],
      config: { rateLimit: RATE_LIMITS.INVITATIONS },
    },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const { email } = request.body;
      const role = request.body.role ?? 'member';
      if (!(ALLOWED_ROLES as readonly string[]).includes(role)) {
        return reply.status(400).send({ error: 'Invalid role. Must be admin, member, or viewer.' });
      }
      const result = await app.invitationService.sendInvite(
        request.organizationId!,
        request.userId!,
        email,
        role,
      );
      if ('error' in result) return reply.status(result.status as 400 | 403 | 409 | 503).send({ error: result.error });
      return result;
    },
  );

  // GET /api/invitations/:token — get invitation details
  app.get(
    '/api/invitations/:token',
    {
      schema: {
        params: Type.Object({ token: Type.String() }),
        response: {
          200: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              role: { type: 'string' },
              organization: { type: 'string' },
              expires_at: { type: 'string' },
            },
          },
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const details = await app.invitationService.getInvitation(request.params.token);
      if (!details) return reply.status(404).send({ error: 'Invitation not found or expired' });
      return details;
    },
  );

  // POST /api/invitations/:token/accept — accept invitation
  app.post(
    '/api/invitations/:token/accept',
    {
      schema: {
        params: Type.Object({ token: Type.String() }),
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const result = await app.invitationService.acceptInvitation(request.params.token, request.userId!);
      if ('error' in result) return reply.status(result.status as 400 | 403 | 404 | 409).send({ error: result.error });
      return result;
    },
  );
}
