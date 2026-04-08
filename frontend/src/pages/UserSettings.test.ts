import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import UserSettingsPage from '@/features/user-settings/ui/UserSettingsPage.vue';

const { mockApiGet, mockApiPut, mockApiDelete, mockFetchUser, mockRegisterPasskey } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPut: vi.fn(),
  mockApiDelete: vi.fn(),
  mockFetchUser: vi.fn(),
  mockRegisterPasskey: vi.fn(),
}));

vi.mock('@/shared/api/index.js', () => ({
  api: {
    get: mockApiGet,
    post: vi.fn(),
    put: mockApiPut,
    delete: mockApiDelete,
  },
}));

vi.mock('@/entities/user/model/use-auth.js', () => ({
  useAuth: () => ({
    user: {
      value: { id: '1', email: 'alice@example.com', name: 'Alice', avatar_url: null, email_verified: true },
      __v_isRef: true,
    },
    organizations: { value: [], __v_isRef: true },
    isLoggedIn: { value: true, __v_isRef: true },
    login: vi.fn(),
    register: vi.fn(),
    verifyPin: vi.fn(),
    loginWithPasskey: vi.fn(),
    registerPasskey: mockRegisterPasskey,
    fetchUser: mockFetchUser,
    logout: vi.fn(),
    switchOrg: vi.fn(),
  }),
}));

vi.mock('@/shared/composables/useDarkMode.js', () => ({
  useDarkMode: () => ({
    isDark: { value: false, __v_isRef: true },
    toggle: vi.fn(),
  }),
}));

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings', component: { template: '<div>Settings</div>' } }],
  });
}

describe('UserSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue([]);
    // Enable passkey support in jsdom environment
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: class PublicKeyCredential {},
      writable: true,
      configurable: true,
    });
  });

  it('renders user name and email from auth store', async () => {
    const wrapper = mount(UserSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect((wrapper.find('#settings-name').element as HTMLInputElement).value).toBe('Alice');
    expect((wrapper.find('#settings-email').element as HTMLInputElement).value).toBe('alice@example.com');
  });

  it('calls PUT /users/me with updated name when save form is submitted', async () => {
    mockApiPut.mockResolvedValue({});
    mockFetchUser.mockResolvedValue(undefined);
    const wrapper = mount(UserSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('#settings-name').setValue('Bob');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockApiPut).toHaveBeenCalledWith('/users/me', expect.objectContaining({ name: 'Bob' }));
  });

  it('shows success status after successful profile save', async () => {
    mockApiPut.mockResolvedValue({});
    mockFetchUser.mockResolvedValue(undefined);
    const wrapper = mount(UserSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain('Profile updated successfully');
  });

  it('shows error alert when profile save fails', async () => {
    mockApiPut.mockRejectedValue(new Error('Network error'));
    const wrapper = mount(UserSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Failed to update profile');
  });

  it('renders passkey list when passkeys are present', async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 'pk-1',
        credential_id: 'cred-1',
        device_name: 'MacBook Pro',
        created_at: '2024-01-01T00:00:00Z',
        last_used_at: null,
        backed_up: false,
      },
    ]);
    const wrapper = mount(UserSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('MacBook Pro');
  });

  it('calls DELETE /users/me/passkeys/:id when Remove button is clicked', async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 'pk-1',
        credential_id: 'cred-1',
        device_name: 'iPhone',
        created_at: '2024-01-01T00:00:00Z',
        last_used_at: null,
        backed_up: false,
      },
    ]);
    mockApiDelete.mockResolvedValue({});
    const wrapper = mount(UserSettingsPage, {
      global: { plugins: [createTestRouter()] },
    });
    await flushPromises();
    const removeBtn = wrapper.find('button[aria-label*="Remove passkey"]');
    expect(removeBtn.exists()).toBe(true);
    await removeBtn.trigger('click');
    await flushPromises();
    const confirmBtn = wrapper.findAll('button').find(b => b.text() === 'Confirm');
    expect(confirmBtn).toBeTruthy();
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(mockApiDelete).toHaveBeenCalledWith('/users/me/passkeys/pk-1');
  });
});
