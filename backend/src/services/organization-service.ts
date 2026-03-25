import { query, queryOne, queryWithContext, buildUpdateClause } from '../database.js';
import { SETTINGS } from '../constants.js';
import type { Organization, OrgMembership, User } from '../types.js';

export type OrgMember = OrgMembership & Pick<User, 'email' | 'name' | 'avatar_url'>;

function isValidHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export class OrganizationService {
  async listUserOrgs(userId: string): Promise<Array<Organization & { role: string }>> {
    const result = await queryWithContext<Organization & { role: string }>(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.settings, o.created_at, m.role FROM organizations o
       JOIN org_memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY o.name`,
      [userId],
      { userId },
    );
    return result.rows;
  }

  async createOrg(
    userId: string,
    name: string,
    slug: string,
  ): Promise<{ org: Organization; error?: never } | { org?: never; error: string; status: number }> {
    const existing = await queryOne<Organization>('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (existing) return { error: 'Organization slug already taken', status: 409 };

    const org = await queryOne<Organization>(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug, logo_url, settings, created_at',
      [name, slug],
    );
    if (!org) return { error: 'Failed to create organization', status: 500 };

    await query(
      "INSERT INTO org_memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')",
      [userId, org.id],
    );

    return { org };
  }

  async getOrgById(orgId: string, userId: string): Promise<Organization | null> {
    const result = await queryWithContext<Organization>(
      'SELECT id, name, slug, logo_url, settings, created_at FROM organizations WHERE id = $1',
      [orgId],
      { userId, orgId },
    );
    return result.rows[0] ?? null;
  }

  async updateOrg(
    orgId: string,
    userId: string,
    updates: { name?: string; logo_url?: string; settings?: Record<string, unknown> },
  ): Promise<{ error: string; status: number } | { message: string }> {
    const { name, logo_url, settings } = updates;

    if (name !== undefined && name.trim() === '') {
      return { error: 'Organization name cannot be empty', status: 400 };
    }

    if (logo_url !== undefined && !isValidHttpUrl(logo_url)) {
      return { error: 'logo_url must use http or https scheme', status: 400 };
    }

    if (settings !== undefined && JSON.stringify(settings).length > SETTINGS.MAX_SIZE_BYTES) {
      return { error: 'Settings payload too large', status: 400 };
    }

    const { setClauses, values } = buildUpdateClause({
      name,
      logo_url,
      settings: settings !== undefined ? JSON.stringify(settings) : undefined,
    });

    if (setClauses.length === 0) return { message: 'No changes' };

    values.push(orgId);
    await queryWithContext(
      `UPDATE organizations SET ${setClauses.join(', ')} WHERE id = $${setClauses.length + 1}`,
      values,
      { userId, orgId },
    );
    return { message: 'Organization updated' };
  }

  async listMembers(orgId: string, userId: string): Promise<OrgMember[]> {
    const result = await queryWithContext<OrgMember>(
      `SELECT m.id, m.user_id, m.organization_id, m.role, m.invited_by, m.joined_at, u.email, u.name, u.avatar_url FROM org_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 ORDER BY m.joined_at`,
      [orgId],
      { userId, orgId },
    );
    return result.rows;
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    callerRole?: string,
  ): Promise<{ error: string; status: number } | { message: string }> {
    const membership = await queryOne<OrgMembership>(
      'SELECT id, role FROM org_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, targetUserId],
    );
    if (!membership) return { error: 'Member not found', status: 404 };

    // Only owners can remove other owners — admins cannot demote the owner role
    if (callerRole === 'admin' && membership.role === 'owner') {
      return { error: 'Only owners can remove other owners', status: 403 };
    }

    if (membership.role === 'owner') {
      const ownerCount = await queryOne<{ count: string }>(
        "SELECT COUNT(*) AS count FROM org_memberships WHERE organization_id = $1 AND role = 'owner'",
        [orgId],
      );
      if (ownerCount && parseInt(ownerCount.count, 10) <= 1) {
        return { error: 'Cannot remove the sole owner. Transfer ownership first.', status: 400 };
      }
    }

    await query(
      'DELETE FROM org_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, targetUserId],
    );
    return { message: 'Member removed' };
  }
}
