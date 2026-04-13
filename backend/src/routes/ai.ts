import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { hubClient } from '../services/hub-client.js';
import { chat } from '../services/ai.js';
import { AI, RATE_LIMITS } from '../constants.js';

export async function aiRoutes(app: FastifyInstance): Promise<void> {
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
  app.post<{ Body: { message: string; history?: Array<{ role: string; content: string }> } }>(
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
        body: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            history: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
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
  app.post<{ Body: { message: string; history?: Array<{ role: string; content: string }> } }>(
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
        body: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            history: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              reply: { type: 'string' },
              model: { type: 'string' },
            },
          },
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
