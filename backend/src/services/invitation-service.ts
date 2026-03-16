import { randomBytes } from 'crypto';
import { queryOne, withTransaction } from '../database.js';
import { sendInvitation } from './email.js';
import { config } from '../config.js';
import { AUTH } from '../constants.js';
import type { Invitation, User, Organization } from '../types.js';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['admin', 'member', 'viewer'] as const;
type InvitationRole = typeof VALID_ROLES[number];

export type InvitationDetails = {
  email: string;
  role: string;
  organization: string;
  expires_at: string;
};

export class InvitationService {
  async sendInvite(
    orgId: string,
    inviterId: string,
    email: string,
    role: string,
  ): Promise<{ error: string; status: number } | { message: string }> {
    if (!email) return { error: 'Email required', status: 400 };
    if (!emailRegex.test(email)) return { error: 'Invalid email address', status: 400 };
    if (!VALID_ROLES.includes(role as InvitationRole)) {
      return { error: 'Invalid role. Must be one of: admin, member, viewer', status: 400 };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + AUTH.INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const inviter = await queryOne<User>('SELECT name FROM users WHERE id = $1', [inviterId]);
    const org = await queryOne<Organization>('SELECT name FROM organizations WHERE id = $1', [orgId]);
    const link = `${config.appUrl}/invite/${token}`;

    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO invitations (organization_id, email, role, token, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orgId, email.toLowerCase(), role, token, inviterId, expiresAt.toISOString()],
        );
        await sendInvitation(email, org?.name || 'the organization', inviter?.name || 'Someone', link);
      });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
        return { error: 'An invitation has already been sent to this email address', status: 409 };
      }
      throw err;
    }

    return { message: 'Invitation sent' };
  }

  async getInvitation(token: string): Promise<InvitationDetails | null> {
    const invitation = await queryOne<Invitation & { org_name: string }>(
      `SELECT i.*, o.name as org_name FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()`,
      [token],
    );

    if (!invitation) return null;

    return {
      email: invitation.email,
      role: invitation.role,
      organization: invitation.org_name,
      expires_at: invitation.expires_at,
    };
  }

  async acceptInvitation(
    token: string,
    userId: string,
  ): Promise<{ error: string; status: number } | { message: string }> {
    const result = await withTransaction(async (client) => {
      const invResult = await client.query<Invitation>(
        `SELECT * FROM invitations WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW() FOR UPDATE`,
        [token],
      );

      if (invResult.rows.length === 0) return null;

      const invitation = invResult.rows[0];
      if (!invitation) return null;

      const membershipResult = await client.query(
        `INSERT INTO org_memberships (user_id, organization_id, role, invited_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, organization_id) DO NOTHING`,
        [userId, invitation.organization_id, invitation.role, invitation.invited_by],
      );

      await client.query('UPDATE invitations SET accepted_at = NOW() WHERE id = $1', [invitation.id]);

      return { alreadyMember: membershipResult.rowCount === 0 };
    });

    if (result === null) return { error: 'Invitation not found or expired', status: 404 };

    if (result.alreadyMember) {
      return { message: 'Already a member of this organization' };
    }

    return { message: 'Invitation accepted' };
  }
}
