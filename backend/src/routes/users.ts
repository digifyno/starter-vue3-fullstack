import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import type { User, PasskeyCredential } from '../types.js';
import { SETTINGS } from '../constants.js';

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const;

function isValidHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users/me
  app.get('/api/users/me', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            avatar_url: { type: 'string', nullable: true },
            email_verified: { type: 'boolean' },
            settings: { type: 'object', additionalProperties: true },
          },
        },
        404: errorSchema,
      },
    },
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const user = await queryOne<User>('SELECT id, email, name, avatar_url, email_verified, settings, created_at, updated_at FROM users WHERE id = $1', [request.userId]);
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
  app.put<{ Body: { name?: string; avatar_url?: string } }>(
    '/api/users/me',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 255 },
            avatar_url: { type: 'string', maxLength: 2048 },
          },
          additionalProperties: false,
        },
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
      const { name, avatar_url } = request.body;

      if (avatar_url !== undefined && !isValidHttpUrl(avatar_url)) {
        return reply.status(400).send({ error: 'avatar_url must use http or https scheme' });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
      if (avatar_url !== undefined) { updates.push(`avatar_url = $${idx++}`); values.push(avatar_url); }

      if (updates.length === 0) return { message: 'No changes' };

      values.push(request.userId);
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      return { message: 'Profile updated' };
    },
  );

  // PUT /api/users/me/settings
  app.put<{ Body: { settings: Record<string, unknown> } }>(
    '/api/users/me/settings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['settings'],
          properties: {
            settings: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
        },
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
      const { settings } = request.body;
      if (JSON.stringify(settings).length > SETTINGS.MAX_SIZE_BYTES) {
        return reply.status(400).send({ error: 'Settings payload too large' });
      }
      await query('UPDATE users SET settings = $1 WHERE id = $2', [JSON.stringify(settings), request.userId]);
      return { message: 'Settings updated' };
    },
  );

  // GET /api/users/me/passkeys — list user's passkey credentials
  app.get('/api/users/me/passkeys', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              credential_id: { type: 'string' },
              device_name: { type: 'string', nullable: true },
              created_at: { type: 'string' },
              last_used_at: { type: 'string', nullable: true },
              backed_up: { type: 'boolean' },
            },
          },
        },
        401: errorSchema,
      },
    },
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.status(401).send({ error: 'Authentication required' });

    const creds = await query<PasskeyCredential>(
      'SELECT id, credential_id, device_name, created_at, last_used_at, backed_up FROM passkey_credentials WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );

    return creds.rows.map((c) => ({
      id: c.id,
      credential_id: c.credential_id,
      device_name: c.device_name,
      created_at: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
      last_used_at: c.last_used_at instanceof Date ? c.last_used_at.toISOString() : (c.last_used_at ?? null),
      backed_up: c.backed_up,
    }));
  });

  // DELETE /api/users/me/passkeys/:credentialId — delete a passkey
  app.delete<{ Params: { credentialId: string } }>(
    '/api/users/me/passkeys/:credentialId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['credentialId'],
          properties: {
            credentialId: { type: 'string' },
          },
        },
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

      const result = await query(
        'DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2',
        [credentialId, userId],
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: 'Passkey not found' });
      }

      return reply.status(204).send();
    },
  );
}
