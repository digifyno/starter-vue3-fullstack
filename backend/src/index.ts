import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { organizationRoutes } from './routes/organizations.js';
import { invitationRoutes } from './routes/invitations.js';
import { healthRoutes } from './routes/health.js';
import { aiRoutes } from './routes/ai.js';
import { optionalAuth } from './middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// CORS for dev (frontend on different port)
await app.register(fastifyCors, {
  origin: config.nodeEnv === 'development' ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : false,
  credentials: true,
});

// Optional auth on all requests (populates userId if token is valid)
app.addHook('preHandler', optionalAuth);

// Register API routes
await app.register(authRoutes);
await app.register(userRoutes);
await app.register(organizationRoutes);
await app.register(invitationRoutes);
await app.register(healthRoutes);
await app.register(aiRoutes);

// Serve frontend static files in production
const frontendDist = join(__dirname, '../../frontend/dist');
await app.register(fastifyStatic, {
  root: frontendDist,
  prefix: '/',
  decorateReply: true,
  wildcard: false,
});

// SPA fallback: serve index.html for non-API routes
app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.status(404).send({ error: 'Not found' });
  }
  return reply.sendFile('index.html');
});

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running at http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
