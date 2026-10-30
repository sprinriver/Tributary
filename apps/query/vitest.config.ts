import { defineConfig } from 'vitest/config';

// Importer tests start a SeaweedFS container (Testcontainers).
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 240_000 },
});
