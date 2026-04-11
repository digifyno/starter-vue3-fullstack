import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

vi.mock('../database.js', () => ({
  queryOne: vi.fn(),
}));

const { resolveOrg } = await import('./org-context.js');
const { queryOne } = await import('../database.js');

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeReply(): { statusCode: number | null; body: unknown; status: (code: number) => { send: (body: unknown) => void }; _sent: boolean } {
  const reply = {
    statusCode: null as number | null,
    body: undefined as unknown,
    _sent: false,
    status(code: number) {
      reply.statusCode = code;
      return {
        send(body: unknown) {
          reply.body = body;
          reply._sent = true;
        },
      };
    },
  };
  return reply;
}

describe('resolveOrg', () => {
  let reply: ReturnType<typeof makeReply>;

  beforeEach(() => {
    reply = makeReply();
    vi.clearAllMocks();
  });

  it('returns 401 when request.userId is not set', async () => {
    const request = makeRequest({ headers: { 'x-organization-id': 'org-1' } });
    await resolveOrg(request, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as any).error).toBe('Authentication required');
  });

  it('returns 400 when X-Organization-Id header is missing', async () => {
    const request = makeRequest({ userId: 'u-1' } as any);
    await resolveOrg(request, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(400);
    expect((reply.body as any).error).toBe('X-Organization-Id header required');
  });

  it('returns 403 when user is not a member of the org', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    const request = makeRequest({
      userId: 'u-1',
      headers: { 'x-organization-id': 'org-1' },
    } as any);
    await resolveOrg(request, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as any).error).toBe('Not a member of this organization');
  });

  it('sets organizationId and orgRole on a valid membership', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ role: 'member' } as any);
    const request = makeRequest({
      userId: 'u-1',
      headers: { 'x-organization-id': 'org-42' },
    } as any);
    await resolveOrg(request, reply as unknown as FastifyReply);
    expect(reply._sent).toBe(false);
    expect(request.organizationId).toBe('org-42');
    expect(request.orgRole).toBe('member');
  });

  it.each(['owner', 'admin', 'member', 'viewer'] as const)(
    'passes through with correct orgRole for role "%s"',
    async (role) => {
      vi.mocked(queryOne).mockResolvedValueOnce({ role } as any);
      const request = makeRequest({
        userId: 'u-1',
        headers: { 'x-organization-id': 'org-1' },
      } as any);
      await resolveOrg(request, reply as unknown as FastifyReply);
      expect(reply._sent).toBe(false);
      expect(request.orgRole).toBe(role);
    },
  );
});
