# Tributary — Build Plan (v2.0)

How to run each phase: `docs/PROMPTS.md`. Rule: one phase per Claude Code session; failing acceptance tests
committed first; `pnpm check` green before finishing; `/phase-finish` closes the phase.
Feature IDs refer to `docs/features.json`. Section refs (§) refer to `docs/SPEC.md` unless stated.

Sizing: each phase ≈ one focused session (½–2 days with Claude Code), touching 1–2 packages, 3–7 DoD items.
If a phase plan grows past ~10 implementation steps or 3 packages, split it and tell me. Phases marked
**Suggested split** are known to be large — run them as `<N>a` and `<N>b` sessions along the line given.
Expect ~30–35 sessions in total (≈ 6–9 weeks for one developer working with Claude Code).

| Milestone | Phases | Demo you can give after it |
|---|---|---|
| A Foundations | 0–3 | Login, empty app, CI green |
| B Registry | 4–6 | Register experiments with validated manifests (internal demo) |
| C Data in | 7–11 | Upload files, run the demo pipeline, see releases |
| D Explore | 12–16 | **First sales demo**: explorer, charts, results, compound/protein pages on synthetic data |
| E Find & trust | 17–18 | Search, lineage, audit — answers pharma IT questions |
| F AI | 19–20 | Assistant + MCP server (Claude can query your platform) |
| G Ship | 21–23 | Deployable into a design partner's AWS account |

---

## Phase template (copy for new phases)
```
## Phase N — <title>
Status: todo | in-progress | done (<commit sha>)
Goal: <one sentence>
Spec: <§ refs>   Features: <IDs>
In scope: …   Out of scope: …
Files/areas: …
Order of work: 1) failing tests 2) … 3) … 4) docs/codegen
Risks: …
Definition of done (each item provable by a command or an artifact):
- [ ] …
- [ ] `pnpm check` exits 0
- [ ] No pre-existing test modified or deleted
```

---

## Phase 0 — Scaffold and guardrails
Status: done (8545274)
Goal: An empty-but-working monorepo where `pnpm check`, the local stack and a smoke e2e all pass, with Claude Code guardrails active.
Spec: ARCHITECTURE §2–3, §12   Features: OPS-01
In scope:
- Optional Celeste alignment: if I give you a path to the Celeste repo, read its package.json files, lint/ts configs and UI kit; write `docs/adr/0014-celeste-alignment.md` saying what we keep (ARCHITECTURE §14 rule).
- pnpm workspace + Turborepo; root scripts exactly as listed in CLAUDE.md (`check`, `test:*`, `e2e`, `dev`, `db:migrate`, `db:seed`, `gen`, `synth`, `compute:sync`, `bootstrap`, `bench:query` placeholder).
  - `test:web|api|query|contracts|db|importers <pattern>` pass the pattern to vitest `-t`; `e2e <pattern>` passes it to playwright `--grep` (e.g. `pnpm run test:api REG-03`, `pnpm e2e smoke`). `test:compute` passes its arguments straight to pytest (`pnpm run test:compute -k SYN_01`).
  - `bootstrap` = `pnpm install --frozen-lockfile` + `uv sync --frozen` for apps/compute (used in fresh worktrees and CI).
  - `licence:scan` = licence allowlist check over Node and Python dependencies (fails on GPL/AGPL/BUSL/non-commercial; allowlist from ARCHITECTURE §9). Choose and pin a permissively licensed scanner and record it in PROGRESS.
  - Every script that calls uv uses `uv run --locked` / `uv sync --frozen`; `compute:sync` is the only one that may update uv.lock.
- Install efficiently: write exact versions into each package.json / pyproject.toml first (look each up on the registry), then run a single `pnpm install` and a single `pnpm compute:sync` — I approve each once.
- `.npmrc` (`save-exact=true`), `.nvmrc` (24), `.python-version` (3.12), `packageManager` field. TypeScript pinned to 6.0.3.
- apps/web (Vite + React + TanStack Router; home page shows API health), apps/api (Fastify `/healthz`, `/readyz`), apps/query (Fastify + DuckDB `select 42` endpoint), apps/compute (FastAPI `/healthz`; uv; pytest; ruff; pyright), packages/contracts, db, importers, ui (one passing test each).
- ESLint flat config + Prettier; TS strict; `max-lines` 400 warning; Python ruff config.
- `docker-compose.yml`: `pgvector/pgvector` Postgres 17, SeaweedFS (S3 + Iceberg catalog), Keycloak with a realm import (users admin / scientist / viewer). It must start with no `.env` file: dev-only defaults inline (`${VAR:-default}`), overrides documented in `.env.example`. You cannot create or edit `.env` (a hook blocks it) and must not need to.
- Playwright config + `e2e/smoke.spec.ts` with a test titled `OPS-01 smoke: home page shows API health` (so `pnpm e2e smoke` and `pnpm e2e OPS-01` both select it).
- `.github/workflows/ci.yml`: `pnpm run bootstrap`, `pnpm check`, `pnpm run licence:scan`, compose-backed `pnpm e2e smoke`, dependency review, SBOM.
- Per-package CLAUDE.md files (≤ 30 lines each): commands for that package, where tests live, the reference implementation to copy once it exists.
- Pin the Playwright MCP version in `.mcp.json`; update ARCHITECTURE §3 with the exact versions you installed.
Out of scope: any domain feature.
Risks: SeaweedFS Iceberg catalog config; tooling that lags TypeScript 6 (check peer ranges, record any pin in an ADR).
Definition of done:
- [x] `pnpm check` exits 0 (paste the last lines)
- [x] `docker compose up -d` → `docker compose ps` shows all services healthy
- [x] `pnpm e2e smoke` passes; screenshot `artifacts/phase-0/home.png`
- [x] An attempted edit to `.env` is blocked by the protect-files hook (show the message)
- [x] ARCHITECTURE §3 versions updated; ADR-0014 written (or "no Celeste repo provided" in PROGRESS)
- [x] CI workflow present (it goes green on first push — I will check)

## Phase 1 — Contracts
Status: done (2d2fbc8)
Goal: `packages/contracts` is the zod source of truth for entities and shared specs and emits OpenAPI 3.1 + JSON Schema.
Spec: §4, §6.1–6.2, §7.1–7.2   Features: CON-01, CON-02, CON-03
In scope: zod schemas for every §4 entity; `buildManifestSchema(template, customFields)`; quantity parsing (M, mM, µM/uM, nM, pM; s, min, h, d → SI); well validation per plate format; QuerySpec + RuleGroup + operator × type matrix; ChartSpec + ChartDefinition types (registry empty); dataset contract registry for §6.2 kinds (columns, types, nullability, declared join keys, quality rules); error shape `{code, field, message}`; `pnpm gen` emits `openapi.json` and JSON Schemas; Python pydantic models generated in apps/compute (verify the generator and its licence).
Out of scope: endpoints, DB.
Definition of done:
- [x] Manifest schema from the seed proteomics template rejects the 5 bad rows in SPEC M2's E2E check with field-level errors (unit tests)
- [x] Quantity tests: "1 µM", "1uM", "1000 nM" → 1e-6 M; "5 parsecs" rejected
- [x] QuerySpec tests: invalid operator for type rejected; unknown column rejected (given a contract)
- [x] `pnpm gen` writes OpenAPI + JSON Schemas; a pytest imports the generated pydantic models
- [x] `pnpm check` exits 0

## Phase 2a — Database and triggers
Status: done (6e044cc)
Goal: Postgres schema with migrations and immutability guarantees, and Kysely types.
Spec: §4, ARCHITECTURE §5   Features: DB-01, DB-02
In scope: SQL migrations for all §4 tables + pg-boss schema; indexes (GIN on jsonb and tsvector, HNSW placeholder); triggers: published experiment versions and dataset releases immutable; audit_log append-only via grants; kysely-codegen types; `pnpm db:migrate`.
Out of scope: synthetic data and seeding (Phase 2b); importing datasets (Phase 8).
Definition of done:
- [x] Migrations up/down/up on a fresh Testcontainers Postgres (integration test)
- [x] Updating a published version or release raises (test); audit_log rejects UPDATE/DELETE for the app role (test)
- [x] `pnpm check` exits 0

## Phase 2b — Synthetic data and seed
Status: done (4f389b3)
Goal: A deterministic synthetic demo corpus, loaded into the local stack.
Spec: §4, §6.1–6.2, ARCHITECTURE §5   Features: SYN-01
In scope: `pnpm synth` in apps/compute writing `fixtures/`: 2 programs, 12 experiments (DIA dose series, TMT, RNA-seq, CRISPR), manifests, a DIA-NN-like `report.pg_matrix.tsv`, limma-like topTable, CurveCurator-like dose-response table, MAGeCK-like gene summary, compound + ADME tables (IDs `CPD-000001`…), target annotations (public gene symbols/UniProt accessions); `pnpm db:seed` loads metadata and stages fixture files into SeaweedFS.
Out of scope: importing datasets (Phase 8).
Definition of done:
- [x] `pnpm synth` deterministic: same seed → same sha256 for every fixture (test)
- [x] `pnpm db:seed` prints row counts
- [x] `pnpm check` exits 0

## Phase 3 — Auth, roles and audit
Status: done (cd4a054)
Goal: SSO through Keycloak locally, per-program roles on every route, audit on every mutation.
Spec: §10, ARCHITECTURE §10   Features: AUTH-01, AUTH-02, AUD-01
In scope: OIDC BFF (`/v1/auth/login|callback|logout|me`), Postgres session store, CSRF, CASL ability factory from role bindings + group→role mapping config, Fastify authz preHandler, audit plugin (before/after, `X-Change-Reason`), personal access tokens (hashed, scoped, expiring) and service accounts; web login redirect, user menu, route guards, 403 page.
Definition of done:
- [x] e2e: log in as scientist via Keycloak → name shown → logout
- [x] API tests: viewer 403 on POST /v1/experiments; contributor 201; cross-program read denied
- [x] Audit row has actor, action, before/after, reason for a mutation
- [x] PAT works on GET /v1/auth/me; revoked PAT rejected
- [x] `pnpm check` exits 0

## Phase 4 — Registry API
Status: done (7835182)
Goal: Experiments and versions with draft/publish/clone/diff semantics, picklists and templates.
Spec: M1, §8   Features: REG-01 … REG-06
In scope: endpoints for programs, templates (read), experiments (create/list), versions (get/patch draft/publish/clone/diff/archive), samples (bulk upsert/delete/validate), contrasts; URNs; list filters (assay type, program, date range, name, status, simple text; archived hidden by default) with sort and cursor pagination; publish = full validation + reason (+ approver when the program requires it); `latest_published` maintenance.
Definition of done:
- [x] API tests for REG-01…REG-06 (create; list/filter/sort/paginate; publish with reason; edit published → 409; clone → v2 draft; diff exact)
- [x] OpenAPI regenerated; web TS client compiles
- [x] `pnpm check` exits 0

## Phase 5 — Registry UI
Status: done (5b83a57)
Goal: List, create, edit, publish and version experiments in the browser (v1 parity + versions/diff).
Spec: M1, REFERENCE_V1 §2–4   Features: REG-07, REG-08
In scope: experiments list (filters row, column chooser, sort, pagination, status chips, actions — *Launch pipeline* disabled with tooltip until Phase 11, *Create version*), experiment page (overview, samples tab placeholder, versions tab with history + diff, custom fields with searchable toggle), create wizard, publish dialog with reason, empty/error states.
Definition of done:
- [x] e2e: create → custom fields → publish → create version → diff shows exactly the changes; screenshots in `artifacts/phase-5/`
- [x] Playwright MCP walk-through as a scientist; issues found and fixed listed in PROGRESS
- [x] axe check: zero serious violations on list and form pages
- [x] `pnpm check` exits 0

## Phase 6 — Sample manifest editor
Status: done (68fa2e4)
Goal: Upload or paste, map, validate and edit manifests with ontology-backed cells, plate view, contrasts and SDRF round-trip.
Spec: M2, §6.1   Features: MAN-01 … MAN-06
In scope: Web Worker parsing (Papa Parse), column-mapping step + saved presets, AG Grid editing with cell errors, add/delete rows, bulk fill, find/replace, session undo, sample-level custom columns (chips + searchable), quantity cells, OLS4 typeahead through an API proxy with Postgres cache, plate view (96/384), contrasts editor, SDRF export/import via apps/compute (`sdrf-pipelines` validation), server re-validation on save.
Risks: AG Grid Community lacks clipboard range paste → the Paste TSV dialog is the answer (SPEC §12 Q5).
**Suggested split:** 6a = parsing, mapping presets, grid editing, validation, custom columns, Paste TSV ·
6b = ontology typeahead + cache, quantity cells polish, plate view, contrasts, SDRF import/export.
Definition of done:
- [x] e2e: SPEC M2 check (96-row TSV, 5 errors, inline fix, publish); screenshots
- [x] e2e: Paste TSV dialog maps and applies 20 rows
- [x] Exported SDRF passes `sdrf-pipelines` (pytest) and downloads in e2e
- [x] Second identical OLS lookup is served from cache (test)
- [x] `pnpm check` exits 0

## Phase 7 — Files and ingest
Status: done (4e52deb)
Goal: Files go straight to object storage and move through a typed, checked, audited ingest state machine.
Spec: M3, §7.3   Features: ING-01 … ING-05
In scope: multipart initiate/complete/abort endpoints; browser uploader (resumable, parallel parts, progress); link-existing-prefix job; streaming sha256 job; sniffers (FASTQ, VCF, BAM/BGZF, CSV/TSV, Parquet, gzip/zip, vendor MS raw by extension/structure); state machine on pg-boss with audit; QC rules per format with a stored QC report; the QC gate as a function (`canLaunch(experimentVersion)`) plus the approver-override record — enforced at launch in Phase 10 (API) and shown in Phase 11 (UI); lifecycle tags per file role + admin policy table.
**Suggested split:** 7a = multipart upload, uploader UI, link-prefix, checksums · 7b = sniffers, state machine, QC rules, gate function and override record, lifecycle tags.
Definition of done:
- [x] Integration test vs SeaweedFS: 200 MB multipart upload with one retried part
- [x] Sniffer tests per format incl. corrupted gzip
- [x] State machine tests: legal transitions audited; illegal transitions rejected; QC report stored
- [x] Gate function tests: `qc_failed` blocks, approver override (with reason, audited) unblocks
- [x] e2e: upload two files, statuses update; corrupted file shows `qc_failed` with reason
- [x] `pnpm check` exits 0

## Phase 8 — Dataset releases and first importers
Status: done (daddeed) except the Iceberg read (ADR 0017)
Goal: Tool outputs become validated, immutable dataset releases that DuckDB can query.
Spec: M5, §6.2–6.3, ARCHITECTURE §5–6   Features: DS-01 … DS-05
In scope: importer executor in apps/query (DuckDB attached to the SeaweedFS Iceberg catalog locally, S3 Tables in AWS — config switch); release lifecycle staged → published/rejected; quality rules compiled from contracts to SQL assertions; column stats; ODCS YAML export per kind (+ `datacontract lint` in CI if it fits); importers `diann_pg_matrix`, `limma_toptable`, `custom_tabular` (+ mapping presets API); reference imports (compound, compound_property, target_annotation, id_mapping); catalog UI (list, release detail: schema, stats, contract, lineage stub). Check S3 Tables availability in the first customer's region; ADR if a fallback is needed.
Definition of done:
- [x] Golden-file tests per importer (fixture → expected canonical rows hash)
- [x] A broken fixture is rejected and names the failing rule
- [x] Published release immutable (test); visible in catalog (e2e)
- [ ] DuckDB reads a published release through the Iceberg catalog (integration test) — blocked: the session's network policy denies extensions.duckdb.org, so the iceberg/httpfs extensions cannot be installed; releases are Parquet objects read by DuckDB instead (ADR 0017; tested)
- [x] `pnpm check` exits 0

## Phase 9 — Remaining importers (fan-out)
Status: done (cd59ffb)
Goal: Every importer in §6.3 exists and follows the reference importer pattern.
Spec: §6.3   Features: DS-06
In scope: `diann_report_parquet` (→ precursor_quant + qc_metrics), `alphadia_output`, `mzqc`, `spectronaut_report`, `maxquant_protein_groups`, `fragpipe_combined_protein`, `quantms_qpx`, `msstats_comparison`, `deqms_result`, `deseq2_results` (with `na_reason` mapping), `curvecurator`, `mageck_gene_summary`. Importers must tolerate engine-version column renames and decimal-comma exports (SPEC §6.3). First verify each tool's exact output columns from official docs for a pinned tool version and record them in `packages/importers/<key>/SOURCE.md` (link + version). Extend `pnpm synth` with a fixture per format. Use the `add-importer` skill and `/batch` (see PROMPTS.md).
Definition of done:
- [x] Each importer has SOURCE.md and a passing golden test (`pnpm run test:importers`)
- [x] `pnpm check` exits 0

## Phase 10 — Pipeline runners and status (backend)
Status: done (cf1fb9b)
Goal: One runner interface launches runs locally, on AWS Batch or HealthOmics, and tracks status, logs and outputs reliably.
Spec: M4, §7.4, ARCHITECTURE §8   Features: PIPE-01 … PIPE-04
In scope: launch endpoint enforcing the Phase 7 QC gate (rejected while QC failed unless an approver override exists); `PipelineRunner` + adapters `local` (Nextflow in Docker running `pipelines/demo`; a fake runner for unit tests), `aws_batch` (SubmitJob head job, DescribeJobs, TerminateJob), `healthomics` (StartRun with requestId, GetRun, CancelRun, log stream ARNs); SQS consumer for `aws.batch` and `aws.omics` events with idempotent upserts; pg-boss poller for non-terminal runs; outputs → importer jobs → published releases → lineage edges; cost estimate fields; `pipelines/demo` writes fixture outputs (DIA-NN pg_matrix + limma table).
Risks: Batch head-job IAM specifics (verify against Nextflow's AWS docs); HealthOmics region list.
**Suggested split:** 10a = interface, local + fake runners, SQS consumer, poller, outputs → releases → lineage · 10b = AWS Batch and HealthOmics adapters.
Definition of done:
- [x] Adapter unit tests with mocked AWS SDK clients (start/status/cancel/logs mapping)
- [x] Launch rejected (422) while QC failed; accepted after an approver override (API test)
- [x] SQS consumer handles duplicate and out-of-order events (test)
- [x] Local: demo pipeline → succeeded → 2 releases published → lineage edges exist (integration test)
- [ ] Only if I provide a sandbox AWS account: one small real nf-core run through the Batch adapter with every status change recorded (I run the infra; you run the app) — waiting for a sandbox account
- [x] `pnpm check` exits 0

## Phase 11 — Pipelines UI
Status: done
Goal: Admins define pipelines; scientists launch and follow runs (v1 parity + run page).
Spec: M4, REFERENCE_V1 §5   Features: PIPE-05, PIPE-06
In scope: admin pipeline definitions (params_schema upload + preview); launch dialog generated from nf-schema (types, enums, defaults, help); prefill from experiment (SDRF path, species, contrasts); QC-gate message + approver override; live status on the experiments list (SSE or polling); run page (params, timeline, tasks, recent logs, deep links, outputs, re-run with edits, cancel); in-app notifications.
Definition of done:
- [x] e2e: launch demo pipeline from the list → status updates without refresh → run page shows logs and outputs → results flag set; screenshots
- [x] e2e: Launch is disabled with the QC reason for a `qc_failed` experiment; an approver overrides with a reason and launch works
- [x] Launch-form validation from nf-schema (unit tests)
- [x] `pnpm check` exits 0

## Phase 12 — Query compiler and query service
Status: done
Goal: Any QuerySpec is validated, scoped to the caller's programs, compiled to parameterized SQL and returned fast and safely.
Spec: M6, §6.2, §7.1, ARCHITECTURE §6   Features: QRY-01 … QRY-06
In scope: compiler (all typed operators, nested groups, NOT; inner/left/right joins on declared keys + advanced mode; per-join `where` compiled into the joined subquery so LEFT joins keep their semantics; explode `protein_ids`/`gene_names` with ambiguity flag; select/orderBy; cursor pagination; capped total count); read-only metadata kinds (`experiment_version`, `sample`, `file_object`, `pipeline_run` — SPEC §6.2) served from program-scoped Postgres views through DuckDB's postgres extension with a read-only DB role; program scoping injected before compilation; limits (timeout, row cap, memory semaphore); streaming exports CSV/TSV/Parquet to S3 + presigned URL + audit; result cache keyed by sqlHash + release IDs; `pnpm bench:query` generating 5M and 50M-row synthetic tables and timing typical specs.
Definition of done:
- [x] Compiler tests incl. injection attempts in column names, values and operators
- [x] Integration tests: filter, join (incl. a LEFT join with a per-join filter), explode, sort, paginate match hand-written SQL on fixtures
- [x] A differential-abundance release joins to `sample` metadata (dose, time, cell line) and is scoped to the caller's programs (test)
- [x] Benchmark p50/p95 recorded in ARCHITECTURE §6 (local numbers, labelled as such)
- [x] Export equals page rows for the same spec (test)
- [x] `pnpm check` exits 0

## Phase 13 — Data Explorer UI
Status: done
Goal: v1 Data Explorer parity plus typed filters, declared joins, saved views and copy-as-code.
Spec: M6, REFERENCE_V1 §6   Features: EXP-01 … EXP-05
In scope: dataset picker (by experiment / by kind across experiments / reference / metadata tables); react-querybuilder with typed value editors, AND/OR, nesting, NOT; join builder blocks (type, conditions, per-join filters, explode toggle, advanced pairs); AG Grid server-side datasource; column chooser; number formatting; export menu; saved views (private/program) + share links; copy as Python / R / QuerySpec JSON; state in the URL.
**Suggested split:** 13a = picker, filter builder, grid, export, URL state · 13b = join builder, saved views, share links, copy-as-code.
Definition of done:
- [x] e2e: SPEC M6 check end to end; screenshots
- [x] Playwright MCP exploratory pass; issues fixed and listed
- [x] `pnpm check` exits 0

## Phase 14 — Chart framework, compute service and reference charts
Status: todo
Goal: Schema-driven charting with server-side statistics; volcano and heatmap + dendrogram as reference implementations.
Spec: M7, §7.2, ARCHITECTURE §7   Features: VIZ-01 … VIZ-04
In scope: chart registry entries (volcano, heatmap, dendrogram); form generator (type-aware pickers, option controls, `requires` rules, Apply disabled until valid, inline errors); `/v1/charts/render` (QuerySpec → data → shaping → compute → Plotly figure JSON); apps/compute endpoints `cluster` (methods, metrics, leaf ordering, bootstrap N with seed), `kde`, `pvalues`, `zscore`, `pca`, `fit-4pl` with pydantic guards and structured errors; Plotly partial bundle (measure gz size, lazy-load); axis titles and layout options; provenance popover; PNG/SVG export; lasso → rows.
**Suggested split:** 14a = chart registry entries, form generator, `/v1/charts/render`, apps/compute endpoints and their tests · 14b = volcano and heatmap/dendrogram UI, provenance, export, lasso, bundle size.
Definition of done:
- [ ] Registry tests: every option and `requires` rule for the three charts
- [ ] Compute pytest: clustering matches a direct scipy reference; bootstrap deterministic with seed; guards return structured errors
- [ ] REFERENCE_V1 §8 heatmap/dendrogram defect scenarios show field-level errors (e2e)
- [ ] e2e: volcano with thresholds + labels; heatmap with row/column clustering; screenshots
- [ ] Bundle size recorded in ARCHITECTURE §3
- [ ] `pnpm check` exits 0

## Phase 15 — Remaining charts and omics presets (fan-out)
Status: todo
Goal: All 12 v1 chart types plus MA plot, PCA and QC panel, each with schema, tests and e2e.
Spec: M7, REFERENCE_V1 §7–8   Features: VIZ-05 … VIZ-08
In scope: `add-chart-type` skill + `/batch` for line, bar, scatter 2D, scatter 3D, box/violin, histogram/KDE, lollipop, bubble, pie/donut; then MA plot, PCA, QC panel by hand; layout options shared.
Definition of done:
- [ ] `pnpm e2e "VIZ-0[5-8]"` passes for every type (run once in the main checkout after the batch merges)
- [ ] Every row of REFERENCE_V1 §8 has a named test that passes
- [ ] `pnpm check` exits 0

## Phase 16 — Results pages and cross-experiment views
Status: todo
Goal: Automatic results pages, dose-response viewer, protein and compound pages, contrast comparison.
Spec: M8   Features: RES-01 … RES-05
In scope: experiment results page (QC panel, volcano per contrast with known-target overlay, top hits, dose-response summary, files, deterministic methods paragraph from run provenance); dose-response viewer (curves from responses + fitted parameters, small multiples, filters); protein page; compound page; comparison view (2–6 contrasts: log2_fc vs log2_fc scatter, overlap table, UpSet-style bars in Plotly).
**Suggested split:** 16a = results page, methods paragraph, dose-response viewer · 16b = protein page, compound page, comparison view.
Definition of done:
- [ ] e2e for each page on seeded + demo-run data; screenshots
- [ ] Methods paragraph unit tests (pipeline revision, tool versions, thresholds present)
- [ ] `pnpm check` exits 0

## Phase 17 — Search
Status: todo
Goal: Hybrid search over experiments and samples with ontology synonyms and strict permission filtering.
Spec: M9   Features: SRCH-01 … SRCH-03
In scope: search documents (searchable fields + names + ontology labels/synonyms); tsvector + GIN; embeddings table with provider abstraction (`none` default, `bedrock_titan_v2`, `voyage_4`, `local`) + HNSW with iterative scans; reciprocal-rank fusion; facets; ⌘K palette + search page; reindex on publish.
Definition of done:
- [ ] Golden queries on the seeded corpus: top-3 hit rate ≥ 90% with full-text only
- [ ] Cross-program permission leak test at API level
- [ ] `pnpm check` exits 0

## Phase 18 — Lineage, audit, admin and Part 11-ready controls
Status: todo
Goal: Trust features pharma IT asks about: lineage graph, audit viewer/export, re-auth on publish, versioned templates, lifecycle policies.
Spec: M10, M11, §10   Features: LIN-01, AUD-02, ADM-01 … ADM-03
In scope: lineage API (recursive CTE, depth) + graph UI (check the graph library licence first); audit viewer with filters + CSV export; per-entity history tab; re-auth on publish/approve (OIDC `max_age`); admin for templates (versioning + migration preview), picklists, ontology sources, role bindings and IdP group → role mapping, runner configuration, lifecycle policies, AI settings placeholder, system health.
**Suggested split:** 18a = lineage API + graph, audit viewer/export, history tab · 18b = re-auth on publish, admin screens (templates, picklists, ontology sources, roles and group mapping, runner configuration, lifecycle, health).
Definition of done:
- [ ] e2e: lineage of a published release; publish audit with reason + approver; template v1.1 behaviour (SPEC M11 check); screenshots
- [ ] `pnpm check` exits 0

## Phase 19 — AI assistant and curation
Status: todo
Goal: An optional assistant that answers questions through validated tools, with the user's permissions, approvals and provenance.
Spec: M12, §11, ARCHITECTURE §11   Features: AI-01 … AI-05
In scope: provider abstraction (`anthropic`, `bedrock`, `none`) + admin settings + budgets; tool registry — read: `search_experiments`, `get_experiment`, `list_datasets`, `describe_release`, `build_query` (returns a validated QuerySpec), `run_query`, `suggest_chart` (validated ChartSpec), `get_results_summary`, `get_lineage`; compute: `render_chart`, `run_analysis` (budgeted); write (approval): `apply_metadata_suggestions`, `create_saved_view`; assistant panel (streaming, tool-call cards showing the QuerySpec, "open in Explorer", approve/reject); OLS-constrained curation in the manifest editor; refusal handling; audit + provenance; `pnpm eval:ai` with ≥ 30 golden questions scored by result-row equivalence (stub provider in CI; real provider run manually).
**Suggested split:** 19a = provider abstraction, registry, read/compute tools, assistant panel, eval harness · 19b = write tools with approval, curation assistant, refusal handling.
Definition of done:
- [ ] Viewer's assistant cannot read another program's data (test)
- [ ] Write tools pause for approval (unit + e2e)
- [ ] Eval harness passes with the stub provider; real-provider score recorded in PROGRESS
- [ ] `pnpm check` exits 0

## Phase 20 — MCP server, SDK and webhooks
Status: todo
Goal: External assistants and notebooks use the platform with the same permissions.
Spec: M12, M13   Features: MCP-01, MCP-02, MCP-03, API-01, API-02
In scope: MCP server (TypeScript SDK v2, Streamable HTTP via the Fastify adapter) at `/mcp` exposing registry tools (summarised outputs < 25k tokens; write tools marked as requiring user interaction); OAuth 2.1 metadata + audience-validated tokens (customer IdP or platform-issued), PAT fallback for local clients; an Agent Skill bundle (`integrations/claude-skill/SKILL.md`) teaching a customer's Claude to use the MCP tools (explore an experiment, compare compounds, build a QuerySpec, cite releases); generated Python SDK wheel with examples; HMAC-signed webhooks for run status.
Definition of done:
- [ ] Integration test: list tools; call `search_experiments` as two users → different results
- [ ] Python SDK pytest against the local stack (list experiments, run a QuerySpec)
- [ ] Webhook signature verification test
- [ ] `pnpm check` exits 0

## Phase 21 — Infrastructure as code (plan only)
Status: todo
Goal: Terraform modules a customer's platform team can review and apply.
Spec: ARCHITECTURE §12   Features: OPS-02, OPS-03
In scope: modules in ARCHITECTURE §12; `envs/dev` example; GitHub Actions to build images → ECR and run `terraform plan` on PRs (apply is a human step outside Claude); fmt/validate, tflint, checkov (verify tools and licences) behind a root `infra:validate` script; `docs/DEPLOY.md` runbook; cost table refresh.
Safety: never run `terraform apply`/`destroy` (deny rules + hook). Use a sandbox AWS profile for `plan` only if I provide one. Don't install terraform, tflint or checkov yourself: if one is missing, tell me which version to install.
Definition of done:
- [ ] `terraform validate`, tflint and checkov pass (paste output)
- [ ] `docs/DEPLOY.md` covers prerequisites, variables, plan/apply by a human, rollback
- [ ] `pnpm check` exits 0

## Phase 22 — Hardening and v2.0 release
Status: todo
Goal: Production readiness — observability, backups, performance, security, accessibility, docs and demo.
Spec: §9, §10, ARCHITECTURE §13   Features: OPS-04 … OPS-07
In scope: OTel + pino verified end to end; alarm list; backup/restore runbook (`docs/RUNBOOK.md`) rehearsed locally; load test for explorer and charts behind `pnpm run load:test` (verify tool); `/security-review` and `/code-review high` on the full diff; dependency audit + SBOM; licence scan vs allowlist (ARCHITECTURE §9) behind `pnpm run licence:scan`; a11y pass on all pages; `docs/USER_GUIDE.md` and `docs/ADMIN_GUIDE.md` with e2e screenshots; demo script + demo dataset; replace the kit README with a product README; CHANGELOG; tag `v2.0.0`.
Definition of done:
- [ ] Load test meets SPEC §9 targets locally, or gaps documented
- [ ] If a sandbox AWS account exists: `pnpm bench:query` repeated in-region and recorded; a human has rehearsed a clean install from `docs/DEPLOY.md` (target: one working day) and a restore from backup
- [ ] Security findings fixed or ticketed in PROGRESS
- [ ] Licence scan: zero disallowed licences
- [ ] Guides complete; full e2e green; tag created
- [ ] `pnpm check` exits 0

## Phase 23 (optional) — Legacy data onboarding
Status: todo
Goal: Bulk-onboard a customer's historical data (typically hundreds of TB across object storage, another cloud and on-prem disks, plus a relational database).
Features: ING-06
In scope: bulk link-prefix with manifest inference from folder/file naming; batch importer runs; migration report (counts, failures, checksums); relational extraction through DuckDB's postgres/mysql scanners into reference datasets; resume/retry.
Definition of done:
- [ ] Integration test on a synthetic legacy layout; migration report generated
- [ ] `pnpm check` exits 0
