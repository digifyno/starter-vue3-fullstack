export const config = {
  port: parseInt(process.env.PORT || '4001', 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: '7d',
  hub: {
    url: process.env.RSI_HUB_URL || 'https://rsi.digify.no/api',
    token: process.env.RSI_HUB_TOKEN || '',
  },
  disableDevLogin: process.env.DISABLE_DEV_LOGIN === 'true',
};
