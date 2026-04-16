import type { App } from '../index.js';
import { Type } from '@fastify/type-provider-typebox';
import { requireAuth } from '../middleware/auth.js';
import { hubClient } from '../services/hub-client.js';
import { chat } from '../services/ai.js';
import { AI, RATE_LIMITS } from '../constants.js';

const historyItemSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  content: Type.String(),
}, { additionalProperties: false });

const chatBodySchema = Type.Object({
  message: Type.String(),
  history: Type.Optional(Type.Array(historyItemSchema)),
}, { additionalProperties: false });

export async function aiRoutes(app: App): Promise<void> {
  // GET /api/hub/status — check Hub connectivity
  app.get('/api/hub/status', {
    preHandler: [requireAuth],
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            configured: { type: 'boolean' },
            ai: {
              type: 'object',
              properties: { connected: { type: 'boolean' } },
            },
            email: {
              type: 'object',
              properties: { connected: { type: 'boolean' } },
            },
          },
        },
      },
    },
  }, async () => {
    const configured = hubClient.isConfigured;

    let aiConnected = false;
    let emailConnected = false;

    if (configured) {
      try {
        await hubClient.request('GET', '/hub/ai/v1/models');
        aiConnected = true;
      } catch { /* not connected */ }

      try {
        // Email hub doesn't have a status endpoint, so we just check if it's configured
        emailConnected = true;
      } catch { /* not connected */ }
    }

    return {
      configured,
      ai: { connected: aiConnected },
      email: { connected: emailConnected },
    };
  });

  // POST /api/ai/chat/stream — SSE streaming proxy to AI Hub
  app.post(
    '/api/ai/chat/stream',
    {
      bodyLimit: 1 * 1024 * 1024,
      config: {
        rateLimit: {
          ...RATE_LIMITS.AI_CHAT,
          keyGenerator: (request: { ip: string }) => request.ip,
        },
      },
      schema: {
        body: chatBodySchema,
        response: {
          400: { type: 'object', properties: { error: { type: 'string' } } },
          503: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!hubClient.isConfigured) {
        return reply.status(503).send({ error: 'AI Hub not configured' });
      }

      const { message, history = [] } = request.body;

      if (!message || message.trim().length === 0) {
        return reply.status(400).send({ error: 'Message is required' });
      }
      if (message.length > AI.MAX_MESSAGE_LENGTH) {
        return reply.status(400).send({ error: 'Message too long', maxLength: AI.MAX_MESSAGE_LENGTH });
      }
      if (history.length > AI.MAX_HISTORY_MESSAGES) {
        return reply.status(400).send({ error: 'History too long' });
      }

      const messages = [
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: message },
      ];

      reply.hijack();
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders();

      try {
        const response = await chat(messages);
        reply.raw.write(`data: ${JSON.stringify({ token: response.reply, done: true })}\n\n`);
      } catch {
        reply.raw.write(`data: ${JSON.stringify({ error: 'AI service error' })}\n\n`);
      } finally {
        reply.raw.end();
      }
    },
  );

  // POST /api/ai/chat — proxy to AI Hub
  app.post(
    '/api/ai/chat',
    {
      bodyLimit: 1 * 1024 * 1024, // 1 MB — chat history may be large
      config: {
        rateLimit: {
          ...RATE_LIMITS.AI_CHAT,
          keyGenerator: (request: { ip: string }) => request.ip,
        },
      },
      schema: {
        body: chatBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              reply: { type: 'string' },
              model: { type: 'string' },
            },
          },
          400: { type: 'object', properties: { error: { type: 'string' }, maxLength: { type: 'number' } } },
          503: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!hubClient.isConfigured) {
        return reply.status(503).send({ error: 'AI Hub not configured' });
      }

      const { message, history = [] } = request.body;

      if (!message || message.trim().length === 0) {
        return reply.status(400).send({ error: 'Message is required' });
      }
      if (message.length > AI.MAX_MESSAGE_LENGTH) {
        return reply.status(400).send({ error: 'Message too long', maxLength: AI.MAX_MESSAGE_LENGTH });
      }
      if (history.length > AI.MAX_HISTORY_MESSAGES) {
        return reply.status(400).send({ error: 'History too long' });
      }

      const messages = [
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: message },
      ];

      const response = await chat(messages);
      return { reply: response.reply, model: response.model };
    },
  );
}
