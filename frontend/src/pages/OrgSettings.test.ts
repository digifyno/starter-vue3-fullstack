import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
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

  describe('member removal dialog focus trap', () => {
    function mountWithBody() {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const wrapper = mount(OrgSettingsPage, {
        global: { plugins: [createTestRouter()] },
        attachTo: div,
      });
      return { wrapper, div };
    }

    it('moves focus to Cancel button when dialog opens', async () => {
      mockApiGet.mockResolvedValue([
        { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
      ]);
      const { wrapper, div } = mountWithBody();
      await flushPromises();

      await wrapper.find('button[aria-label="Remove Alice"]').trigger('click');
      await nextTick();

      const dialog = wrapper.find('[role="alertdialog"]');
      expect(dialog.exists()).toBe(true);
      const cancelBtn = dialog.find('button');
      expect(document.activeElement).toBe(cancelBtn.element);

      wrapper.unmount();
      div.remove();
    });

    it('wraps Tab from last focusable element to first', async () => {
      mockApiGet.mockResolvedValue([
        { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
      ]);
      const { wrapper, div } = mountWithBody();
      await flushPromises();

      await wrapper.find('button[aria-label="Remove Alice"]').trigger('click');
      await nextTick();

      const dialog = wrapper.find('[role="alertdialog"]');
      const buttons = dialog.findAll('button');
      const lastBtn = buttons[buttons.length - 1];
      (lastBtn.element as HTMLButtonElement).focus();

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      dialog.element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons[0].element);

      wrapper.unmount();
      div.remove();
    });

    it('wraps Shift+Tab from first focusable element to last', async () => {
      mockApiGet.mockResolvedValue([
        { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
      ]);
      const { wrapper, div } = mountWithBody();
      await flushPromises();

      await wrapper.find('button[aria-label="Remove Alice"]').trigger('click');
      await nextTick();

      const dialog = wrapper.find('[role="alertdialog"]');
      const buttons = dialog.findAll('button');
      (buttons[0].element as HTMLButtonElement).focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      dialog.element.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons[buttons.length - 1].element);

      wrapper.unmount();
      div.remove();
    });

    it('closes dialog on Escape and restores focus to trigger button', async () => {
      mockApiGet.mockResolvedValue([
        { user_id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'member' },
      ]);
      const { wrapper, div } = mountWithBody();
      await flushPromises();

      const removeBtn = wrapper.find('button[aria-label="Remove Alice"]');
      await removeBtn.trigger('click');
      await nextTick();

      expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      wrapper.find('[role="alertdialog"]').element.dispatchEvent(event);
      await nextTick();

      expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
      expect(document.activeElement).toBe(removeBtn.element);

      wrapper.unmount();
      div.remove();
    });
  });
});
