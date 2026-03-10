import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { query, queryOne } from '../database.js';

const BCRYPT_ROUNDS = 10;

export function generatePin(): string {
  return String(randomInt(100000, 999999));
}

async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

async function comparePin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export async function createPin(email: string, purpose: 'login' | 'verification'): Promise<string> {
  const pin = generatePin();
  const pinHash = await hashPin(pin);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Invalidate any existing unused PINs for this email/purpose
  await query(
    `UPDATE auth_pins SET used_at = NOW() WHERE email = $1 AND purpose = $2 AND used_at IS NULL`,
    [email, purpose],
  );

  await query(
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

  // Rate limit: max 5 attempts
  if (record.attempts >= 5) return false;

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
