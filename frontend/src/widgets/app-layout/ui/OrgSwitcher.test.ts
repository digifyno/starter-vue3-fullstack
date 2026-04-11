import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import OrgSwitcher from './OrgSwitcher.vue';

const { mockSwitchOrg } = vi.hoisted(() => ({
  mockSwitchOrg: vi.fn(),
}));

vi.mock('@/entities/org/model/use-organization.js', () => ({
  useOrganization: () => ({
    currentOrg: { value: { id: 'org-1', name: 'Acme Corp' }, __v_isRef: true },
    organizations: {
      value: [
        { id: 'org-1', name: 'Acme Corp' },
        { id: 'org-2', name: 'Beta LLC' },
        { id: 'org-3', name: 'Gamma Inc' },
      ],
      __v_isRef: true,
    },
    switchOrg: mockSwitchOrg,
  }),
}));

function mountSwitcher() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const wrapper = mount(OrgSwitcher, { attachTo: div });
  return { wrapper, div };
}

describe('OrgSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders trigger with aria-haspopup="listbox" and aria-expanded="false" when closed', () => {
    const { wrapper, div } = mountSwitcher();
    const btn = wrapper.find('button');
    expect(btn.attributes('aria-haspopup')).toBe('listbox');
    expect(btn.attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
    div.remove();
  });

  it('opens dropdown on trigger click and sets aria-expanded to true', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    wrapper.unmount();
    div.remove();
  });

  it('renders role="listbox" and role="option" elements when open', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    const options = wrapper.findAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0].text()).toBe('Acme Corp');
    expect(options[1].text()).toBe('Beta LLC');
    expect(options[2].text()).toBe('Gamma Inc');
    wrapper.unmount();
    div.remove();
  });

  it('active org has aria-selected="true", others have aria-selected="false"', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    const options = wrapper.findAll('[role="option"]');
    expect(options[0].attributes('aria-selected')).toBe('true');
    expect(options[1].attributes('aria-selected')).toBe('false');
    expect(options[2].attributes('aria-selected')).toBe('false');
    wrapper.unmount();
    div.remove();
  });

  it('ArrowDown moves focus to next option (tabindex)', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    // Initially focused on org-1 at index 0
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    const options = wrapper.findAll('[role="option"]');
    expect(options[0].attributes('tabindex')).toBe('-1');
    expect(options[1].attributes('tabindex')).toBe('0');
    wrapper.unmount();
    div.remove();
  });

  it('ArrowUp wraps from first option to last option', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    // Initially at index 0; ArrowUp wraps to last (index 2)
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    const options = wrapper.findAll('[role="option"]');
    expect(options[0].attributes('tabindex')).toBe('-1');
    expect(options[2].attributes('tabindex')).toBe('0');
    wrapper.unmount();
    div.remove();
  });

  it('Enter on focused option calls switchOrg and closes dropdown', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    // Navigate to org-2 (index 1)
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    const options = wrapper.findAll('[role="option"]');
    await options[1].trigger('keydown', { key: 'Enter' });
    await nextTick();
    expect(mockSwitchOrg).toHaveBeenCalledWith('org-2');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
    div.remove();
  });

  it('Space on focused option calls switchOrg and closes dropdown', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    // Navigate to org-3 (index 2)
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'ArrowDown' });
    await list.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    const options = wrapper.findAll('[role="option"]');
    await options[2].trigger('keydown', { key: ' ' });
    await nextTick();
    expect(mockSwitchOrg).toHaveBeenCalledWith('org-3');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
    div.remove();
  });

  it('Escape closes dropdown without calling switchOrg', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(mockSwitchOrg).not.toHaveBeenCalled();
    wrapper.unmount();
    div.remove();
  });

  it('Tab on list closes dropdown', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'Tab' });
    await nextTick();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
    div.remove();
  });

  it('clicking an option calls switchOrg with the correct org id', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    const options = wrapper.findAll('[role="option"]');
    await options[1].trigger('click');
    expect(mockSwitchOrg).toHaveBeenCalledWith('org-2');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
    div.remove();
  });

  it('switchOrg is not called when Escape is pressed', async () => {
    const { wrapper, div } = mountSwitcher();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    const list = wrapper.find('[role="listbox"]');
    await list.trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(mockSwitchOrg).not.toHaveBeenCalled();
    wrapper.unmount();
    div.remove();
  });
});
