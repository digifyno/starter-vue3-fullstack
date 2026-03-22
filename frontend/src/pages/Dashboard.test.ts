import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import DashboardPage from '@/features/ai-chat/ui/DashboardPage.vue';

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}));

vi.mock('@/shared/api/index.js', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/entities/user/model/use-auth.js', () => ({
  useAuth: () => ({
    user: { value: { id: '1', email: 'alice@example.com', name: 'Alice', avatar_url: null, email_verified: true }, __v_isRef: true },
    organizations: { value: [], __v_isRef: true },
    isLoggedIn: { value: true, __v_isRef: true },
    login: vi.fn(),
    verifyPin: vi.fn(),
    loginWithPasskey: vi.fn(),
    registerPasskey: vi.fn(),
    fetchUser: vi.fn(),
    logout: vi.fn(),
    switchOrg: vi.fn(),
  }),
}));

vi.mock('@/entities/org/model/use-organization.js', () => ({
  useOrganization: () => ({
    currentOrg: { value: { id: 'org-1', name: 'Acme Corp', slug: 'acme', role: 'owner' }, __v_isRef: true },
    currentOrgId: { value: 'org-1', __v_isRef: true },
    organizations: { value: [], __v_isRef: true },
    switchOrg: vi.fn(),
  }),
}));

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div>Dashboard</div>' } }],
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Hub Status and AI Assistant sections', async () => {
    mockApiGet.mockResolvedValue({
      configured: true,
      ai: { connected: true },
      email: { connected: true },
    });
    const wrapper = mount(DashboardPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Hub Status');
    expect(wrapper.text()).toContain('AI Assistant');
  });

  it('shows hub connected status after API resolves', async () => {
    mockApiGet.mockResolvedValue({
      configured: true,
      ai: { connected: true },
      email: { connected: true },
    });
    const wrapper = mount(DashboardPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Connected');
  });

  it('shows hub disconnected status when AI hub is down', async () => {
    mockApiGet.mockResolvedValue({
      configured: true,
      ai: { connected: false },
      email: { connected: false },
    });
    const wrapper = mount(DashboardPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Disconnected');
  });

  it('renders AI chat input form', async () => {
    mockApiGet.mockResolvedValue({ configured: true, ai: { connected: true }, email: { connected: true } });
    const wrapper = mount(DashboardPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.find('input[type="text"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });

  it('sends chat message and displays reply', async () => {
    mockApiGet.mockResolvedValue({ configured: true, ai: { connected: true }, email: { connected: true } });
    mockApiPost.mockResolvedValue({ reply: 'Hello from AI!' });
    const wrapper = mount(DashboardPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('input[type="text"]').setValue('Hello');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockApiPost).toHaveBeenCalledWith('/ai/chat', expect.objectContaining({ message: 'Hello' }));
    expect(wrapper.text()).toContain('Hello from AI!');
  });
});
