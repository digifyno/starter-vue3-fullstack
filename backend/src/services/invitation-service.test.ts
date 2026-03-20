import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationService } from './invitation-service.js';
import { AUTH } from '../constants.js';

vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  withTransaction: vi.fn().mockImplementation(async (fn: (client: any) => Promise<unknown>) => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    return fn(client);
  }),
}));

vi.mock('./email.js', () => ({
  sendInvitation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config.js', () => ({
  config: { appUrl: 'http://localhost:5173' },
}));

type MockClient = { query: ReturnType<typeof vi.fn> };
function makeMockWithTransaction(mkClient: () => MockClient) {
  return async (fn: (client: any) => Promise<unknown>) => fn(mkClient());
}

describe('InvitationService', () => {
  let service: InvitationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InvitationService();
  });

  describe('sendInvite', () => {
    it('returns error for empty email', async () => {
      const result = await service.sendInvite('org-1', 'user-1', '', 'member');
      expect(result).toEqual({ error: 'Email required', status: 400 });
    });

    it('returns error for invalid email format', async () => {
      const result = await service.sendInvite('org-1', 'user-1', 'not-an-email', 'member');
      expect(result).toEqual({ error: 'Invalid email address', status: 400 });
    });

    it('returns error for invalid role', async () => {
      const result = await service.sendInvite('org-1', 'user-1', 'test@example.com', 'superadmin');
      expect(result).toEqual({ error: 'Invalid role. Must be one of: admin, member, viewer', status: 400 });
    });

    it('returns 503 when email service throws', async () => {
      const { sendInvitation } = await import('./email.js');
      vi.mocked(sendInvitation).mockRejectedValueOnce(new Error('SMTP down'));

      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ name: 'Alice' } as any)     // inviter name lookup (first)
        .mockResolvedValueOnce({ name: 'Acme Corp' } as any); // org name lookup (second)

      const result = await service.sendInvite('org-1', 'user-1', 'test@example.com', 'member');
      expect(result).toEqual({ error: 'Email service unavailable. Please try again later.', status: 503 });
    });

    it('returns 409 when invitation already exists for that email', async () => {
      const { withTransaction } = await import('../database.js');
      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn().mockRejectedValueOnce(Object.assign(new Error('unique violation'), { code: '23505' })),
        })),
      );

      const result = await service.sendInvite('org-1', 'user-1', 'dup@example.com', 'member');
      expect(result).toEqual({ error: 'An invitation has already been sent to this email address', status: 409 });
    });

    it('sends invitation email and returns success', async () => {
      const { queryOne, withTransaction } = await import('../database.js');
      const { sendInvitation } = await import('./email.js');

      vi.mocked(queryOne)
        .mockResolvedValueOnce({ name: 'Alice' } as any)     // inviter name lookup (first)
        .mockResolvedValueOnce({ name: 'Acme Corp' } as any); // org name lookup (second)

      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        })),
      );

      const result = await service.sendInvite('org-1', 'user-1', 'new@example.com', 'admin');
      expect(result).toEqual({ message: 'Invitation sent' });
      expect(vi.mocked(sendInvitation)).toHaveBeenCalledWith(
        'new@example.com',
        expect.any(String),
        expect.any(String),
        expect.stringContaining('/invite/'),
      );
    });

    it('normalizes email to lowercase before storing', async () => {
      const { queryOne, withTransaction } = await import('../database.js');

      vi.mocked(queryOne)
        .mockResolvedValueOnce({ name: 'Inviter' } as any)
        .mockResolvedValueOnce({ name: 'Org' } as any);

      let storedEmail: string | undefined;
      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
            storedEmail = params[1] as string;
            return { rows: [], rowCount: 1 };
          }),
        })),
      );

      await service.sendInvite('org-1', 'user-1', 'UPPER@EXAMPLE.COM', 'member');
      expect(storedEmail).toBe('upper@example.com');
    });
  });

  describe('getInvitation', () => {
    it('returns null when token is not found or expired', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await service.getInvitation('nonexistent-token');
      expect(result).toBeNull();
    });

    it('returns invitation details for a valid token', async () => {
      const { queryOne } = await import('../database.js');
      const expiresAt = new Date(Date.now() + AUTH.INVITATION_TTL_MS).toISOString();
      vi.mocked(queryOne).mockResolvedValueOnce({
        email: 'invited@example.com',
        role: 'member',
        expires_at: expiresAt,
        org_name: 'Acme Corp',
      } as any);

      const result = await service.getInvitation('valid-token');
      expect(result).toEqual({
        email: 'invited@example.com',
        role: 'member',
        organization: 'Acme Corp',
        expires_at: expiresAt,
      });
    });

    it('returns null for already-accepted invitations (SQL filters accepted_at IS NULL)', async () => {
      const { queryOne } = await import('../database.js');
      // The SQL query includes "AND i.accepted_at IS NULL" — accepted invitations return null
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await service.getInvitation('accepted-token');
      expect(result).toBeNull();
    });
  });

  describe('acceptInvitation', () => {
    it('returns 404 when token is not found or expired', async () => {
      const { withTransaction } = await import('../database.js');
      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
        })),
      );

      const result = await service.acceptInvitation('bad-token', 'user-123');
      expect(result).toEqual({ error: 'Invitation not found or expired', status: 404 });
    });

    it('returns "already a member" message when user already belongs to the org', async () => {
      const { withTransaction } = await import('../database.js');
      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn()
            .mockResolvedValueOnce({
              rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'member', invited_by: 'admin-1' }],
              rowCount: 1,
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ON CONFLICT DO NOTHING — row already existed
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }), // UPDATE accepted_at
        })),
      );

      const result = await service.acceptInvitation('dup-token', 'user-123');
      expect(result).toEqual({ message: 'Already a member of this organization' });
    });

    it('creates org membership and marks invitation accepted on success', async () => {
      const { withTransaction } = await import('../database.js');
      let capturedMembershipInsert: unknown[] = [];
      let capturedUpdateParams: unknown[] = [];

      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn()
            .mockResolvedValueOnce({
              rows: [{ id: 'inv-1', organization_id: 'org-1', role: 'admin', invited_by: 'admin-1' }],
              rowCount: 1,
            })
            .mockImplementationOnce(async (_sql: string, params: unknown[]) => {
              capturedMembershipInsert = params;
              return { rows: [{}], rowCount: 1 };
            })
            .mockImplementationOnce(async (_sql: string, params: unknown[]) => {
              capturedUpdateParams = params;
              return { rows: [], rowCount: 1 };
            }),
        })),
      );

      const result = await service.acceptInvitation('valid-token', 'user-456');
      expect(result).toEqual({ message: 'Invitation accepted' });
      expect(capturedMembershipInsert).toContain('user-456');
      expect(capturedMembershipInsert).toContain('org-1');
      expect(capturedMembershipInsert).toContain('admin');
      expect(capturedUpdateParams).toContain('inv-1');
    });

    it('expired invitation (SQL boundary) returns 404', async () => {
      // The SQL query uses `expires_at > NOW() FOR UPDATE` — expired invitations return no rows
      const { withTransaction } = await import('../database.js');
      vi.mocked(withTransaction).mockImplementationOnce(
        makeMockWithTransaction(() => ({
          query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
        })),
      );

      const result = await service.acceptInvitation('expired-token', 'user-123');
      expect(result).toEqual({ error: 'Invitation not found or expired', status: 404 });
    });
  });
});
