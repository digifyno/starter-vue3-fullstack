import { query, queryOne } from '../database.js';
import { SETTINGS } from '../constants.js';
import type { User, PasskeyCredential } from '../types.js';

function isValidHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export class UserService {
  async getUser(userId: string): Promise<User | null> {
    return queryOne<User>(
      'SELECT id, email, name, avatar_url, email_verified, settings, created_at, updated_at FROM users WHERE id = $1',
      [userId],
    );
  }

  async updateUser(
    userId: string,
    updates: { name?: string; avatar_url?: string },
  ): Promise<{ error: string; status: number } | { message: string }> {
    const { name, avatar_url } = updates;

    if (avatar_url !== undefined && !isValidHttpUrl(avatar_url)) {
      return { error: 'avatar_url must use http or https scheme', status: 400 };
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(name); }
    if (avatar_url !== undefined) { setClauses.push(`avatar_url = $${idx++}`); values.push(avatar_url); }

    if (setClauses.length === 0) return { message: 'No changes' };

    values.push(userId);
    await query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);
    return { message: 'Profile updated' };
  }

  async updateUserSettings(
    userId: string,
    settings: Record<string, unknown>,
  ): Promise<{ error: string; status: number } | { message: string }> {
    if (JSON.stringify(settings).length > SETTINGS.MAX_SIZE_BYTES) {
      return { error: 'Settings payload too large', status: 400 };
    }
    await query('UPDATE users SET settings = $1 WHERE id = $2', [JSON.stringify(settings), userId]);
    return { message: 'Settings updated' };
  }

  async listPasskeys(userId: string): Promise<PasskeyCredential[]> {
    const result = await query<PasskeyCredential>(
      'SELECT id, credential_id, device_name, created_at, last_used_at, backed_up FROM passkey_credentials WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows;
  }

  async deletePasskey(credentialId: string, userId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2',
      [credentialId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
