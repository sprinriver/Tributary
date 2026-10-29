import { defineConfig } from 'vitest/config';

// API integration tests start a Postgres container (Testcontainers).
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 240_000 },
});
