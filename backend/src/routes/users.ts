import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import type { User } from '../types.js';
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
}
