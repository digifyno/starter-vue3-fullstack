import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import InviteAcceptPage from '@/features/invitations/ui/InviteAcceptPage.vue';

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
    user: {
      value: { id: '1', email: 'alice@example.com', name: 'Alice' },
      __v_isRef: true,
    },
    isLoggedIn: { value: true, __v_isRef: true },
    organizations: { value: [], __v_isRef: true },
    login: vi.fn(),
    register: vi.fn(),
    verifyPin: vi.fn(),
    loginWithPasskey: vi.fn(),
    registerPasskey: vi.fn(),
    fetchUser: vi.fn(),
    logout: vi.fn(),
    switchOrg: vi.fn(),
  }),
}));

async function createTestRouter(token = 'test-token-123') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>Home</div>' } },
      { path: '/login', component: { template: '<div>Login</div>' } },
      { path: '/register', component: { template: '<div>Register</div>' } },
      { path: '/invite/:token', component: InviteAcceptPage },
    ],
  });
  await router.push(`/invite/${token}`);
  return router;
}

describe('InviteAcceptPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while invitation details are being fetched', async () => {
    // Never resolves — keeps component in loading state
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const router = await createTestRouter();
    const wrapper = mount(InviteAcceptPage, {
      global: { plugins: [router] },
    });
    expect(wrapper.text()).toContain('Loading invitation details');
  });

  it('renders invitation organization name and role after successful fetch', async () => {
    mockApiGet.mockResolvedValue({
      email: 'alice@example.com',
      role: 'member',
      organization: 'Acme Corp',
    });
    const router = await createTestRouter();
    const wrapper = mount(InviteAcceptPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Acme Corp');
    expect(wrapper.text()).toContain('member');
  });

  it('calls POST /invitations/:token/accept when Accept button is clicked', async () => {
    mockApiGet.mockResolvedValue({
      email: 'alice@example.com',
      role: 'member',
      organization: 'Acme Corp',
    });
    mockApiPost.mockResolvedValue({});
    const router = await createTestRouter('my-invite-token');
    const wrapper = mount(InviteAcceptPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(mockApiPost).toHaveBeenCalledWith('/invitations/my-invite-token/accept');
  });

  it('redirects to home after successful invitation accept', async () => {
    mockApiGet.mockResolvedValue({
      email: 'alice@example.com',
      role: 'admin',
      organization: 'Acme Corp',
    });
    mockApiPost.mockResolvedValue({});
    const router = await createTestRouter();
    const wrapper = mount(InviteAcceptPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('shows expired/invalid error state for 404 token', async () => {
    mockApiGet.mockRejectedValue({ status: 404 });
    const router = await createTestRouter('expired-token');
    const wrapper = mount(InviteAcceptPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(wrapper.text()).toContain('expired or is no longer valid');
  });

  it('shows already-member state when API returns 409', async () => {
    mockApiGet.mockRejectedValue({ status: 409 });
    const router = await createTestRouter('existing-token');
    const wrapper = mount(InviteAcceptPage, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("already a member");
  });
});
