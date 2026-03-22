import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./hub-client.js', () => ({
  hubClient: {
    isConfigured: true,
    request: vi.fn(),
  },
}));

import { chat, complete, json } from './ai.js';

describe('AI Service', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── chat ──────────────────────────────────────────────────────────────────

  describe('chat', () => {
    it('calls hub with correct endpoint and messages', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ content: 'Hello!', model: 'claude-3' });

      const messages = [{ role: 'user' as const, content: 'Hi' }];
      await chat(messages);

      expect(vi.mocked(hubClient.request)).toHaveBeenCalledWith(
        'POST',
        '/hub/ai/v1/chat',
        { messages, model: 'claude' },
      );
    });

    it('returns reply from hub response', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ content: 'Hello there!', model: 'claude-3' });

      const result = await chat([{ role: 'user', content: 'Hi' }]);

      expect(result.reply).toBe('Hello there!');
    });

    it('includes model in result when hub returns it', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({
        content: 'Hi',
        model: 'claude-3-opus',
      });

      const result = await chat([{ role: 'user', content: 'Hello' }]);

      expect(result.model).toBe('claude-3-opus');
    });

    it('omits model from result when hub does not return it', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ content: 'Hi' });

      const result = await chat([{ role: 'user', content: 'Hello' }]);

      expect('model' in result).toBe(false);
    });

    it('includes usage in result when hub returns it', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({
        content: 'Hi',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await chat([{ role: 'user', content: 'Hello' }]);

      expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    });

    it('omits usage from result when hub does not return it', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ content: 'Hi' });

      const result = await chat([{ role: 'user', content: 'Hello' }]);

      expect('usage' in result).toBe(false);
    });

    it('propagates hub errors to the caller', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockRejectedValueOnce(new Error('Hub API error 500: error'));

      await expect(chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Hub API error');
    });
  });

  // ── complete ──────────────────────────────────────────────────────────────

  describe('complete', () => {
    it('calls hub with correct endpoint and prompt', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ content: 'Summary text' });

      await complete('Summarize this');

      expect(vi.mocked(hubClient.request)).toHaveBeenCalledWith(
        'POST',
        '/hub/ai/v1/complete',
        { prompt: 'Summarize this' },
      );
    });

    it('returns the content string from hub response', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ content: 'The answer is 42' });

      const result = await complete('What is the answer?');

      expect(result).toBe('The answer is 42');
    });

    it('propagates hub errors to the caller', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockRejectedValueOnce(new Error('Hub API error 503'));

      await expect(complete('test')).rejects.toThrow('Hub API error');
    });
  });

  // ── json ──────────────────────────────────────────────────────────────────

  describe('json', () => {
    it('calls hub with correct endpoint and prompt', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ data: { name: 'Alice' } });

      await json('Extract name from: Alice Smith');

      expect(vi.mocked(hubClient.request)).toHaveBeenCalledWith(
        'POST',
        '/hub/ai/v1/json',
        { prompt: 'Extract name from: Alice Smith' },
      );
    });

    it('returns the data from hub response', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockResolvedValueOnce({ data: { items: [1, 2, 3] } });

      const result = await json<{ items: number[] }>('Extract items');

      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('propagates hub errors to the caller', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockRejectedValueOnce(new Error('Hub API error 500'));

      await expect(json('test')).rejects.toThrow('Hub API error');
    });
  });
});
