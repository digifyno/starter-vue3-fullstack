import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected idle pg client error');
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RLSContext {
  userId?: string | undefined;
  orgId?: string | undefined;
}

export async function queryWithContext<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[],
  ctx: RLSContext,
): Promise<pg.QueryResult<T>> {
  if (ctx.userId !== undefined && !UUID_REGEX.test(ctx.userId)) {
    throw new Error(`Invalid userId format: ${ctx.userId}`);
  }
  if (ctx.orgId !== undefined && !UUID_REGEX.test(ctx.orgId)) {
    throw new Error(`Invalid orgId format: ${ctx.orgId}`);
  }

  const client = await getPool().connect();
  try {
    if (ctx.userId !== undefined) {
      await client.query(`SET LOCAL app.current_user_id = '${ctx.userId}'`);
    }
    if (ctx.orgId !== undefined) {
      await client.query(`SET LOCAL app.current_org_id = '${ctx.orgId}'`);
    }
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}
