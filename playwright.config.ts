import { defineConfig, devices } from '@playwright/test';

// Starts the API, query, compute and web dev servers itself; the docker compose stack must already be up for later phases.
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
      // Hermetic e2e: no live OLS4 (results change over time); the API falls back to its built-in terms.
      // The assistant uses the deterministic stub model (no model calls, no keys).
      env: { OLS_URL: process.env.E2E_OLS_URL ?? 'http://127.0.0.1:9', AI_PROVIDER: 'stub' },
    },
    {
      command: 'node apps/query/src/server.ts',
      url: 'http://127.0.0.1:3100/healthz',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'cd apps/compute && uv run --locked uvicorn tributary_compute.main:app --host 127.0.0.1 --port 8000',
      url: 'http://127.0.0.1:8000/healthz',
      reuseExistingServer: !process.env.CI,
    },
    {
      // CI serves the production build: no on-demand compiles or dependency re-optimisation reloads while
      // tests run in parallel (they made sign-in time out in CI). Locally the dev server is reused.
      command: process.env.CI
        ? 'pnpm --dir apps/web run build && pnpm --dir apps/web run preview'
        : 'pnpm --dir apps/web run dev',
      timeout: 180_000,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
