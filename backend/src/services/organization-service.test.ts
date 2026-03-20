import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationService } from './organization-service.js';
import { SETTINGS } from '../constants.js';

vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryWithContext: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  buildUpdateClause: (fields: Record<string, unknown>, startIndex = 1) => {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = startIndex;
    for (const [col, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      setClauses.push(`${col} = $${idx++}`);
      values.push(val);
    }
    return { setClauses, values };
  },
}));

describe('OrganizationService', () => {
  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrganizationService();
  });

  describe('createOrg', () => {
    it('returns error when slug is already taken', async () => {
      const { queryOne } = await import('../database.js');
      // Simulate an existing org with the same slug
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'existing-id' } as any);

      const result = await service.createOrg('user-123', 'My Org', 'my-org');
      expect(result).toEqual({ error: 'Organization slug already taken', status: 409 });
    });

    it('assigns the creator as owner on success', async () => {
      const { queryOne, query } = await import('../database.js');
      const mockOrg = { id: 'org-123', name: 'My Org', slug: 'my-org', logo_url: null, settings: {}, created_at: new Date().toISOString() };
      vi.mocked(queryOne)
        .mockResolvedValueOnce(null)        // no existing slug
        .mockResolvedValueOnce(mockOrg as any); // INSERT returns new org

      const result = await service.createOrg('user-123', 'My Org', 'my-org');
      expect(result).toEqual({ org: mockOrg });
      // Should insert owner membership
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining("'owner'"),
        ['user-123', 'org-123'],
      );
    });

    it('returns error when org INSERT fails to return a row', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne)
        .mockResolvedValueOnce(null)   // no slug conflict
        .mockResolvedValueOnce(null);  // INSERT returns null

      const result = await service.createOrg('user-123', 'My Org', 'my-org');
      expect(result).toEqual({ error: 'Failed to create organization', status: 500 });
    });
  });

  describe('updateOrg', () => {
    it('rejects an empty name string', async () => {
      const result = await service.updateOrg('org-123', 'user-123', { name: '' });
      expect(result).toEqual({ error: 'Organization name cannot be empty', status: 400 });
    });

    it('rejects a whitespace-only name', async () => {
      const result = await service.updateOrg('org-123', 'user-123', { name: '   ' });
      expect(result).toEqual({ error: 'Organization name cannot be empty', status: 400 });
    });

    it('rejects logo_url without http/https scheme', async () => {
      const result = await service.updateOrg('org-123', 'user-123', { logo_url: 'ftp://cdn.example.com/logo.png' });
      expect(result).toEqual({ error: 'logo_url must use http or https scheme', status: 400 });
    });

    it('rejects settings payload exceeding MAX_SIZE_BYTES', async () => {
      const largeSettings = { data: 'x'.repeat(SETTINGS.MAX_SIZE_BYTES + 100) };
      const result = await service.updateOrg('org-123', 'user-123', { settings: largeSettings });
      expect(result).toEqual({ error: 'Settings payload too large', status: 400 });
    });

    it('returns no-changes when no fields are provided', async () => {
      const result = await service.updateOrg('org-123', 'user-123', {});
      expect(result).toEqual({ message: 'No changes' });
    });

    it('updates org name successfully', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const result = await service.updateOrg('org-123', 'user-123', { name: 'New Name' });
      expect(result).toEqual({ message: 'Organization updated' });
      expect(vi.mocked(queryWithContext)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE organizations SET'),
        expect.arrayContaining(['New Name', 'org-123']),
        expect.objectContaining({ userId: 'user-123', orgId: 'org-123' }),
      );
    });

    it('updates settings payload successfully', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const settings = { feature_flags: { beta: true } };
      const result = await service.updateOrg('org-123', 'user-123', { settings });
      expect(result).toEqual({ message: 'Organization updated' });
    });
  });

  describe('listUserOrgs', () => {
    it('returns empty array when user has no orgs', async () => {
      const { queryWithContext } = await import('../database.js');
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await service.listUserOrgs('user-123');
      expect(result).toEqual([]);
    });

    it('returns orgs with their roles', async () => {
      const { queryWithContext } = await import('../database.js');
      const mockOrgs = [
        { id: 'org-1', name: 'Org One', slug: 'org-one', role: 'owner' },
        { id: 'org-2', name: 'Org Two', slug: 'org-two', role: 'member' },
      ];
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: mockOrgs, rowCount: 2 } as any);

      const result = await service.listUserOrgs('user-123');
      expect(result).toEqual(mockOrgs);
    });
  });

  describe('listMembers', () => {
    it('returns members with user details', async () => {
      const { queryWithContext } = await import('../database.js');
      const mockMembers = [
        { id: 'mem-1', user_id: 'user-1', organization_id: 'org-123', role: 'owner', email: 'owner@example.com', name: 'Owner' },
        { id: 'mem-2', user_id: 'user-2', organization_id: 'org-123', role: 'member', email: 'member@example.com', name: 'Member' },
      ];
      vi.mocked(queryWithContext).mockResolvedValueOnce({ rows: mockMembers, rowCount: 2 } as any);

      const result = await service.listMembers('org-123', 'user-1');
      expect(result).toEqual(mockMembers);
    });
  });
});
