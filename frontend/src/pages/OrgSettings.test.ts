import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import OrgSettingsPage from '@/features/org-settings/ui/OrgSettingsPage.vue';

const { mockApiGet, mockApiPut, mockApiPost, mockApiDelete, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return {
    mockApiGet: vi.fn(),
    mockApiPut: vi.fn(),
    mockApiPost: vi.fn(),
    mockApiDelete: vi.fn(),
    MockApiError,
  };
});

vi.mock('@/shared/api/index.js', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
    put: mockApiPut,
    delete: mockApiDelete,
  },
  ApiError: MockApiError,
}));

vi.mock('@/entities/org/model/use-organization.js', () => ({
  useOrganization: () => ({
    currentOrg: {
      value: { id: 'org-1', name: 'Acme Corp', slug: 'acme', role: 'owner' },
      __v_isRef: true,
    },
    currentOrgId: { value: 'org-1', __v_isRef: true },
    organizations: { value: [], __v_isRef: true },
    switchOrg: vi.fn(),
  }),
}));

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/org-settings', component: { template: '<div>OrgSettings</div>' } }],
  });
}

describe('OrgSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue([]);
  });

  it('renders organization name in the name input', async () => {
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    const nameInput = wrapper.find('input[type="text"]');
    expect((nameInput.element as HTMLInputElement).value).toBe('Acme Corp');
  });

  it('renders member list with names and roles', async () => {
    mockApiGet.mockResolvedValue([
      { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'owner' },
      { user_id: 'u-2', email: 'bob@example.com', name: 'Bob', role: 'member' },
    ]);
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Alice');
    expect(wrapper.text()).toContain('Bob');
    expect(wrapper.text()).toContain('owner');
    expect(wrapper.text()).toContain('member');
  });

  it('shows empty state message when no members exist', async () => {
    mockApiGet.mockResolvedValue([]);
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('No other members yet');
  });

  it('calls POST /invitations when invite form is submitted', async () => {
    mockApiPost.mockResolvedValue({});
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue('colleague@example.com');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();
    expect(mockApiPost).toHaveBeenCalledWith('/invitations', { email: 'colleague@example.com' });
  });

  it('shows error alert when invite API fails', async () => {
    mockApiPost.mockRejectedValue(new Error('Failed to send invite'));
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue('fail@example.com');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Failed to send invite');
  });

  it('shows conflict message when inviting an existing member', async () => {
    mockApiPost.mockRejectedValue(new MockApiError('Conflict', 409));
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue('member@example.com');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('already a member');
  });

  it('shows inline confirmation when Remove button is clicked', async () => {
    mockApiGet.mockResolvedValue([
      { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
    ]);
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    const removeBtn = wrapper.find('[aria-label="Remove Alice"]');
    expect(removeBtn.exists()).toBe(true);
    await removeBtn.trigger('click');
    expect(wrapper.find('[aria-label="Confirm remove Alice"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Cancel removal"]').exists()).toBe(true);
    expect(removeBtn.exists()).toBe(false);
  });

  it('cancels removal when Cancel is clicked', async () => {
    mockApiGet.mockResolvedValue([
      { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
    ]);
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('[aria-label="Remove Alice"]').trigger('click');
    await wrapper.find('[aria-label="Cancel removal"]').trigger('click');
    expect(wrapper.find('[aria-label="Remove Alice"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Confirm remove Alice"]').exists()).toBe(false);
  });

  it('calls DELETE and removes member on confirmation', async () => {
    mockApiGet.mockResolvedValue([
      { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
      { user_id: 'u-2', email: 'bob@example.com', name: 'Bob', role: 'member' },
    ]);
    mockApiDelete.mockResolvedValue({ message: 'Member removed' });
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('[aria-label="Remove Alice"]').trigger('click');
    await wrapper.find('[aria-label="Confirm remove Alice"]').trigger('click');
    await flushPromises();
    expect(mockApiDelete).toHaveBeenCalledWith('/organizations/org-1/members/u-1');
    expect(wrapper.text()).not.toContain('Alice');
    expect(wrapper.text()).toContain('Bob');
  });

  it('announces removal outcome via ARIA live region', async () => {
    mockApiGet.mockResolvedValue([
      { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
    ]);
    mockApiDelete.mockResolvedValue({ message: 'Member removed' });
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('[aria-label="Remove Alice"]').trigger('click');
    await wrapper.find('[aria-label="Confirm remove Alice"]').trigger('click');
    await flushPromises();
    const liveRegion = wrapper.find('[role="status"][aria-live="polite"]');
    expect(liveRegion.exists()).toBe(true);
    expect(liveRegion.text()).toContain('Alice removed from organization');
  });

  it('announces failure via ARIA live region when removal fails', async () => {
    mockApiGet.mockResolvedValue([
      { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
    ]);
    mockApiDelete.mockRejectedValue(new Error('Server error'));
    const wrapper = mount(OrgSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('[aria-label="Remove Alice"]').trigger('click');
    await wrapper.find('[aria-label="Confirm remove Alice"]').trigger('click');
    await flushPromises();
    const liveRegion = wrapper.find('[role="status"][aria-live="polite"]');
    expect(liveRegion.text()).toContain('Failed to remove Alice');
  });
});
