import { defineConfig } from 'vitest/config';

// Integration tests start a real Postgres container (Testcontainers); give image pulls and migrations time.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 240_000 },
});
