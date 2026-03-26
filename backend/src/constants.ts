export const AUTH = {
  PIN_LENGTH: 6,
  PIN_TTL_MS: 5 * 60 * 1000,          // 5 minutes
  PIN_MAX_ATTEMPTS: 5,
  BCRYPT_ROUNDS: 10,
  INVITATION_TTL_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days
  JWT_EXPIRY: '7d',
  CHALLENGE_TTL_MS: 5 * 60 * 1000,  // 5 minutes
} as const;

export const RATE_LIMITS = {
  REGISTER:              { max: 5,  timeWindow: '1 minute'  },
  LOGIN:                 { max: 5,  timeWindow: '1 minute'  },
  VERIFY_PIN:            { max: 10, timeWindow: '1 minute'  },
  REFRESH:               { max: 10, timeWindow: '1 minute'  },
  INVITATIONS:           { max: 20, timeWindow: '1 hour'    },
  PASSKEY_DELETE:        { max: 10, timeWindow: '1 hour'    },
  PASSKEY_LOGIN_BEGIN:   { max: 10, timeWindow: '5 minutes' },
  PASSKEY_LOGIN_COMPLETE: { max: 10, timeWindow: '5 minutes' },
  PASSKEY_REGISTER:      { max: 5,  timeWindow: '5 minutes' },
  USER_UPDATE:           { max: 20, timeWindow: '1 minute'  },
  ORG_CREATE:            { max: 5,  timeWindow: '1 hour'    },
  ORG_UPDATE:            { max: 20, timeWindow: '1 minute'  },
} as const;

export const SETTINGS = {
  MAX_SIZE_BYTES: 10_000,
  BODY_LIMIT_BYTES: 100 * 1024, // 100 KB — prevents memory amplification attacks
} as const;

export const AI = {
  MAX_MESSAGE_LENGTH: 4000,
  MAX_HISTORY_MESSAGES: 50,
} as const;
