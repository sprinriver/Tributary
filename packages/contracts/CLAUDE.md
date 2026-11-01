# packages/contracts — zod schemas, the single source of truth
- Test: `pnpm run test:contracts [<pattern>]`
- Export everything through `src/index.ts`. Import local files with `.ts` extensions.
- A schema that leaves the package (OpenAPI, JSON Schema, Python) carries `.meta({ id: 'Name' })`; `pnpm gen`
  writes `generated/` and `apps/compute/tributary_compute/contracts/`. Commit both; a test fails if they drift.
- Errors are `{code, field, message}`: custom zod issues put the code in `params.code` (see `src/errors.ts`).
- References to copy: `src/quantity.ts` (pure parser + result type), `src/manifest.ts` (template → zod schema),
  `src/query-validate.ts` (contract-aware validation), `src/datasets/experiment.ts` (dataset contracts).
- Quality rules cite their source (`source` field). Never add a column meaning without one.
- A breaking schema change needs an ADR and `pnpm gen`.
