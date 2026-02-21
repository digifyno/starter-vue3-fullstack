import { createHash, randomInt } from 'crypto';
import { query, queryOne } from '../database.js';

export function generatePin(): string {
  return String(randomInt(100000, 999999));
}

export function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex');
}

export async function createPin(email: string, purpose: 'login' | 'verification'): Promise<string> {
  const pin = generatePin();
  const pinHash = hashPin(pin);
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
  const pinHash = hashPin(pin);

  const record = await queryOne<{ id: string; attempts: number }>(
    `SELECT id, attempts FROM auth_pins
     WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );

  if (!record) return false;

  // Rate limit: max 5 attempts
  if (record.attempts >= 5) return false;

  // Increment attempts
  await query('UPDATE auth_pins SET attempts = attempts + 1 WHERE id = $1', [record.id]);

  // Check hash
  const valid = await queryOne<{ id: string }>(
    `SELECT id FROM auth_pins
     WHERE id = $1 AND pin_hash = $2`,
    [record.id, pinHash],
  );

  if (valid) {
    // Mark as used
    await query('UPDATE auth_pins SET used_at = NOW() WHERE id = $1', [record.id]);
    return true;
  }

  return false;
}
