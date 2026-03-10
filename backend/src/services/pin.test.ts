import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePin, createPin, verifyPin } from './pin.js';

// Mock database so no real PG connection is needed
vi.mock('../database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
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
      vi.mocked(query).mockResolvedValue({ rows: [] });

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
      vi.mocked(query).mockResolvedValue({ rows: [] });

      const result = await verifyPin('user@example.com', correctPin, 'login');
      expect(result).toBe(true);
      // Should mark PIN as used
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE auth_pins SET used_at'),
        ['pin-id'],
      );
    });
  });
});
