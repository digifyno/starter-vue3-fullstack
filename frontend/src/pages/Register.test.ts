import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import RegisterPage from '@/features/auth/ui/RegisterPage.vue';

const { mockRegister, mockVerifyPin } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockVerifyPin: vi.fn(),
}));

vi.mock('@/entities/user/model/use-auth.js', () => ({
  useAuth: () => ({
    user: { value: null, __v_isRef: true },
    organizations: { value: [], __v_isRef: true },
    isLoggedIn: { value: false, __v_isRef: true },
    login: vi.fn(),
    register: mockRegister,
    verifyPin: mockVerifyPin,
    loginWithPasskey: vi.fn(),
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

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders name and email fields with Create account heading', () => {
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    expect(wrapper.find('h1').text()).toBe('Create account');
    expect(wrapper.find('#name').exists()).toBe(true);
    expect(wrapper.find('#reg-email').exists()).toBe(true);
  });

  it('shows create account submit button on info step', () => {
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    expect(wrapper.find('button[type="submit"]').text()).toContain('Create account');
  });

  it('calls register with email and name on form submission', async () => {
    mockRegister.mockResolvedValue(undefined);
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#name').setValue('Alice');
    await wrapper.find('#reg-email').setValue('alice@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockRegister).toHaveBeenCalledWith('alice@example.com', 'Alice');
  });

  it('transitions to PIN step after successful registration', async () => {
    mockRegister.mockResolvedValue(undefined);
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#name').setValue('Alice');
    await wrapper.find('#reg-email').setValue('alice@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#reg-pin').exists()).toBe(true);
    expect(wrapper.find('#name').exists()).toBe(false);
    expect(wrapper.find('button[type="submit"]').text()).toContain('Verify email');
  });

  it('displays error alert when registration fails', async () => {
    mockRegister.mockRejectedValue(new Error('Email already in use'));
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#name').setValue('Alice');
    await wrapper.find('#reg-email').setValue('alice@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Email already in use');
  });

  it('calls verifyPin with verification purpose on PIN submission', async () => {
    mockRegister.mockResolvedValue(undefined);
    mockVerifyPin.mockResolvedValue(undefined);
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    await wrapper.find('#name').setValue('Alice');
    await wrapper.find('#reg-email').setValue('alice@example.com');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await wrapper.find('#reg-pin').setValue('654321');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockVerifyPin).toHaveBeenCalledWith('alice@example.com', '654321', 'verification');
  });

  it('includes a link to the login page', () => {
    const wrapper = mount(RegisterPage, {
      global: { plugins: [createTestRouter()] },
    });
    expect(wrapper.find('a[href="/login"]').exists()).toBe(true);
  });
});
