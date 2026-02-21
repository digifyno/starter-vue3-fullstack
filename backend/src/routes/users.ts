import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import type { User } from '../types.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users/me
  app.get('/api/users/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [request.userId]);
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
    { preHandler: [requireAuth] },
    async (request) => {
      const { name, avatar_url } = request.body;
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
    { preHandler: [requireAuth] },
    async (request) => {
      const { settings } = request.body;
      await query('UPDATE users SET settings = $1 WHERE id = $2', [JSON.stringify(settings), request.userId]);
      return { message: 'Settings updated' };
    },
  );
}
