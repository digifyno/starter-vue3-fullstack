import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { query, queryOne } from '../database.js';
import { AUTH } from '../constants.js';

// Minimal interface for a transaction client — satisfied by pg.PoolClient
type TxClient = { query: (text: string, params?: unknown[]) => Promise<unknown> };

export function generatePin(): string {
  return String(randomInt(100000, 999999));
}

async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, AUTH.BCRYPT_ROUNDS);
}

async function comparePin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export async function createPin(
  email: string,
  purpose: 'login' | 'verification',
  client?: TxClient,
  plainPin?: string,
): Promise<string> {
  const pin = plainPin ?? generatePin();
  const pinHash = await hashPin(pin);
  const expiresAt = new Date(Date.now() + AUTH.PIN_EXPIRY_MS);

  const exec = (text: string, params?: unknown[]) =>
    client ? client.query(text, params) : query(text, params);

  // Invalidate any existing unused PINs for this email/purpose
  await exec(
    `UPDATE auth_pins SET used_at = NOW() WHERE email = $1 AND purpose = $2 AND used_at IS NULL`,
    [email, purpose],
  );

  await exec(
    `INSERT INTO auth_pins (email, pin_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [email, pinHash, purpose, expiresAt.toISOString()],
  );

  return pin;
}

export async function verifyPin(
  email: string,
  pin: string,
  purpose: 'login' | 'verification',
): Promise<boolean> {
  const record = await queryOne<{ id: string; attempts: number; pin_hash: string }>(
    `SELECT id, attempts, pin_hash FROM auth_pins
     WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );

  if (!record) return false;

  // Rate limit: max attempts
  if (record.attempts >= AUTH.PIN_MAX_ATTEMPTS) return false;

  // Increment attempts
  await query('UPDATE auth_pins SET attempts = attempts + 1 WHERE id = $1', [record.id]);

  // Check hash using bcrypt compare
  const valid = await comparePin(pin, record.pin_hash);

  if (valid) {
    // Mark as used
    await query('UPDATE auth_pins SET used_at = NOW() WHERE id = $1', [record.id]);
    return true;
  }

  return false;
}
