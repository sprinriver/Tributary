# packages/contracts — zod schemas, the single source of truth
- Test: `pnpm run test:contracts [<pattern>]`
- Export everything through `src/index.ts`. Import local files with `.ts` extensions.
- Reference to copy: `src/health.ts` + `src/health.test.ts`.
- A breaking schema change needs an ADR and `pnpm gen` (from Phase 1).
