import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import LoginPage from '@/features/auth/ui/LoginPage.vue';

const { mockLogin, mockVerifyPin, mockLoginWithPasskey } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockLoginWithPasskey: vi.fn(),
}));

vi.mock('@/entities/user/model/use-auth.js', () => ({
  useAuth: () => ({
    user: { value: null, __v_isRef: true },
    organizations: { value: [], __v_isRef: true },
    isLoggedIn: { value: false, __v_isRef: true },
    login: mockLogin,
    verifyPin: mockVerifyPin,
    loginWithPasskey: mockLoginWithPasskey,
    registerPasskey: vi.fn(),
    fetchUser: vi.fn(),
    logout: vi.fn(),
    switchOrg: vi.fn(),
  }),
}));

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>Home</div>' } },
      { path: '/login', component: { template: '<div>Login</div>' } },
      { path: '/register', component: { template: '<div>Register</div>' } },
    ],
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email input and Sign in heading on initial load', () => {
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    expect(wrapper.find('h1').text()).toBe('Sign in');
    expect(wrapper.find('#email').exists()).toBe(true);
    expect(wrapper.find('#pin').exists()).toBe(false);
  });

  it('shows send login code submit button on email step', () => {
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    expect(wrapper.find('button[type="submit"]').text()).toContain('Send login code');
  });

  it('transitions to PIN step after successful email submission', async () => {
    mockLogin.mockResolvedValue(undefined);
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#email').setValue('test@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#pin').exists()).toBe(true);
    expect(wrapper.find('#email').exists()).toBe(false);
    expect(wrapper.find('button[type="submit"]').text()).toContain('Verify');
  });

  it('displays error alert when login request fails', async () => {
    mockLogin.mockRejectedValue(new Error('Failed to send PIN'));
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#email').setValue('test@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Failed to send PIN');
    // Should remain on email step
    expect(wrapper.find('#email').exists()).toBe(true);
  });

  it('calls verifyPin with correct email and PIN on PIN form submission', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockVerifyPin.mockResolvedValue(undefined);
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#email').setValue('test@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await wrapper.find('#pin').setValue('123456');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockVerifyPin).toHaveBeenCalledWith('test@example.com', '123456');
  });

  it('shows error alert when PIN verification fails', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockVerifyPin.mockRejectedValue(new Error('Invalid PIN'));
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#email').setValue('test@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await wrapper.find('#pin').setValue('000000');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Invalid PIN');
  });

  it('returns to email step when back button is clicked in PIN step', async () => {
    mockLogin.mockResolvedValue(undefined);
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#email').setValue('test@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#pin').exists()).toBe(true);
    const backButton = wrapper.findAll('button[type="button"]').find((b) =>
      b.text().includes('different email'),
    );
    expect(backButton).toBeDefined();
    await backButton!.trigger('click');
    expect(wrapper.find('#email').exists()).toBe(true);
    expect(wrapper.find('#pin').exists()).toBe(false);
  });

  it('includes a link to the register page', () => {
    const wrapper = mount(LoginPage, {
      global: { plugins: [createTestRouter()] },
    });
    expect(wrapper.find('a[href="/register"]').exists()).toBe(true);
  });
});
