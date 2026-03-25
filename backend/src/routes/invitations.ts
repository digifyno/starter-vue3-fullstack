import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import { RATE_LIMITS } from '../constants.js';

const ALLOWED_ROLES = ['admin', 'member', 'viewer'] as const;

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/invitations — send invitation
  app.post<{ Body: { email: string; role?: 'admin' | 'member' | 'viewer' } }>(
    '/api/invitations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', maxLength: 255 },
            role: { type: 'string' },
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
      if ('error' in result) return reply.status(result.status).send({ error: result.error });
      return result;
    },
  );

  // GET /api/invitations/:token — get invitation details
  app.get<{ Params: { token: string } }>('/api/invitations/:token', {
    schema: {
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
      },
    },
  }, async (request, reply) => {
    const details = await app.invitationService.getInvitation(request.params.token);
    if (!details) return reply.status(404).send({ error: 'Invitation not found or expired' });
    return details;
  });

  // POST /api/invitations/:token/accept — accept invitation
  app.post<{ Params: { token: string } }>(
    '/api/invitations/:token/accept',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const result = await app.invitationService.acceptInvitation(request.params.token, request.userId!);
      if ('error' in result) return reply.status(result.status).send({ error: result.error });
      return result;
    },
  );
}
