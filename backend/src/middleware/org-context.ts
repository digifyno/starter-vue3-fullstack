import type { FastifyRequest, FastifyReply } from 'fastify';
import { queryOne } from '../database.js';
import type { OrgMembership } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    organizationId?: string;
    orgRole?: string;
  }
}

export async function resolveOrg(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.userId) {
    reply.status(401).send({ error: 'Authentication required' });
    return;
  }

  const orgId = request.headers['x-organization-id'] as string;
  if (!orgId) {
    reply.status(400).send({ error: 'X-Organization-Id header required' });
    return;
  }

  const membership = await queryOne<OrgMembership>(
    'SELECT * FROM org_memberships WHERE user_id = $1 AND organization_id = $2',
    [request.userId, orgId],
  );

  if (!membership) {
    reply.status(403).send({ error: 'Not a member of this organization' });
    return;
  }

  request.organizationId = orgId;
  request.orgRole = membership.role;
}
