# apps/api — Fastify 5 API
- Test: `pnpm run test:api [<pattern>]` (vitest, `src/**/*.test.ts`; use `app.inject`, not a live port)
- Dev: `pnpm dev` (port 3000). Runs TypeScript directly with Node 24 type stripping: import local files with
  their `.ts` extension and use only erasable syntax (no enums, namespaces or parameter properties).
- App factory: `src/app.ts` `buildApp()`; process entry `src/server.ts`.
- Reference to copy: the `/healthz` route and `src/app.test.ts`.
- Rules: `.claude/rules/api-contracts.md` (zod contracts, `/v1/` prefix, CASL first, audit every mutation).
