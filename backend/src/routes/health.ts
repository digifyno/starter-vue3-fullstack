import type { App } from '../index.js';
import { getPool } from '../database.js';
import { config } from '../config.js';

export async function healthRoutes(app: App): Promise<void> {
  app.get('/api/health', async () => {
    let dbOk = false;
    try {
      await getPool().query('SELECT 1');
      dbOk = true;
    } catch { /* ignore */ }

    // Verify passkey library is importable and core config is set
    let passkeyOk = false;
    let passkeyError: string | undefined;
    try {
      const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
      if (!config.rpId) throw new Error('RP_ID not configured');
      if (!config.rpName) throw new Error('RP_NAME not configured');
      // Quick smoke-test: generate options to verify library works end-to-end
      const opts = await generateAuthenticationOptions({ rpID: config.rpId, allowCredentials: [] });
      if (!opts.challenge) throw new Error('challenge generation failed');
      passkeyOk = true;
    } catch (err) {
      passkeyError = err instanceof Error ? err.message : String(err);
    }

    const allOk = dbOk && passkeyOk;
    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbOk,
      passkey: passkeyOk,
      ...(passkeyError ? { passkeyError } : {}),
    };
  });
}
