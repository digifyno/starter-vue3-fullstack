import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { hubClient } from '../services/hub-client.js';
import { chat } from '../services/ai.js';

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/hub/status — check Hub connectivity
  app.get('/api/hub/status', async () => {
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

  // POST /api/ai/chat — proxy to AI Hub
  app.post<{ Body: { message: string; history?: Array<{ role: string; content: string }> } }>(
    '/api/ai/chat',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!hubClient.isConfigured) {
        return reply.status(503).send({ error: 'AI Hub not configured' });
      }

      const { message, history = [] } = request.body;
      if (!message) return reply.status(400).send({ error: 'Message required' });

      const messages = [
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: message },
      ];

      const response = await chat(messages);
      return { reply: response.reply, model: response.model };
    },
  );
}
