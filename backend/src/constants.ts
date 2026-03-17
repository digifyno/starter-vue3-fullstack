export const AUTH = {
  PIN_LENGTH: 6,
  PIN_TTL_MS: 5 * 60 * 1000,          // 5 minutes
  PIN_MAX_ATTEMPTS: 5,
  BCRYPT_ROUNDS: 10,
  INVITATION_TTL_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days
  JWT_EXPIRY: '7d',
} as const;

export const RATE_LIMITS = {
  REGISTER:    { max: 5,  timeWindow: '1 minute' },
  LOGIN:       { max: 5,  timeWindow: '1 minute' },
  VERIFY_PIN:  { max: 10, timeWindow: '1 minute' },
  REFRESH:     { max: 10, timeWindow: '1 minute' },
  INVITATIONS: { max: 20, timeWindow: '1 hour'   },
} as const;

export const SETTINGS = {
  MAX_SIZE_BYTES: 10_000,
} as const;
