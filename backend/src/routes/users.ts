import type { App } from '../index.js';
import { Type } from '@fastify/type-provider-typebox';
import { requireAuth } from '../middleware/auth.js';
import { RATE_LIMITS } from '../constants.js';

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const;

export async function userRoutes(app: App): Promise<void> {
  // GET /api/users/me
  app.get('/api/users/me', {
    schema: {
      response: {
        200: Type.Object({
          id: Type.String(),
          email: Type.String(),
          name: Type.String(),
          avatar_url: Type.Union([Type.String(), Type.Null()]),
          email_verified: Type.Boolean(),
          settings: Type.Record(Type.String(), Type.Unknown()),
        }),
        404: errorSchema,
      },
    },
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const user = await app.userService.getUser(request.userId!);
    if (!user) return reply.status(404).send({ error: 'User not found' });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      email_verified: user.email_verified,
      settings: user.settings,
    };
  });

  // PUT /api/users/me
  app.put(
    '/api/users/me',
    {
      config: { rateLimit: RATE_LIMITS.USER_UPDATE },
      schema: {
        body: Type.Object({
          name: Type.Optional(Type.String({ maxLength: 255 })),
          avatar_url: Type.Optional(Type.String({ maxLength: 2048 })),
        }, { additionalProperties: false }),
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const result = await app.userService.updateUser(request.userId!, request.body);
      if ('error' in result) return reply.status(result.status as 400).send({ error: result.error });
      return result;
    },
  );

  // PUT /api/users/me/settings
  app.put(
    '/api/users/me/settings',
    {
      config: { rateLimit: RATE_LIMITS.USER_UPDATE },
      schema: {
        body: Type.Object({
          settings: Type.Record(Type.String(), Type.Unknown()),
        }, { additionalProperties: false }),
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const result = await app.userService.updateUserSettings(request.userId!, request.body.settings);
      if ('error' in result) return reply.status(result.status as 400).send({ error: result.error });
      return result;
    },
  );

  // GET /api/users/me/passkeys — list user's passkey credentials
  app.get('/api/users/me/passkeys', {
    schema: {
      response: {
        200: Type.Array(Type.Object({
          id: Type.String(),
          credential_id: Type.String(),
          device_name: Type.Union([Type.String(), Type.Null()]),
          created_at: Type.String(),
          last_used_at: Type.Union([Type.String(), Type.Null()]),
          backed_up: Type.Boolean(),
        })),
        401: errorSchema,
      },
    },
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.status(401).send({ error: 'Authentication required' });

    const creds = await app.userService.listPasskeys(userId);
    return creds.map((c) => ({
      id: c.id,
      credential_id: c.credential_id,
      device_name: c.device_name,
      created_at: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
      last_used_at: c.last_used_at instanceof Date ? c.last_used_at.toISOString() : (c.last_used_at ?? null),
      backed_up: c.backed_up,
    }));
  });

  // DELETE /api/users/me/passkeys/:credentialId — delete a passkey
  app.delete(
    '/api/users/me/passkeys/:credentialId',
    {
      config: { rateLimit: RATE_LIMITS.PASSKEY_DELETE },
      schema: {
        params: Type.Object({
          credentialId: Type.String(),
        }),
        response: {
          204: { type: 'null' },
          401: errorSchema,
          404: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) return reply.status(401).send({ error: 'Authentication required' });

      const { credentialId } = request.params;
      const deleted = await app.userService.deletePasskey(credentialId, userId);
      if (!deleted) return reply.status(404).send({ error: 'Passkey not found' });

      return reply.status(204).send(null);
    },
  );
}
