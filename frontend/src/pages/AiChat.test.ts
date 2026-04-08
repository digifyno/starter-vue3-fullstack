import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AiChatPage from '@/features/ai-chat/ui/AiChatPage.vue';

const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
}));

vi.mock('@/shared/api/index.js', () => ({
  api: {
    get: vi.fn(),
    post: mockApiPost,
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('AiChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement scrollTo; stub it to prevent unhandled rejections
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  });

  it('renders heading and empty conversation placeholder', () => {
    const wrapper = mount(AiChatPage);
    expect(wrapper.find('h2').text()).toBe('AI Chat');
    expect(wrapper.text()).toContain('Start a conversation with the AI assistant');
  });

  it('submit button is disabled when input is empty', () => {
    const wrapper = mount(AiChatPage);
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  it('submit button is enabled after typing a message', async () => {
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hello');
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
  });

  it('calls POST /ai/chat with message and empty history on first send', async () => {
    mockApiPost.mockResolvedValue({ reply: 'Hi!' });
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hello AI');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockApiPost).toHaveBeenCalledWith('/ai/chat', {
      message: 'Hello AI',
      history: [],
    });
  });

  it('displays assistant reply after successful API response', async () => {
    mockApiPost.mockResolvedValue({ reply: 'Hello from the assistant!' });
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hi');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Hello from the assistant!');
  });

  it('shows error message in chat when API call fails', async () => {
    mockApiPost.mockRejectedValue(new Error('Service unavailable'));
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hello');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Unable to reach AI. Please try again.');
  });

  it('submit button is disabled when over 4000 chars', async () => {
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('a'.repeat(4001));
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  it('shows over-limit alert when message exceeds 4000 chars', async () => {
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('a'.repeat(4001));
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('Message is too long');
  });

  it('shows near-limit warning when message is >= 90% of 4000 chars', async () => {
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('a'.repeat(3601));
    expect(wrapper.text()).toContain('Approaching limit');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('character counter updates when typing', async () => {
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('hello');
    expect(wrapper.find('#chat-char-count').text()).toContain('5 / 4000');
  });

  it('clears input field after submitting a message', async () => {
    mockApiPost.mockResolvedValue({ reply: 'Response' });
    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('My message');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
});
