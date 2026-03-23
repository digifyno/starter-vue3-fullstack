import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import OrgSettingsPage from '@/features/org-settings/ui/OrgSettingsPage.vue';

const { mockApiGet, mockApiPut, mockApiPost, MockApiError } = vi.hoisted(() => {
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
    MockApiError,
  };
});

vi.mock('@/shared/api/index.js', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
    put: mockApiPut,
    delete: vi.fn(),
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
});
