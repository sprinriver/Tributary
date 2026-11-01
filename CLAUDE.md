# Tributary — experiment data platform for drug discovery (TypeScript + Python monorepo)

Proteomics-first registry, pipeline launcher, data explorer and charting for drug-discovery teams,
installed in each customer's own AWS account. Codename "Tributary" (rename freely).
Spec: `docs/SPEC.md` · Architecture + decisions: `docs/ARCHITECTURE.md` · Phase plan: `docs/PLAN.md`
Progress log: `docs/PROGRESS.md` · Feature tracker: `docs/features.json` · v1 parity notes: `docs/REFERENCE_V1.md`
Read only the sections the current phase cites. Do not load whole documents "just in case".

IMPORTANT: clean-room build. Never add any client's name, data, code, URLs, programme names or
people's names to this repo. Use the synthetic generator (`apps/compute`, `pnpm synth`) or public data.

## Packages (each has its own CLAUDE.md with package commands and patterns)
- apps/web — Vite + React 19 SPA (TanStack Router/Query, AG Grid Community, Plotly.js partial bundle)
- apps/api — Fastify 5 API: auth (OIDC BFF), registry, ingest, pipelines, jobs (pg-boss), AI tools, MCP
- apps/query — Fastify + DuckDB query service: compiles QuerySpec → parameterized SQL over Parquet/Iceberg
- apps/compute — Python FastAPI service (uv): statistics, clustering, curve fits, SDRF validation, synth data
- packages/contracts — zod schemas = single source of truth (entities, manifest, QuerySpec, chart registry, dataset contracts)
- packages/db — Kysely types, SQL migrations, seed
- packages/importers — dataset importers (tool output → canonical schema) executed by apps/query
- pipelines/ — Nextflow configs/param templates; `pipelines/demo` is the tiny local test pipeline
- infra/terraform — AWS modules. IMPORTANT: never run `terraform apply` or `destroy`; plan only.

## Commands (root scripts; these forms are pre-approved in .claude/settings.json)
- Install: `pnpm install` · Python: `pnpm compute:sync` (both ask first: they change dependencies)
- Fresh checkout or worktree: `pnpm run bootstrap` (frozen installs only; never changes lockfiles; no prompt)
- Local stack: `docker compose up -d` (Postgres+pgvector, SeaweedFS S3 + Iceberg catalog, Keycloak)
- Dev: `pnpm dev` (web 5173, api 3000, query 3100, compute 8000)
- All checks — must pass before you say anything is done: `pnpm check`
  (typecheck + lint + all TS unit tests + compute pytest + ruff)
- One package: `pnpm run test:web <pattern>` (also test:api, test:query, test:contracts, test:db, test:importers)
- Python: `pnpm run test:compute -k <pattern>`
- E2E: `pnpm e2e [<pattern>]` (Playwright; needs local stack + `pnpm db:seed`)
- Patterns match test titles (vitest `-t`, pytest `-k`, playwright `--grep`). Start every test title with its
  feature ID from `docs/features.json` (`REG-03: publish requires a reason`; Python: `test_REG_03_...`).
- DB: `pnpm db:migrate` · `pnpm db:seed` · codegen: `pnpm gen` (OpenAPI + TS/Python clients + Kysely types)
- Do not run `pnpm --filter`, `pnpm exec`, `npx` or `uv run` ad hoc. Add a package.json script instead.

## Conventions that differ from defaults
- Node 24 LTS, pnpm, ESM only, TypeScript 6.0.x strict (not 7.x — see Gotchas). Python ≥3.12 with uv, ruff, pyright.
- Scripts call uv only as `uv run --locked` / `uv sync --frozen`, so dependency changes always go through `uv add`.
- Dependencies are exact-pinned. Never add one without asking me first with: name, exact version,
  why, registry link, publisher, first-publish date. Reject packages younger than 90 days unless I approve.
- Every API boundary validated with zod from packages/contracts. OpenAPI 3.1 is generated from zod;
  never hand-write a type that duplicates a contract.
- Postgres via Kysely only. DuckDB SQL only inside apps/query via the QuerySpec compiler.
  Never interpolate user input into SQL. Never accept SQL from the browser or from the AI layer.
- IDs are UUIDv7; timestamps `timestamptz` in UTC; soft delete only.
- Published experiment versions and dataset releases are immutable (DB trigger enforces it).
  Any change to a published thing creates a new version.
- Every mutation and every export writes an `audit_log` row (actor, action, entity, before/after, reason).
- Large files never pass through the API: presigned multipart upload straight to object storage.
- New migrations only; never edit a migration that is already committed (a hook blocks it).
- Keep files under ~400 lines; split modules before extending them.
- No dependencies on, or code copied from, GPL/AGPL/BUSL/non-commercial projects (list: `docs/ARCHITECTURE.md` §9;
  e.g. limma and inmoose are GPL). Such tools run only as separate pipeline containers. `pnpm run licence:scan` checks.

## Science conventions (wrong science is a P0 bug)
- log2 fold change = log2(numerator / denominator); contrast labels read "numerator vs denominator".
- p-values in (0, 1]; adjusted p = Benjamini–Hochberg unless the source tool says otherwise (store which).
- Doses stored in molar (SI) as numbers plus the display unit; pEC50 = −log10(EC50 in M).
- Protein groups are semicolon-separated accessions: keep the original string, split into an array for joins.
- Never impute, filter or normalise silently. Every transformation is recorded in the dataset release.
- Missingness classes and NA meanings come from the source tool; map them explicitly, never guess.
- Charts and statistics only through the chart registry and apps/compute; the UI renders, it does not compute statistics.

## Workflow
- One phase of `docs/PLAN.md` per session. Start: read `docs/PROGRESS.md`, run `git log --oneline -15`.
- Tests first: write failing tests for the phase's Definition of Done, show they fail, commit them alone.
- IMPORTANT: never delete, skip, loosen or rewrite an existing test to make a check pass. Fix the code or ask me.
- Show evidence: paste the command you ran and its final output lines. Don't just assert success.
- UI work: open the page with the Playwright MCP, use it as a scientist would, save screenshots to
  `artifacts/phase-<N>/`, fix what looks wrong.
- Unsure about a library API? Look it up (Context7 or official docs) for the pinned version. Never guess.
- If I have corrected the same thing twice, stop and tell me; don't keep patching.
- Finish with `/phase-finish`: checks green, reviewer subagent, PROGRESS entry, features.json flips, one commit.

## Gotchas (add a line when Claude makes the same mistake twice)
- TypeScript: pin 6.0.x. TS 7 (native compiler) ships no tsserver and typescript-eslint supports only <6.1.
- DuckDB: use `@duckdb/node-api` (the `duckdb` npm package is deprecated). Pin the same DuckDB version in
  Node and Python; DuckDB 2.0 files can't be read by older versions.
- Plotly.js 4.x broke colour parsing and removed mapbox traces vs 3.x — use 4.x examples only.
- AG Grid: Community features only. Clipboard range paste, Excel export and row grouping are Enterprise;
  use the "Paste TSV block" dialog instead.
- Nextflow removed weblog: never use `-with-weblog`. Status comes from EventBridge/SQS, polling and trace files.
- Proteomics pipelines: bigbio/quantms and bigbio/quantmsdiann (nf-core/quantms is archived).
- Not in this stack, don't add: lakeFS (BUSL licence — also never read its source), MinIO (unmaintained),
  OpenSearch, Neptune, Redshift, RabbitMQ, Redis, Prisma.
- Hooks: `$CLAUDE_PROJECT_DIR` does not follow worktrees; the hook input `cwd` does.

## Compact instructions
When compacting, preserve: current phase and its DoD status, files modified, failing tests and their
errors, verification commands and their last results, open decisions and questions for me.
