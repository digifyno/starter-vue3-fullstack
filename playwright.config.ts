import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: [
    {
      command: 'npm run dev -w backend',
      port: 4001,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w frontend',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
