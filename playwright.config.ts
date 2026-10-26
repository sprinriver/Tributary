import { defineConfig, devices } from '@playwright/test';

// Starts the API and web dev servers itself; the docker compose stack must already be up for later phases.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Lets an environment with a preinstalled browser of another Playwright version point at it.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node apps/api/src/server.ts',
      url: 'http://127.0.0.1:3000/healthz',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --dir apps/web run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
