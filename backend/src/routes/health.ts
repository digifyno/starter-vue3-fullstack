import type { FastifyInstance } from 'fastify';
import { getPool } from '../database.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    let dbOk = false;
    try {
      await getPool().query('SELECT 1');
      dbOk = true;
    } catch { /* ignore */ }

    return {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbOk,
    };
  });
}
