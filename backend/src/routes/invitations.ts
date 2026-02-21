import { randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import { sendInvitation } from '../services/email.js';
import type { Invitation, User, Organization } from '../types.js';

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/invitations — send invitation
  app.post<{ Body: { email: string; role?: string } }>(
    '/api/invitations',
    { preHandler: [requireAuth, resolveOrg] },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const { email, role = 'member' } = request.body;
      if (!email) return reply.status(400).send({ error: 'Email required' });

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await query(
        `INSERT INTO invitations (organization_id, email, role, token, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [request.organizationId, email.toLowerCase(), role, token, request.userId, expiresAt.toISOString()],
      );

      // Send invitation email
      const inviter = await queryOne<User>('SELECT name FROM users WHERE id = $1', [request.userId]);
      const org = await queryOne<Organization>('SELECT name FROM organizations WHERE id = $1', [request.organizationId]);
      const link = `${request.protocol}://${request.hostname}/invite/${token}`;

      await sendInvitation(email, org?.name || 'the organization', inviter?.name || 'Someone', link);

      return { message: 'Invitation sent' };
    },
  );

  // GET /api/invitations/:token — get invitation details
  app.get<{ Params: { token: string } }>('/api/invitations/:token', async (request, reply) => {
    const invitation = await queryOne<Invitation & { org_name: string }>(
      `SELECT i.*, o.name as org_name FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()`,
      [request.params.token],
    );

    if (!invitation) return reply.status(404).send({ error: 'Invitation not found or expired' });

    return {
      email: invitation.email,
      role: invitation.role,
      organization: invitation.org_name,
      expires_at: invitation.expires_at,
    };
  });

  // POST /api/invitations/:token/accept — accept invitation
  app.post<{ Params: { token: string } }>(
    '/api/invitations/:token/accept',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const invitation = await queryOne<Invitation>(
        `SELECT * FROM invitations WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
        [request.params.token],
      );

      if (!invitation) return reply.status(404).send({ error: 'Invitation not found or expired' });

      // Check if already a member
      const existing = await queryOne(
        'SELECT id FROM org_memberships WHERE user_id = $1 AND organization_id = $2',
        [request.userId, invitation.organization_id],
      );
      if (existing) return reply.status(409).send({ error: 'Already a member of this organization' });

      // Add membership
      await query(
        'INSERT INTO org_memberships (user_id, organization_id, role, invited_by) VALUES ($1, $2, $3, $4)',
        [request.userId, invitation.organization_id, invitation.role, invitation.invited_by],
      );

      // Mark invitation as accepted
      await query('UPDATE invitations SET accepted_at = NOW() WHERE id = $1', [invitation.id]);

      return { message: 'Invitation accepted' };
    },
  );
}
