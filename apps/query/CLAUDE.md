# apps/query — Fastify + DuckDB query service (internal)
- Test: `pnpm run test:query [<pattern>]` (vitest, `src/**/*.test.ts`)
- Dev: `pnpm dev` (port 3100). Node 24 type stripping, as in apps/api.
- DuckDB through `@duckdb/node-api` only; one instance per process (`src/app.ts`).
- SQL only from the QuerySpec compiler (Phase 12); never from user input.
- Reference to copy: `/v1/select42` and `src/app.test.ts`.
