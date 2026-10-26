# Progress log

Append-only, newest at the bottom. Written by `/phase-finish`; read at the start of every session.

Entry template:
```
## <YYYY-MM-DD> — Phase <N>: <title> — done | partial
- Built: …
- Decisions (and why): …
- Dependencies added: name@version — reason (or "none")
- Evidence: `pnpm check` ✓ · `pnpm e2e <pattern>` ✓ · screenshots in artifacts/phase-<N>/
- Gaps and follow-ups: …
- Commit: <short sha>
```

---

## 2026-10-26 — Kit created (before Phase 0)
- Built: SPEC, ARCHITECTURE (with decision log), PLAN (Phases 0–23), PROMPTS, features.json (90 features),
  REFERENCE_V1 (clean-room parity notes), RESEARCH, and Claude Code guardrails (settings, hooks, subagents,
  skills, path rules, MCP servers).
- Decisions: see docs/ARCHITECTURE.md §14 (ADR-001 … ADR-014).
- Next: settle SPEC §12 Q8 (client contract) → optional spec interview → Phase 0.

## 2026-10-26 — Phase 0: Scaffold and guardrails — done
- Built: pnpm 12 + Turborepo workspace with root scripts from CLAUDE.md; apps/web (Vite + React + TanStack
  Router/Query, home page shows API health via `/api` proxy), apps/api (Fastify `/healthz`, `/readyz`),
  apps/query (Fastify + DuckDB `GET /v1/select42`), apps/compute (FastAPI `/healthz`, uv, pytest, ruff,
  pyright strict), packages/contracts (`HealthStatusSchema`), db, importers, ui (`StatusBadge`) with one test
  each; ESLint flat config (max-lines 400 warning) + Prettier; docker-compose.yml (Postgres 17 + pgvector,
  SeaweedFS S3 :8333 + Iceberg REST :8181, Keycloak with `tributary` realm and users admin/scientist/viewer,
  password = username); Playwright config + `e2e/smoke.spec.ts`; `.github/workflows/ci.yml`; per-package CLAUDE.md.
- Decisions (and why):
  - No Celeste repo provided → no ADR-0014 yet; UI kit decision deferred to the first UI-heavy phase.
  - API/query run TypeScript with Node 24's built-in type stripping (`.ts` import extensions, erasable syntax
    only) — no tsx dependency.
  - Licence scanner: pnpm's built-in `pnpm licenses list` for Node + pip-licenses 5.5.5 (MIT) for Python, with
    the allowlist in `scripts/licence-scan.mjs`. MPL-2.0 is allowed (certifi; file-level copyleft, never copied).
  - `@tanstack/react-query` pinned to 5.104.5 (not 5.105.0): pnpm 12's minimum release age rejected the newer one;
    pinning an older version beats adding an exclusion.
  - Compute HTTP tests use `httpx.ASGITransport`, not starlette's TestClient (it now wants `httpx2`, a new dependency).
  - Keycloak image from Docker Hub (`keycloak/keycloak:26.8.1`, official mirror) — quay.io was unreachable here.
  - `.prettierignore` also skips `*.md` and `.claude/` so hand-written kit docs keep their layout.
- Dependencies added: see ARCHITECTURE §3 "Pinned" notes (all versions read from npm/PyPI on 2026-10-26).
  Under 90 days old, taken as specified by the kit's ARCHITECTURE §3: @duckdb/node-api 2.0.0-r.1, vitest 5.0.5,
  @playwright/test 1.64.1.
- Evidence: `pnpm check` ✓ (14 turbo tasks, eslint + prettier, pytest 1 passed, ruff, pyright 0 errors) ·
  `docker compose ps` → postgres, seaweedfs, keycloak all healthy · `pnpm e2e smoke` ✓ (1 passed) ·
  `pnpm run licence:scan` ✓ (168 dependencies) · protect-files hook on `.env` → "Blocked edit to …/.env — secrets
  files are edited by the user only." (exit 2) · screenshot artifacts/phase-0/home.png.
- Gaps and follow-ups: CI not yet run on GitHub (first push). Context7 MCP needs `CONTEXT7_API_KEY`. `pnpm synth`
  is a stub until Phase 2. Plan-reviewer subagent not run (built in a cloud session without `/phase-finish`).
  Open legal question SPEC §12 Q8 (earlier client contract) still needs counsel.
- Commit: 8545274

## 2026-10-26 — Phase 1: Contracts — done
- Built: packages/contracts as the zod source of truth — error shape `{code, field, message}` (`issuesToErrors`),
  UUIDv7/timestamp/URN/ontology-term primitives; all SPEC §4 entities (`entities/registry.ts`, `entities/platform.ts`);
  quantity parsing to canonical molar / hours (`parseQuantity`); well validation for 96/384 plates; seed proteomics
  template (SPEC §6.1 columns) and `buildManifestSchema` / `validateManifest` with per-cell errors, reserved SDRF
  tokens, duplicate keys and custom fields; dataset contracts for all 15 SPEC §6.2 kinds (columns, nullability,
  join keys, cited quality rules); QuerySpec + RuleGroup schema and `validateQuerySpec` (column whitelist, alias
  scoping for joins, operator × type matrix, value checks); ChartSpec / ChartDefinition with an empty registry;
  `pnpm gen` → `packages/contracts/generated/{openapi.json,json-schema/*.json}` and pydantic v2 models in
  `apps/compute/tributary_compute/contracts/`.
- Decisions (and why):
  - zod 4 built-in `z.toJSONSchema` instead of zod-to-openapi (ADR-0015).
  - Canonical units follow the manifest contract: concentration → M, time → hours (not seconds), as SPEC §6.1
    stores `dose_molar` and `time_hours`. Units are case-sensitive (mM ≠ MM).
  - Species/cell-line validation uses an injected `TermIndex`; `SEED_TERMS` (NCBI Taxonomy, Cellosaurus) until the
    OLS4 cache exists. Cellosaurus CURIEs use the `cellosaurus:` prefix.
  - Operators are react-querybuilder's names; on list columns (`protein_ids`, `gene_names`) only
    contains/doesNotContain/null/notNull. Text columns don't allow `<`/`>` (v1 allowed them; no use case).
  - Generated files are committed and excluded from Prettier, ESLint, ruff and pyright; a contracts test and a CI
    step (`pnpm gen && git diff --exit-code`) fail on drift. datamodel-codegen runs with `--field-constraints
    --use-annotated` so pyright strict can type the models.
- Dependencies added: datamodel-code-generator==0.83.0 (apps/compute dev; MIT; approved by user; newest release
  older than a month — 0.86.0 was 8 days old).
- Evidence: `pnpm check` ✓ · `pnpm run test:contracts CON-01` ✓ (9) · `CON-02` ✓ (22) · `CON-03` ✓ (23) ·
  `pnpm gen` ✓ (38 files; second run leaves no diff) · `pnpm run test:compute -k CON_03` ✓ (3) · acceptance tests
  unchanged since the test commit.
- Gaps and follow-ups: OpenAPI has no `paths` until Phase 3. Plan-reviewer subagent not run (no `/phase-finish`).
  OLS4-backed `TermIndex` in Phase 5. Experiment-scope manifest fields (experiment tab) are typed by the template
  but not validated by `validateManifest`, which covers sample rows only.
- Commit: 2d2fbc8

## 2026-10-26 — Phase 2a: Database and triggers — done
- Built: 7 SQL migrations in `packages/db/migrations` (foundation: pgvector + `uuidv7()` + `assay_type_key` enum;
  registry; data and reference; access and audit; integrity triggers; app role; pg-boss schema) covering all 25
  SPEC §4 tables; GIN indexes on jsonb and `search_tsv`, HNSW on a placeholder `embedding vector(1024)`;
  Kysely migrator over SQL folders (`migrateToLatest`, `migrateDownAll`), `createDb`, `pnpm db:migrate`;
  `src/generated/db.ts` from kysely-codegen via `pnpm gen`.
- Decisions (and why):
  - Phase 2 split into 2a (DB) and 2b (synthetic data + seed), approved by the user.
  - Immutability by triggers raising SQLSTATE `TR409`: published versions may only move to archived (archived is
    final); samples, contrasts, custom field defs and sample files of a non-draft version are frozen; published or
    rejected releases are frozen. `embedding` and `search_tsv` may still be refreshed on published versions.
  - Soft delete enforced by grants: `tributary_app` has select/insert/update only, and insert/select on
    audit_log; a trigger also blocks UPDATE/DELETE/TRUNCATE on audit_log for the owner.
  - URNs are computed by triggers from ids (`urn:tributary:experiment:<id>[:v<n>]`), so callers can't supply a
    wrong one. Found because the acceptance tests insert placeholder URNs.
  - `assay_type_key` is a Postgres enum (experiments reference it without seeding rows); audit_log has no
    updated/deleted columns (rows never change) and a nullable tenant_id.
  - bigint (`row_count`, `size_bytes`) parsed to a safe JS number (throws above 2^53); codegen maps int8 → number.
  - `uuidv7()` written in plpgsql (Postgres 17 has none; Postgres 18 does).
  - pg-boss schema is a pinned SQL migration from pg-boss's own construction plan (BEGIN/COMMIT stripped).
- Dependencies added (approved): kysely 0.29.7, pg 8.23.1, pg-boss 12.38.0; dev: kysely-codegen 0.20.0,
  @types/pg 8.23.1, testcontainers + @testcontainers/postgresql 12.2.1. Install scripts denied: cpu-features,
  protobufjs, ssh2 (pulled in by testcontainers; not needed).
- Evidence: `pnpm check` ✓ (db: 14 passed) · `pnpm run test:db DB-01` ✓ (3) · `pnpm run test:db DB-02` ✓ (10) ·
  `pnpm db:migrate` on the local stack applied 0001–0007, second run "already up to date" · `pnpm gen` reproducible.
- Test change after the test commit: one type-only fix in `immutability.test.ts` (row helper typed
  `{ id: string } & Record<string, string>` for noUncheckedIndexedAccess); no assertion changed. Commit 1 line.
- Gaps and follow-ups: Phase 2b (synth + seed). Embedding dimension fixed in Phase 17 (needs a new migration).
  The API's login user and its grant of `tributary_app` are per-environment (Phase 3 / Terraform).
- Commit: 6e044cc

## 2026-10-26 — Phase 2b: Synthetic data and seed — done
- Built: `pnpm synth` (apps/compute `tributary_compute/synth`, seed 20261026) → `fixtures/` (36 files, 464 KB):
  2 programs, 12 experiments (4 DIA dose series, 2 DIA contrasts, 2 TMT10plex, 2 RNA-seq, 2 CRISPR screens),
  manifests in the seed template's columns, DIA-NN-like `report.pg_matrix.tsv`, CurveCurator-like `curves.txt`,
  limma-like `toptable.tsv`, nf-core/rnaseq-like `salmon.merged.gene_counts.tsv`, MAGeCK-like `gene_summary.txt`,
  compounds `CPD-000001…8`, ADME/physchem properties, target annotations; generated `fixtures/README.md`.
  `pnpm db:seed` (packages/db `seedDatabase`): validates manifests with `validateManifest`, then in one transaction
  loads assay types, the seed template + 21 field defs, programs, published experiment versions with samples
  (characteristics / factors / technical jsonb) and contrasts, file records, compounds, properties, targets and
  audit rows; stages files to SeaweedFS (`tributary-raw`, ARCHITECTURE §5 layout); prints row counts.
- Decisions (and why):
  - Column names verified where possible: CurveCurator 0.6.0 source (Apache-2.0) and its 4PL model
    (front = low-dose plateau); DIA-NN README confirms pg_matrix exists and omits zeros, but not the header —
    header recorded as an assumption for the Phase 8 importer's SOURCE.md. limma, MAGeCK and nf-core/rnaseq
    headers from their documentation, to be re-verified in Phase 9.
  - Statistics are simulated around known true effects, not fitted: normal-approximation p-values, BH-adjusted;
    limma `B` and MAGeCK RRA scores are not simulated (B omitted; score = p). Stated in fixtures/README.md.
  - Real proteins only with public UniProt accessions/HGNC symbols I could state with confidence; everything else
    uses `SYNP*` / `SYNTH*` / `SYNG*` identifiers that exist in no public database. InChIKeys left empty.
  - One numpy PCG64 stream per output (seed + crc32 of its name), so adding an output never changes others.
  - Seed is idempotent by design: skipped when the demo programs exist; all-or-nothing transaction.
  - Fixed a Phase 1 bug the seed found: the template's `cell_line` ontology is `cellosaurus` but seed terms said
    `Cellosaurus`, so no cell line resolved. Term index now ignores ontology-prefix case; regression tests added
    in `packages/contracts/src/ontology.test.ts`.
  - licence:scan understands SPDX `AND` (every part allowed) and allows Zlib (numpy's licence expression).
- Dependencies added (approved): numpy 2.5.4 (apps/compute), @aws-sdk/client-s3 3.1156.0 (packages/db).
- Evidence: `pnpm check` ✓ · `pnpm run test:compute -k SYN_01` ✓ (7) · `pnpm run test:db SYN-01` ✓ (2) ·
  `pnpm synth` → 36 files, identical on rerun · `pnpm db:seed` on the local stack → app_user 1, assay_type 6,
  metadata_template 1, metadata_field_def 21, program 2, experiment 12, experiment_version 12, sample 100,
  contrast 8, file_object 30, compound 8, compound_property 32, target_annotation 34, audit_log 28; second run
  identical; 30 objects in `tributary-raw` · `pnpm run licence:scan` ✓ (187) · acceptance tests untouched.
- Gaps and follow-ups: importers (Phase 8) turn the fixture outputs into dataset releases; fixture headers must be
  checked against each tool's SOURCE.md then. Plan-reviewer / omics-reviewer subagents not run.
- Commit: 4f389b3
