import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { aiRoutes } from './ai.js';

// Mock auth middleware
vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn().mockImplementation(async (request: any) => {
    request.userId = 'user-1';
    request.userEmail = 'user@example.com';
  }),
  signToken: vi.fn().mockReturnValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
}));

// Mock hub client — start unconfigured; tests override as needed
vi.mock('../services/hub-client.js', () => ({
  hubClient: {
    isConfigured: false,
    request: vi.fn().mockResolvedValue({}),
  },
}));

// Mock AI service
vi.mock('../services/ai.js', () => ({
  chat: vi.fn().mockResolvedValue({ reply: 'Hello!', model: 'claude-3' }),
}));

describe('AI Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(aiRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  // ── GET /api/hub/status ───────────────────────────────────────────────────

  describe('GET /api/hub/status', () => {
    it('returns configured: false when hub is not configured', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = false;

      const res = await app.inject({ method: 'GET', url: '/api/hub/status' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.configured).toBe(false);
      expect(body.ai.connected).toBe(false);
      expect(body.email.connected).toBe(false);
    });

    it('returns configured: true and ai connected when hub is configured', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = true;
      vi.mocked(hubClient.request).mockResolvedValueOnce({});

      const res = await app.inject({ method: 'GET', url: '/api/hub/status' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.configured).toBe(true);
      expect(body.ai.connected).toBe(true);
      expect(body.email.connected).toBe(true);
    });

    it('returns ai.connected: false when hub request fails', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = true;
      vi.mocked(hubClient.request).mockRejectedValueOnce(new Error('Timeout'));

      const res = await app.inject({ method: 'GET', url: '/api/hub/status' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.configured).toBe(true);
      expect(body.ai.connected).toBe(false);
    });
  });

  // ── POST /api/ai/chat ─────────────────────────────────────────────────────

  describe('POST /api/ai/chat', () => {
    it('returns 401 when unauthenticated', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      vi.mocked(requireAuth).mockImplementationOnce(async (_req: any, reply: any) => {
        reply.status(401).send({ error: 'Authentication required' });
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        payload: { message: 'Hello' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 503 when hub is not configured', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = false;

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { message: 'Hello' },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toContain('Hub not configured');
    });

    it('returns 400 when message is missing', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = true;

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Message is required');
    });
    it('returns 400 when message is whitespace-only', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = true;

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { message: '   ' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Message is required');
    });

    it('returns 400 when message exceeds 4000 characters', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = true;

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { message: 'a'.repeat(4001) },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Message too long');
      expect(body.maxLength).toBe(4000);
    });

    it('returns 400 when history exceeds 50 items', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      vi.mocked(hubClient as any).isConfigured = true;

      const bigHistory = Array.from({ length: 51 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { message: 'Hello', history: bigHistory },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('History too long');
    });

    it('returns reply when hub is configured and message provided', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      const { chat } = await import('../services/ai.js');
      vi.mocked(hubClient as any).isConfigured = true;
      vi.mocked(chat).mockResolvedValueOnce({ reply: 'Hello!', model: 'claude-3' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: { message: 'Hello' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.reply).toBe('Hello!');
      expect(body.model).toBe('claude-3');
    });

    it('passes message and history to chat service', async () => {
      const { hubClient } = await import('../services/hub-client.js');
      const { chat } = await import('../services/ai.js');
      vi.mocked(hubClient as any).isConfigured = true;
      vi.mocked(chat).mockResolvedValueOnce({ reply: 'Got it', model: 'claude-3' });

      await app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { Authorization: 'Bearer mock-token' },
        payload: {
          message: 'What is 2+2?',
          history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }],
        },
      });

      expect(vi.mocked(chat)).toHaveBeenCalledWith([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'What is 2+2?' },
      ]);
    });
  });
});

describe('AI chat history edge cases', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(aiRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('handles a 1000-item history array without returning 500', async () => {
    const { hubClient } = await import('../services/hub-client.js');
    const { chat } = await import('../services/ai.js');
    vi.mocked(hubClient as any).isConfigured = true;
    vi.mocked(chat).mockResolvedValueOnce({ reply: 'Processed large history', model: 'claude-3' });

    const bigHistory = Array.from({ length: 1000 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: { Authorization: 'Bearer mock-token' },
      payload: { message: 'What is the summary?', history: bigHistory },
    });

    // Must not crash the server — either 200 (passes through) or 400 (validated limit)
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('History too long');
  });

  it('passes all history items to the chat service unchanged', async () => {
    const { hubClient } = await import('../services/hub-client.js');
    const { chat } = await import('../services/ai.js');
    vi.mocked(hubClient as any).isConfigured = true;
    vi.mocked(chat).mockResolvedValueOnce({ reply: 'ok', model: 'claude-3' });

    const history = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));

    await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: { Authorization: 'Bearer mock-token' },
      payload: { message: 'final', history },
    });

    const callArgs = vi.mocked(chat).mock.calls[0]![0]!;
    // All 50 history items + 1 new message = 51 total
    expect(callArgs).toHaveLength(51);
    expect(callArgs[50]).toEqual({ role: 'user', content: 'final' });
  });
});
