import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AiChatPage from '@/features/ai-chat/ui/AiChatPage.vue';

function makeSseStream(events: Array<Record<string, unknown>>) {
  const lines = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
}

describe('AiChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement scrollTo; stub it to prevent unhandled rejections
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('calls POST /api/ai/chat/stream with message and empty history on first send', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([{ token: 'Hi!', done: true }]),
    });
    vi.stubGlobal('fetch', mockFetch);

    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hello AI');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai/chat/stream',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Hello AI', history: [] }),
      }),
    );
  });

  it('displays assistant reply after successful API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([{ token: 'Hello from the assistant!', done: true }]),
    }));

    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hi');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Hello from the assistant!');
  });

  it('shows error message in chat when API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Service unavailable')));

    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('Hello');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Unable to reach AI. Please try again.');
  });

  it('shows error message when server returns non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    }));

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([{ token: 'Response', done: true }]),
    }));

    const wrapper = mount(AiChatPage);
    await wrapper.find('textarea').setValue('My message');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
});
