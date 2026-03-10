export const config = {
  port: parseInt(process.env.PORT || '4001', 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: '7d' as const,
  hub: {
    url: process.env.RSI_HUB_URL || 'https://rsi.digify.no/api',
    token: process.env.RSI_HUB_TOKEN || '',
  },
  disableDevLogin: process.env.DISABLE_DEV_LOGIN === 'true',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
};

if (config.nodeEnv === 'production') {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'RSI_HUB_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

if (config.jwtSecret === 'dev-secret-change-me') {
  console.warn('[config] WARNING: Using default JWT_SECRET — set a strong secret in production');
}
