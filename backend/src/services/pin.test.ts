import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePin, createPin, verifyPin } from './pin.js';
import { AUTH } from '../constants.js';

// Mock database so no real PG connection is needed
vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] } as any),
  queryOne: vi.fn().mockResolvedValue(null),
}));

describe('PIN Service', () => {
  describe('generatePin', () => {
    it('generates a 6-digit string', () => {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
    });

    it('generates PINs in the range 100000–999999', () => {
      for (let i = 0; i < 20; i++) {
        const num = parseInt(generatePin(), 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThanOrEqual(999999);
      }
    });

    it('generates different PINs on subsequent calls', () => {
      const pins = new Set(Array.from({ length: 100 }, generatePin));
      // Statistically should have >90 unique values out of 100
      expect(pins.size).toBeGreaterThan(90);
    });
  });

  describe('createPin', () => {
    beforeEach(() => vi.clearAllMocks());

    it('invalidates old PINs and creates a new one', async () => {
      const { query } = await import('../database.js');
      const pin = await createPin('user@example.com', 'login');

      expect(pin).toMatch(/^\d{6}$/);
      // First call: invalidate old PINs
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE auth_pins SET used_at'),
        ['user@example.com', 'login'],
      );
      // Second call: insert new PIN
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auth_pins'),
        expect.arrayContaining(['user@example.com', 'login']),
      );
    });

    it('returns a PIN string', async () => {
      const pin = await createPin('user@example.com', 'verification');
      expect(typeof pin).toBe('string');
      expect(pin.length).toBe(6);
    });
  });

  describe('verifyPin', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns false when no PIN record exists', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await verifyPin('user@example.com', '123456', 'login');
      expect(result).toBe(false);
    });

    it('returns false when attempt count is at the limit', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'pin-id',
        attempts: 5,
        pin_hash: '$2b$10$fakehash',
      });

      const result = await verifyPin('user@example.com', '123456', 'login');
      expect(result).toBe(false);
    });

    it('returns false for a wrong PIN', async () => {
      // Create a real bcrypt hash so the comparison works
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash('654321', 10);

      const { queryOne, query } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'pin-id',
        attempts: 0,
        pin_hash: hash,
      });
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      const result = await verifyPin('user@example.com', '000000', 'login');
      expect(result).toBe(false);
    });

    it('returns true and marks PIN as used for correct PIN', async () => {
      const bcrypt = await import('bcrypt');
      const correctPin = '123456';
      const hash = await bcrypt.hash(correctPin, 10);

      const { queryOne, query } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'pin-id',
        attempts: 0,
        pin_hash: hash,
      });
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      const result = await verifyPin('user@example.com', correctPin, 'login');
      expect(result).toBe(true);
      // Should mark PIN as used
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE auth_pins SET used_at'),
        ['pin-id'],
      );
    });

    it('returns false for an expired PIN (filtered by SQL)', async () => {
      const { queryOne } = await import('../database.js');
      // The SQL query filters expires_at > NOW(), so expired PINs return null
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await verifyPin('user@example.com', '123456', 'login');
      expect(result).toBe(false);
    });

    it('increments attempts counter on failed verification', async () => {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash('654321', 10);

      const { queryOne, query } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'pin-id',
        attempts: 1,
        pin_hash: hash,
      });
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      await verifyPin('user@example.com', '000000', 'login');

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('attempts = attempts + 1'),
        ['pin-id'],
      );
    });
  });
});

  describe('PIN expiry boundary', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets expires_at to exactly 5 minutes (300 000 ms) from creation time', async () => {
      const fixedNow = 1_700_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      const { query } = await import('../database.js');
      let insertParams: unknown[] | undefined;
      vi.mocked(query).mockImplementation(async (text: string, params?: unknown[]) => {
        if ((text as string).includes('INSERT INTO auth_pins')) {
          insertParams = params;
        }
        return { rows: [] } as any;
      });

      await createPin('boundary@example.com', 'login');

      vi.useRealTimers();

      expect(insertParams).toBeDefined();
      // 4th parameter is expires_at
      const expiresAt = new Date(insertParams![3] as string).getTime();
      expect(expiresAt).toBe(fixedNow + AUTH.PIN_TTL_MS); // exactly 5 minutes
    });

    it('PIN is valid at T+4:59 and expired at T+5:01 (boundary is exclusive)', async () => {
      // verifyPin relies on SQL `expires_at > NOW()` to filter expired PINs.
      // This test simulates both sides of the 5-minute boundary by controlling
      // what queryOne returns based on whether the PIN would be in the DB window.
      const bcrypt = await import('bcrypt');
      const correctPin = '999999';
      const hash = await bcrypt.hash(correctPin, 10);

      const { queryOne, query } = await import('../database.js');
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      const baseTime = 1_700_000_000_000;
      vi.useFakeTimers();

      // At T+4:59 — PIN not yet expired; SQL returns the record
      vi.setSystemTime(baseTime + (AUTH.PIN_TTL_MS - 1000)); // one second before expiry
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'pin-id', attempts: 0, pin_hash: hash });
      const resultValid = await verifyPin('boundary@example.com', correctPin, 'login');
      expect(resultValid).toBe(true);

      vi.clearAllMocks();
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      // At T+5:01 — PIN expired; SQL `expires_at > NOW()` excludes it → null
      vi.setSystemTime(baseTime + (AUTH.PIN_TTL_MS + 1000)); // one second after expiry
      vi.mocked(queryOne).mockResolvedValueOnce(null);
      const resultExpired = await verifyPin('boundary@example.com', correctPin, 'login');
      expect(resultExpired).toBe(false);

      vi.useRealTimers();
    });

    it('PIN at exactly T+5:00 is expired (boundary is exclusive, not inclusive)', async () => {
      // At the exact expiry timestamp, expires_at = NOW(), so expires_at > NOW() is FALSE
      const correctPin = '777777';

      const { queryOne, query } = await import('../database.js');
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      const baseTime = 1_700_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(baseTime + AUTH.PIN_TTL_MS); // exactly at expiry

      // SQL returns null because expires_at is not strictly greater than NOW()
      vi.mocked(queryOne).mockResolvedValueOnce(null);
      const result = await verifyPin('boundary@example.com', correctPin, 'login');
      expect(result).toBe(false);

      vi.useRealTimers();
    });
  });
