import { randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { query, queryOne, withTransaction } from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';
import { sendInvitation } from '../services/email.js';
import { config } from '../config.js';
import { AUTH, RATE_LIMITS } from '../constants.js';
import type { Invitation, User, Organization } from '../types.js';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/invitations — send invitation
  app.post<{ Body: { email: string; role?: 'admin' | 'member' | 'viewer' } }>(
    '/api/invitations',
    { preHandler: [requireAuth, resolveOrg], config: { rateLimit: RATE_LIMITS.INVITATIONS } },
    async (request, reply) => {
      if (request.orgRole !== 'owner' && request.orgRole !== 'admin') {
        return reply.status(403).send({ error: 'Admin or owner role required' });
      }

      const { email, role = 'member' } = request.body;
      if (!email) return reply.status(400).send({ error: 'Email required' });
      if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Invalid email address' });

      const validRoles = ['admin', 'member', 'viewer'] as const;
      if (role && !validRoles.includes(role as typeof validRoles[number])) {
        return reply.status(400).send({ error: 'Invalid role. Must be one of: admin, member, viewer' });
      }

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + AUTH.INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      // Fetch inviter and org before the transaction (read-only, no need to be in transaction)
      const inviter = await queryOne<User>('SELECT name FROM users WHERE id = $1', [request.userId]);
      const org = await queryOne<Organization>('SELECT name FROM organizations WHERE id = $1', [request.organizationId]);
      const link = `${config.appUrl}/invite/${token}`;

      // Insert invitation and send email atomically — rolls back if email fails
      try {
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO invitations (organization_id, email, role, token, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [request.organizationId, email.toLowerCase(), role, token, request.userId, expiresAt.toISOString()],
          );
          await sendInvitation(email, org?.name || 'the organization', inviter?.name || 'Someone', link);
        });
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.status(409).send({ error: 'An invitation has already been sent to this email address' });
        }
        throw err;
      }

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
      const result = await withTransaction(async (client) => {
        // Lock the invitation row so concurrent accepts queue behind each other
        const invResult = await client.query<Invitation>(
          `SELECT * FROM invitations WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW() FOR UPDATE`,
          [request.params.token],
        );

        if (invResult.rows.length === 0) return null;

        const invitation = invResult.rows[0];

        // Insert membership atomically; ON CONFLICT DO NOTHING handles the already-member case
        const membershipResult = await client.query(
          `INSERT INTO org_memberships (user_id, organization_id, role, invited_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, organization_id) DO NOTHING`,
          [request.userId, invitation.organization_id, invitation.role, invitation.invited_by],
        );

        // Always mark invitation accepted regardless of membership outcome
        await client.query('UPDATE invitations SET accepted_at = NOW() WHERE id = $1', [invitation.id]);

        return { alreadyMember: membershipResult.rowCount === 0 };
      });

      if (result === null) return reply.status(404).send({ error: 'Invitation not found or expired' });

      if (result.alreadyMember) {
        return { message: 'Already a member of this organization' };
      }

      return { message: 'Invitation accepted' };
    },
  );
}
