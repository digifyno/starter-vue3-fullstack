import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient } from './hub-client.js';

vi.mock('../config.js', () => ({
  config: {
    hub: { url: 'https://hub.example.com', token: '' },
  },
}));

describe('HubClient', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── isConfigured ──────────────────────────────────────────────────────────

  describe('isConfigured', () => {
    it('returns true when a token is provided', () => {
      const client = new HubClient('https://hub.example.com', 'my-token');
      expect(client.isConfigured).toBe(true);
    });

    it('returns false when token is an empty string', () => {
      const client = new HubClient('https://hub.example.com', '');
      expect(client.isConfigured).toBe(false);
    });

    it('returns false when no token is provided and config token is empty', () => {
      const client = new HubClient();
      expect(client.isConfigured).toBe(false);
    });
  });

  // ── request ───────────────────────────────────────────────────────────────

  describe('request', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends a POST request with JSON body and Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: 'ok' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new HubClient('https://hub.example.com', 'test-token');
      const result = await client.request<{ result: string }>('POST', '/hub/ai/v1/chat', { msg: 'hello' });

      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://hub.example.com/hub/ai/v1/chat');
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Authorization']).toBe('WorkerHub test-token');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify({ msg: 'hello' }));
    });

    it('sends a GET request without a body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new HubClient('https://hub.example.com', 'test-token');
      await client.request('GET', '/hub/status');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.body).toBeUndefined();
    });

    it('throws an error when the response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new HubClient('https://hub.example.com', 'test-token');
      await expect(client.request('POST', '/hub/ai/v1/chat')).rejects.toThrow(
        'Hub API error 500: Internal Server Error',
      );
    });

    it('throws an error when the response is 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new HubClient('https://hub.example.com', 'test-token');
      await expect(client.request('GET', '/hub/nonexistent')).rejects.toThrow('Hub API error 404');
    });

    it('retries once after a 429 rate-limit response', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === 'retry-after' ? '0' : null) },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ retried: true }),
        });
      vi.stubGlobal('fetch', mockFetch);
      vi.useFakeTimers();

      const client = new HubClient('https://hub.example.com', 'test-token');
      const promise = client.request<{ retried: boolean }>('POST', '/hub/test');

      // Advance time to resolve the retry-after setTimeout
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ retried: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('defaults retry-after to 5 seconds when the header is missing', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: () => null }, // no retry-after header
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      vi.stubGlobal('fetch', mockFetch);
      vi.useFakeTimers();

      const client = new HubClient('https://hub.example.com', 'test-token');
      const promise = client.request('POST', '/hub/test');

      // 4999ms — retry should not have fired
      await vi.advanceTimersByTimeAsync(4999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance to 5000ms — retry fires
      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
