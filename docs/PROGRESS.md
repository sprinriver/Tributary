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

## 2026-10-29 — Phase 3: Auth, roles and audit — done
- Built: OIDC BFF (`/v1/auth/login|callback|logout|me`, authorization code + PKCE via openid-client, flow state in
  a signed lax cookie, session in Postgres `app_session` with an httpOnly SameSite=strict cookie + CSRF token);
  personal access tokens (`/v1/auth/tokens`; `trb_` prefix, sha256-hashed, read/write scopes, expiry, revoke);
  service-account `kind` on app_user; CASL abilities from role bindings (user or group) plus an IdP group → role
  mapping (`AUTH_GROUP_ROLE_MAP`; dev default admin/scientist/viewer realm roles); auth plugin (401/403, PAT scope,
  CSRF); audit helper (`writeAudit`, reason from `X-Change-Reason`, same transaction as the change); minimal
  experiment create/get/patch to prove enforcement; web sign-in link, user menu, `RequireAuth` guard, 403 page;
  Keycloak realm `groups` claim mapper + post-logout redirect.
- Decisions (and why):
  - Callback answers with a same-site HTML refresh instead of a 302, so the strict session cookie is sent on the
    next navigation (strict cookies are dropped on redirect chains that start at another site).
  - Login group memberships are mirrored into app_group/group_member; mapped roles are derived per request, not
    stored, so changing the mapping takes effect immediately.
  - Role actions: viewer read; contributor read/create/update; approver + publish/approve; admin manage (program);
    system_admin manage all.
  - CI e2e now migrates the database and runs every e2e spec (was smoke only).
  - DB-01's exact table list gained `access_token` and `app_session` (separate commit; still an exact match).
- Dependencies added: openid-client 6.8.8, @casl/ability 7.0.2 (7.0.3/7.1.0 were a day old), @fastify/cookie 11.1.3
  (11.1.4/5 two days old); zod and kysely declared directly in apps/api.
- Evidence: `pnpm check` ✓ (api 13 tests) · `pnpm run test:api AUTH-02` ✓ · `pnpm run test:api AUD-01` ✓ ·
  `pnpm e2e "AUTH-01|smoke"` ✓ (3) against local Keycloak · screenshot artifacts/phase-3/signed-in.png.
- Gaps and follow-ups: re-auth on publish (`max_age`) is wired in `OidcClient.startLogin` but used in Phase 18;
  helmet and rate limits in Phase 22; Playwright MCP walk-through not done (UI is minimal until Phase 5).
- Commit: cd4a054

## 2026-10-29 — Phase 4: Registry API — done
- Built: registry routes per SPEC §8 — `/v1/programs`, `/v1/templates`, `/v1/experiments` (create with first draft,
  list, get, rename, archive/unarchive, version history), `/v1/versions/:id` (get, patch draft, publish, clone,
  archive, diff), samples (list, bulk upsert with per-cell errors, delete, validate) and contrasts (list, replace).
  Migration 0009: `program.requires_approval`, `experiment.archived_at`, `sample.raw` + `sample.position`,
  `experiment_version.is_latest_published` maintained by a trigger. `API_ROUTES` registry in packages/contracts →
  OpenAPI `paths` in `pnpm gen` and a typed web client (`apps/web/src/api.ts`); every response is parsed through
  its contract schema (`respond`), so the API and the published OpenAPI cannot drift.
- Decisions (and why):
  - Publish re-validates the stored raw cells against the pinned template + sample custom fields (errors indexed by
    manifest order), needs ≥ 1 sample and required experiment custom values, and a reason (body or header).
  - Contributors may publish; programs with `requires_approval` also need the `approve` action (approver/admin).
  - Diff compares raw cells per sample key (empty = missing) plus version fields, custom values, custom field
    keys and contrast labels; output sorted for exactness.
  - Latest-published = highest published version number, kept by a trigger that clears before it sets (the
    partial unique index never sees two flagged rows).
  - Samples get an identity `position`: inserts in one transaction share `created_at` and uuidv7 is not monotonic
    within a millisecond, so order was unstable under load (found by a failing run inside `pnpm check`).
  - The pg `date` type is returned as `YYYY-MM-DD` (no time-zone shift); codegen maps it to string.
  - Built-in seed template is used when no template rows exist for an assay type.
- Dependencies added: none new (zod declared in apps/web).
- Evidence: `pnpm check` ✓ · `pnpm run test:api REG-0N` ✓ for N = 1…6 (8 tests) · API suite run 3× green ·
  OpenAPI regenerated (65 generated files) · web client compiles · acceptance tests untouched.
- Gaps and follow-ups: local dev database seeded before 0009 has empty `sample.raw` — reset with
  `pnpm db:migrate down && pnpm db:migrate && pnpm db:seed`.
- Commit: 7835182

## 2026-10-29 — Phase 5: Registry UI — done
- Built: experiments list (filters in the URL: name, text, assay type, program, date range, archived; sortable
  headers; column chooser; cursor pagination; row actions *Launch pipeline* — disabled with a tooltip until
  pipelines exist — and *Create version*), 3-step create wizard (details → experiment custom fields with searchable
  flag → review), experiment page (version picker, status chip, Overview / Samples / Versions tabs), Samples tab
  with a TSV paste box and per-cell problems (the full grid editor is Phase 6), version history with publish
  reasons, version diff (fields, custom values, sample rows), publish dialog requiring a reason; design tokens in
  `apps/web/src/styles.css` (no UI kit: no Celeste repo); shared `Field`, `Dialog` (native `<dialog>`), `Tabs`.
- Walk-through findings fixed: duplicate "Experiments" link names (back link now "← Experiment list"); status
  badges inside table rows were live regions, so rows lost "Published" from their accessible name (StatusBadge
  `live={false}`); action-cell flex layout broke table borders; stacked paragraph spacing; a version page stuck on
  "Loading…" when the version request failed (errors now shown); API returned 400 for `content-type: application/json`
  with an empty body (now treated as no body) and 500 for malformed ids (now 400) — new tests in `apps/api/src/http.test.ts`.
- Decisions: version summaries carry `publish_reason`; CI e2e also runs `pnpm db:seed`.
- Dependencies added: @axe-core/playwright 4.14.0 (dev, MPL-2.0).
- Evidence: `pnpm check` ✓ · `pnpm e2e "REG-0[78]"` ✓ (3) · full `pnpm e2e` ✓ (6) · axe: zero serious/critical on
  `/experiments` and `/experiments/new` · screenshots in artifacts/phase-5/ · acceptance tests untouched.
- Gaps: walk-through done from Playwright screenshots, not the Playwright MCP (not reliably connected here).
- Commit: 5b83a57

## 2026-10-30 — Phase 6: Sample manifest editor — done
- Built: manifest editor on the Samples tab (AG Grid Community): file upload parsed in a Web Worker (Papa Parse,
  delimiter auto-detect) → preview (row count, delimiter, first rows) → column mapping (exact-name auto-map,
  program presets, "Save mapping as preset") → apply; "Paste TSV block" dialog with the same mapping step; add /
  edit / delete rows; sample-level custom columns (dialog + chips with searchable flag, saved as version custom
  fields); live per-cell validation with the same `validateManifest` schema as the API (red cells, tooltip
  messages, "N problems", "Only rows with problems" filter); ontology typeahead cell editor → `/v1/ontology/search`
  (OLS4 `/api/search`, Postgres cache tables `ontology_term_cache` / `ontology_query_cache`, local fallback when
  offline); quantity cells show canonical values ("1000 nM (1e-6 M)"); plate view (96/384, colour by factor,
  Okabe–Ito palette, click a well to focus its row); contrasts tab; SDRF export/import through apps/compute
  (`/sdrf/export|import`, validated with sdrf-pipelines `ms-proteomics` 1.1.0, ontology checks off).
  API: `/v1/ontology/search`, `/v1/programs/:id/mapping-presets`, `/v1/versions/:id/sdrf` (GET download, POST
  import); outbound HTTP injectable (`buildApp({ fetch })`); migration 0010.
- Decisions (and why):
  - SDRF `comment[instrument]` comes from the experiment's `instrument` custom field; export fails with a
    field-level error when it is missing — sdrf-pipelines rejects "not available" and we never invent an instrument.
    Other unfilled SDRF columns use SDRF reserved values or documented defaults (trypsin, label free, replicate 1).
  - Upload/paste merge by sample key only against rows that existed before the import; duplicates inside one
    upload stay separate rows so validation flags them (found by the SPEC M2 e2e).
  - Saving a preset under an existing name updates it (200) instead of failing (409).
  - Grid rows keep their ids across reloads (by sample key) and row animation is off, so a save never shows rows
    twice; `Dialog` renders only while open (no name collisions with closed dialogs).
  - pyright `reportMissingTypeStubs` off for apps/compute (sdrf-pipelines ships no stubs); licence allowlist adds
    the PSF free-text name (defusedxml).
- Test amendments before the test commit was pushed (all in `e2e/manifest.spec.ts` / `tests/test_sdrf.py`, folded into
  the unpushed test commit): SDRF tests supply an instrument and a new test requires it; error cells checked by
  class `cell-invalid` (AG Grid cannot put attributes on cells); new-row key `N1` → `NEW1` (case-insensitive text
  match also hit `run1.raw`); row selector `.ag-row` (AG Grid 36 renamed the row container). DB-01 table list gained
  the three Phase 6 tables (separate commit).
- Dependencies added: ag-grid-community / ag-grid-react 36.2.0, papaparse 5.7.0, @types/papaparse 5.5.2 (web);
  sdrf-pipelines 0.1.6 (compute; Apache-2.0).
- Evidence: `pnpm check` ✓ · `pnpm e2e "MAN-0"` ✓ (5, incl. the SPEC M2 96-row check and SDRF download) · full
  `pnpm e2e` ✓ (11) · `pnpm run test:api MAN` ✓ (6, incl. second OLS lookup served from cache) · `pnpm run
  test:compute -k MAN_06` ✓ (7) · `pnpm run licence:scan` ✓ (195) · screenshots in artifacts/phase-6/.
- Gaps: OLS4 is not reachable from the build container, so the live OLS path is covered by a fake upstream only;
  experiment-level "instrument" has no dedicated field yet (custom field); Playwright MCP walk-through replaced by
  screenshot review (invalid cells had no visible style — fixed).
- Commit: 68fa2e4

## 2026-10-30 — Phase 7: Files and ingest — done
- Built: browser → S3 presigned multipart upload (`POST /v1/files/uploads`, re-sign `POST /v1/files/:id/parts`, resume
  `GET /v1/files/:id/parts` via ListParts, `…/complete`, `…/abort`; 16 MiB parts, 1 h URLs); web uploader with 4
  parallel parts, per-part retry with a fresh URL and backoff, resume after reload (localStorage → ListParts), XHR
  progress; Files tab (upload, role, status badges, format, QC reason, sha256) and a "Pipeline launch" gate panel
  with the approver override dialog. Link existing objects by prefix (`POST /v1/files/link`, only under configured
  landing prefixes, default `incoming/`; idempotent). Ingest job (`runIngest`) on pg-boss (`file-ingest` queue,
  worker in the API process; schema from migration 0007, client never migrates): one streaming pass computes
  sha256 + size, sniffs the head, fully decompresses gzip/BGZF, keeps a 64 KiB tail; contract checks (declared
  format, registered size) and per-format QC with a cited source per check; stores the QC report. State machine
  `INGEST_TRANSITIONS` (contracts) with `transitionFile` (row lock, 409 `illegal_transition`, audit row per
  transition; job transitions run as an `ingest` service account). QC gate `canLaunch(db, versionId)` +
  `GET /v1/versions/:id/qc-gate`; approver override `POST /v1/versions/:id/qc-override` (reason ≥ 10 chars,
  covers the files failed at that moment, audited `qc.override`). Lifecycle: per-role policies (defaults: raw →
  STANDARD_IA after 30 d, work expire 30 d, exports expire 7 d), admin `GET/PUT /v1/admin/lifecycle-policies`
  (system_admin only, audited) returning the S3 lifecycle rules for Terraform; objects tagged `tributary-role` /
  `tributary-lifecycle` at ingest. Migration 0011; ADR 0016.
- Decisions (and why):
  - sha256 is computed server-side after upload (ADR 0016): multipart ETags are not content hashes, linked
    objects need the job anyway, and browsers have no streaming sha256.
  - Custom sniffers instead of `file-type` (SPEC M3 suggested it): gzip/BGZF are 3–4 byte signatures, `file-type`
    cannot tell BGZF from gzip nor recognise FASTQ/VCF/CSV/TSV/vendor MS formats, so it would add a dependency for
    little. Vendor formats without a public signature (.wiff.scan, .tdf_bin, .baf) are recognised by extension and
    say so in the report (`detected_by: extension`).
  - Files are added to drafts only (DB trigger, TR409); ingest status changes continue after publish.
  - Re-uploading a name whose previous file failed QC rejects the old file (audited); a live duplicate is 409.
  - Gate blocks while files are still ingesting; an override covers only the files failed when it was made.
  - Admin endpoints check the global `system_admin` binding, not CASL `can('manage','all')` (which would also
    match program admins).
  - Lifecycle STANDARD_IA transitions need ≥ 30 days (S3 constraint), validated in the contract.
- Test amendments before push (folded into the unpushed test commit): e2e corrupted-gzip fixture now damages the
  middle of the stream (the repetitive FASTQ compresses to 392 bytes, so bytes 400–520 changed nothing);
  prettier formatting of the API test. Uploader unit tests (`apps/web/src/files/uploader.test.ts`, ING-01) were
  written with the implementation, not in the test commit. DB-01 table list gained `qc_override`,
  `lifecycle_policy` (separate commit).
- Dependencies added: @aws-sdk/client-s3 3.1156.0, @aws-sdk/s3-request-presigner 3.1156.0 (Apache-2.0), pg-boss
  12.38.0 (MIT) to apps/api (already pinned elsewhere / ARCHITECTURE §3).
- Evidence: `pnpm check` ✓ (api 58 tests incl. 7 ING integration tests vs a SeaweedFS container and 22 sniffer
  tests) · `pnpm run test:web ING-01` ✓ (3) · `pnpm e2e ING-04` ✓ · full `pnpm e2e` ✓ (12) · `pnpm run
  licence:scan` ✓ · screenshots in artifacts/phase-7/.
- Gaps: multipart tested to 200 MB locally (SPEC says tested to 50 GB — needs real S3); link-by-prefix reads only
  the raw bucket (other customer buckets need IAM + config, Phase 21); QC for compressed mzML/zip skips tail
  checks; bucket lifecycle rules are generated, not applied (Terraform, Phase 21); Playwright MCP walk-through
  replaced by e2e screenshots.
- Commit: 4e52deb

## 2026-10-30 — Phase 8: Dataset releases and first importers — done (Iceberg read pending)
- Built: `packages/importers` framework — load (delimiter from extension/header, decimal-comma detection),
  importer `build` → DuckDB SQL (identifiers quoted, values as parameters), contract casts, quality rules compiled
  from the contracts to SQL assertions (`<col>_not_null`, range/enum/unique, `<col>_numeric` parse checks,
  importer rules), column stats, transformations and source metadata (original columns, tool version, NA tokens).
  Importers: `diann_pg_matrix` (melt with `UNPIVOT INCLUDE NULLS`, runs → manifest by instrument_run or raw_file
  name, ambiguity rejected), `limma_toptable` (explicit contrast, BH default recorded, no-identifier tables refused),
  `custom_tabular` (mapping + constants, any importable kind), reference presets `reference_compound`,
  `reference_compound_property`, `reference_target_annotation`, `reference_id_mapping` (versioned by source
  release). SOURCE.md for both tool importers. apps/query: internal token, `/internal/imports` (download source →
  run importer → Parquet `COPY` → upload once) and `/internal/releases/read`. API: `POST /v1/imports` (QC-passed
  files only; staged or rejected release, audited), `GET /v1/datasets`, `/v1/datasets/:id`, `/v1/releases/:id`
  (contract, stats, validation, source, transformations, lineage stub), `/preview` (DuckDB read), `publish` /
  `reject` with a reason (approver when the program requires approval; immutable after, DB trigger),
  `GET /v1/contracts/:kind/odcs` (ODCS v3.0.2 YAML), `GET /v1/importers`, import presets per program. Web:
  Datasets catalog page, release page (status, publish dialog, quality rules, schema, column stats, provenance,
  first rows) and an "Import…" dialog on the Files tab. Migration 0012 (release importer/file/validation/reason,
  dataset identity index, `import_preset`); ADR 0017.
- Decisions (and why):
  - Releases are immutable Parquet objects + Postgres catalog (ADR 0017): `extensions.duckdb.org` is denied by
    this environment's network policy, so DuckDB's iceberg/httpfs extensions cannot be installed. The Iceberg
    adapter is the follow-up once the host is allowed (CI can download it).
  - Imports run synchronously API → query (one at a time per query process); a pg-boss job can wrap it in Phase 10.
  - Failed rules store a `rejected` release with the failures (nothing written to storage), so the rejection is
    visible in the catalog with its reasons.
  - Empty DIA-NN cells stay as rows with null intensity; `log2_intensity` only where intensity > 0 (recorded).
  - Header names with control characters are refused (they cannot be quoted as identifiers); CSV/TSV QC now
    requires text content (Phase 7 gap found by the API test: a binary `.tsv` passed QC).
  - Omics review fixes: integer columns never round (non-integral → `<col>_numeric`), raw_file URIs matched by file
    name, ambiguous run matches rejected (`run_ambiguous`), limma refuses tables without identifiers, the contrast
    is always chosen explicitly, defaulted `feature_type` recorded plus a warn rule for non-accession IDs.
    Deferred review nits: decimal-comma detection over all columns (thousands separators), ±Inf in min-only range
    rules, units/log base for custom_tabular dose and fold-change columns, adj_method validation, CI level,
    source row-count reconciliation, possible DIA-NN 2.x `N.Sequences` columns (unverified; fail loudly).
- Test amendments before the test commit was pushed: none to the test commit; the protein-group count in DS-02 was
  derived from the fixture before committing. Review regression tests were added afterwards (3 new tests).
  DB-01 gained `import_preset` (separate commit).
- Dependencies added: @duckdb/node-api 2.0.0-r.1 and zod 4.6.7 to packages/importers; @aws-sdk/client-s3 3.1156.0
  and zod to apps/query (all already pinned elsewhere).
- Sources read: DIA-NN README (GitHub, 2.x), limma `man/toptable.Rd` and `R/toptable.R` 3.99.3 (bioc mirror; read
  only — GPL, nothing copied). SOURCE.md files await the owner's review.
- Evidence: `pnpm check` ✓ (importers 19, query 4, api 66, db 16, web 17, contracts 58) · `pnpm e2e` ✓ (13, incl.
  DS-05) · screenshots in artifacts/phase-8/.
- Gaps: Iceberg/S3 Tables read (blocked host, see above); `datacontract lint` not run (CLI not installed); reference
  files are uploaded through an experiment version (no program-level upload yet); S3 Tables region check needs AWS.
- Commit: daddeed

## 2026-10-30 — Phase 9: Remaining importers — done
- Built: 14 importer keys for the rest of SPEC §6.3 — `diann_report_parquet` (precursor_quant) and
  `diann_report_qc` (per-run counts → qc_metrics) over one report.parquet, `alphadia_precursors`,
  `alphadia_pg_matrix`, `mzqc` (JSON), `spectronaut_report`, `maxquant_protein_groups`,
  `fragpipe_combined_protein`, `quantms_qpx` (Parquet with list columns), `msstats_comparison`, `deqms_result`,
  `deseq2_results`, `curvecurator`, `mageck_gene_summary` — each with SOURCE.md citing what was read (URL, version,
  date) and a golden test. Shared builders in `packages/importers/src/shared/` (run → manifest matching, wide
  matrices, long tables, differential tables). Loader reads Parquet (scalars as text, lists as VARCHAR[]) and JSON.
  Synthetic tool fixtures in `fixtures/tools/` from `pnpm synth` (Parquet inputs are converted from committed TSV by
  DuckDB inside the tests, so the fixture drift check stays exact). qc_metrics 1.1.0 adds status `not_assessed`
  (ADR 0018). API/query pass all registered contrasts and manifest conditions; the import dialog asks for
  CurveCurator doses exactly as in the TOML.
- Decisions (and why):
  - One importer = one kind, so the DIA-NN report has two keys (precursors, QC counts).
  - MaxQuant / QPX flagged rows (reverse, contaminant, site-only, decoy) are removed only when flagged, recorded and
    counted in a `flagged_rows_removed` warning; `options.keep_flagged` keeps them. Zeros from MaxQuant/FragPipe are
    kept as reported; log2 is null for them.
  - Run matching unions sample_key / instrument_run / raw-file name candidates; ambiguity or two runs per sample fail.
  - MSstats: log base read from the header (log2FC / log10FC); p is null when no test was possible.
  - CurveCurator: dose_unit must be M (pEC50 = −log10 EC50 in that unit); top/bottom = Curve Front/Back as named.
  - Per-file `index.ts` per importer instead of the reference's detect/map/sql/rules split (shared builders hold the
    SQL); diann_pg_matrix and limma_toptable keep the full split.
- Omics review (19 findings): fixed the P1s — NaN/"Filtered" intensities now null with log2 guarded by isfinite;
  CurveCurator unit taken from the TOML; MSstats base from the header; cross-level run ambiguity and
  sample-with-two-runs rules; DESeq2 LRT recorded as full vs reduced model — and P2s: DEqMS/mzQC refuse
  inputs without identifiers, MSstats completeMissing reason and percentage range warning, QPX multiplexed labels
  refused, MaxQuant SILAC columns excluded, AlphaDIA fallback precursor id includes modifications.
  **Open decision for the owner:** tools report p = 0 on underflow (DESeq2 Wald |z| > 38 is common); the (0, 1]
  convention (and the Phase 8 DS-03 test) rejects such imports. Options: keep rejecting, clamp to the smallest
  double with a recorded count, or store null with an na_reason. Deferred P2s: input-row reconciliation, threshold
  style / LFC shrinkage metadata, FragPipe indistinguishable proteins, AlphaDIA matrix NA semantics, tool versions
  (always "unknown" until the UI asks), CurveCurator fold-change orientation in the contract.
- Test amendments: the pushed Phase 9 test "msstats_comparison converts log10 fold changes when log_base is 10"
  asserted wrong science (it multiplied log2 values); replaced by a test that reads log10FC from the header and
  refuses a contradicting option. Review regression tests added in `tools-review.test.ts`.
- CI: e2e failed since Phase 6 — the live OLS4 on CI returned many "Homo sapiens …" options (the e2e API now uses an
  unreachable OLS_URL, i.e. its built-in terms), and since Phase 8 SeaweedFS ran out of volumes for the second bucket
  (`-volume.max=200 -master.volumeSizeLimitMB=256`).
- Evidence: `pnpm check` ✓ · `pnpm run test:importers` ✓ (49) · `pnpm e2e` ✓ (13) · `pnpm run test:compute -k SYN` ✓.
- Gaps: MaxQuant and Spectronaut official docs unreachable (columns via MSstatsConvert; unverified names listed in
  SOURCE.md); AlphaDIA retention-time unit undocumented (not imported); SOURCE.md files await the owner's review.
- Commit: cd59ffb

## 2026-10-30 — Phase 10: Pipeline runners and status (backend) — done (real AWS run pending a sandbox)
- Built: `PipelineRunner` (SPEC §7.4) with adapters `local` (Nextflow `nextflow/nextflow:25.10.0` in Docker,
  offline, `pipelines/demo`; status from `docker inspect`, lines from `docker logs`, outputs uploaded to
  `s3://<work>/runs/<id>/output/`), `aws_batch` (SubmitJob head job, DescribeJobs, TerminateJob, CloudWatch links),
  `healthomics` (StartRun with requestId = run id, GetRun, CancelRun, WorkflowLog stream links) and `fake` (tests).
  API: `GET /v1/pipelines`, `POST /v1/admin/pipelines`, `POST /v1/runs` (published version only; QC gate → 422
  `qc_gate` until an approver override; audited), `GET /v1/runs/:id` (status history, outputs),
  `GET /v1/versions/:id/runs`, `POST /v1/runs/:id/cancel`, `GET /v1/runs/:id/logs`. Status: `applyRunStatus`
  records every observation idempotently per (run, external status, time), applies only newer ones, terminal is
  final, audits each change; EventBridge handler for aws.batch / aws.omics; SQS consumer (delete only after
  success); pg-boss `runs-poll` every minute. Succeeded runs: `output_importers` files → file objects of the run →
  ingest QC → import → release published by the `pipelines` service account; lineage version → run → file →
  release. `pipelines/demo` (DIA-NN pg_matrix + limma table from fixtures). Migration 0013 (run events, run
  outputs as files, `fake` runner, status_at / outputs_processed_at).
- Decisions (and why):
  - Pipelines run on published versions only (outputs must describe an immutable manifest).
  - A launch records the contrast in params when the version has exactly one; pipeline imports use that contrast
    (its orientation is the pipeline's input), unlike manual imports, which always ask.
  - Releases from pipeline outputs are auto-published by the service account with a reason naming the run
    (DoD: "2 releases published"); a release that fails its rules stays rejected and visible.
  - AWS clients are injected `{ send }` objects: adapter tests stub them, no aws-sdk-client-mock dependency.
  - `importFile` extracted from the import route and shared with run outputs.
- Dependencies added: @aws-sdk/client-batch, client-omics, client-sqs, client-cloudwatch-logs 3.1156.0 (Apache-2.0).
- Evidence: `pnpm check` ✓ (api 76) · `pnpm run test:api PIPE` ✓ (10, incl. the demo pipeline in Docker →
  succeeded → 2 published releases → lineage) · `pnpm e2e` ✓ (13).
- Gaps: no real AWS run (needs a sandbox account; Batch head-job IAM per Nextflow's AWS docs and HealthOmics region
  list to verify then); Batch/HealthOmics `recentLogs` return [] (logs:GetLogEvents IAM in Phase 21); cost
  estimates stay null.
- Commit: cf1fb9b

## 2026-10-30 — Phase 11: Pipelines UI — done
- Built: admin pipelines page (`/admin/pipelines`, system admins): nf-schema JSON upload with a live preview of the
  generated form, output importers, runners; launch dialog generated from nf-schema (draft-07 `definitions` and
  2020-12 `$defs` groups; types, enums, defaults, min/max, pattern, help; hidden params kept out) with prefill from
  the experiment (species → `organism`/`species`, contrast labels → `contrasts`/`contrast`; a re-run's values win);
  QC gate panel with approver override inside the dialog; experiments list shows the latest run status and a
  Results flag and polls while a run is active; run page (`/runs/:id`): params, status timeline, recent log lines,
  log deep links, outputs with their releases, cancel, re-run with edits; header "Runs" notifications menu
  (`GET /v1/me/runs`: my runs of the last 7 days, finished-since-last-opened count). The demo pipeline is seeded
  for the local runner (`pnpm db:seed`, idempotent) and gained a `delay_seconds` test param.
- Decisions (and why):
  - Live status by polling (TanStack Query `refetchInterval` while a run is active), not SSE: no extra
    infrastructure, and the run status itself is poll/event-driven server-side.
  - The local runner reports a `running` observation at the container's StartedAt when it first sees a finished
    container, so short runs still show running in the timeline.
  - Notifications are in-app only (read state per browser in localStorage); email/webhooks come with Phase 20.
  - The QC gate panel sits outside the launch `<form>`: the override dialog's own form nested inside it caused a
    native GET submission (page reload).
- Evidence: `pnpm check` ✓ · `pnpm run test:api PIPE` ✓ (11) · `pnpm run test:web PIPE` ✓ (5) · `pnpm e2e` ✓ (16);
  screenshots in `artifacts/phase-11/`. MAN-03 failed once under full-suite load (paste dialog still waiting for
  the preset save after 5 s) and passed 3/3 alone and in the next full run.
- Gaps: SDRF path prefill (needs the SDRF materialised into the run's work bucket; with the AWS runners, Phase 21);
  task-level table on the run page (Nextflow trace parsing) not built — the timeline shows run-level status only.
- Review: plan-reviewer subagent could not run (usage limit); to re-run before the next phase finish.
- Commit: cfa9112

## 2026-10-31 — Phase 12: Query compiler and query service — done
- Built: QuerySpec compiler in apps/query (`src/compiler/`): every typed operator, nested groups and NOT,
  inner/left/right joins on declared keys (`checkJoinKeys` in contracts) plus role-gated advanced mode
  (`join.advanced`, any role above viewer), per-join `where` compiled inside the joined CTE (LEFT joins keep
  unmatched rows), one explode per query (`explode_value`, `explode_ambiguous`), select/orderBy, deterministic
  order (release file + row number tiebreak), cursor pagination bound to the sqlHash, capped count. All user
  values are `$pN` parameters; release files are a LIST parameter. Runner: per-query timeout (repeated
  interrupt), row cap, concurrency semaphore, page cache for release-only queries (key: sqlHash + page),
  DuckDB memory/threads/temp dir from env. Exports (CSV/TSV/Parquet) run the same SQL via `COPY … TO` and are
  uploaded to the work bucket; API returns a presigned URL and audits `query.export` (format, rows, sqlHash,
  release ids, spec, reason). API `POST /v1/query`, `POST /v1/query/export`: program scoping first (kind sources
  → latest published release per dataset in the caller's programs; release ids must be published, visible, one
  kind, one release per dataset), then validation against the resolved contracts. Metadata kinds from
  `query_meta` views as `tributary_query_ro` (migration 0014; ADR 0019). `pnpm bench:query`.
- Decisions (and why):
  - Metadata via read-only views + per-request temp tables, not DuckDB's postgres extension (not installable
    here; ADR 0019).
  - Negations keep NULL rows (omics review): `!=`, `notIn`, `doesNotContain`, `notBetween` and NOT groups
    would otherwise drop NA values silently.
  - Offset cursors (simple, exact with the deterministic order); keyset cursors deferred to Phase 22 (bench).
  - `sample` contract 1.1.0 (additive): ontology ids, `time_display`, `raw_file` (omics review).
- Dependencies: none new (`@tributary/db` moved to apps/query dependencies; lockfile importer entry only).
- Evidence: `pnpm run test:query` ✓ (18) · `pnpm run test:api QRY` ✓ (4) · `pnpm run test:contracts QRY` ✓ (3) ·
  `pnpm run test:db` ✓ (16) · `pnpm bench:query` (numbers in ARCHITECTURE §6) · `pnpm check` ✓ · `pnpm e2e` ✓.
- Review: omics-reviewer — fixed: NULL-dropping negations, sample view time_display/raw_file/ontology ids,
  duplicate releases of one dataset; documented (ARCHITECTURE §6): explode ambiguity meaning and exact
  accession matching, metadata views include drafts, kind sources span all published versions unless
  `latestPublishedOnly`. Phase 11 plan-review still outstanding (usage limit at the time).
- Test amendments: apps/api `query.test.ts` setup uploaded the file after publishing the version (files go to
  drafts only); reordered (no assertion changed). Added a NULL-negation regression test (query.test.ts).
- Gaps: 50M-row single-file pages take 1.6–7.3 s locally (SPEC M6 target met at 5M only; Phase 22); Iceberg
  sources still unread (Phase 8 gap); count is a second scan.
- Commit: 0aa1edb

## 2026-10-31 — Phase 13: Data Explorer UI — done
- Built: `/explore` (nav "Explore"): dataset picker (kind grouped as experiment / reference / metadata tables; a
  single published release or every release of the kind in my programs; latest published versions only);
  react-querybuilder filters with typed operators from the contract matrix, AND/OR, nested groups, NOT, typed
  value editors (number/date/checkbox), empty values caught before running; join builder blocks (type, kind,
  alias, conditions limited to declared keys unless "Advanced", per-join filters, explode toggle); AG Grid
  results (server order, header click = server sort, first column pinned, scientific notation for p/q values
  and tiny numbers, auto height for 25-row pages), pager with cursors, column chooser, export menu
  (CSV/TSV/Parquet → presigned download link); saved views (`/v1/views`: private or program; 404 for anyone
  who may not see one; owner-only soft delete; audited) and share links (`/explore?view=<id>`); copy as
  Python (requests + pandas, paging), R (httr2) or QuerySpec JSON; state in the URL (`?q=` base64url spec).
- Decisions (and why):
  - Pagination in our own pager (cursor stack) with AG Grid's client row model per page: the server cursor is
    opaque and bound to the query, so AG Grid's infinite model (arbitrary block offsets) does not fit.
  - New joins default to the `sample` metadata kind on the first shared declared key (the common case: results
    → sample factors); any kind can be picked.
  - Views store the QuerySpec only; data is always re-scoped to the viewer's programs when a link is opened.
- Dependencies added: react-querybuilder 8.25.0 (MIT; pinned in ARCHITECTURE). Note: published 2026-10-12, i.e.
  younger than the 90-day rule — taken because ARCHITECTURE pins this exact version; please confirm or name an
  older pin.
- Evidence: `pnpm check` ✓ · `pnpm run test:api EXP` ✓ (2) · `pnpm run test:web EXP` ✓ (5) · `pnpm e2e` ✓ (21);
  screenshots in `artifacts/phase-13/`.
- Exploratory pass: the Playwright MCP could not start (it expects Google Chrome at /opt/google/chrome; only
  the bundled Chromium exists here), so the pass was scripted with Playwright on the same engine. Fixed:
  rows/columns hidden by grid virtualisation; identifier column scrolling away after sort (pinned);
  ambiguous builder control titles; an empty numeric filter left the page on "Loading…" while 400s were
  retried (now: inline message, no retry on 4xx); "between" label promised comma input but shows two boxes.
- Test amendments (before first green, mechanics only): e2e `selectOption` with a RegExp label is not
  supported (helper resolves the option text first); tab locator `R` needed `exact`; grid column reader
  uses row-index/col-id instead of AG Grid container classes; API views test ordered audit rows by a
  non-existent `created_at` (column is `at`). Web unit tests (`spec.test.ts`) were written after the code.
- Gaps: no "share token" links for people outside the program (column exists, unused); saved views cannot be
  renamed/updated yet; chart part of views comes with Phase 14.
- Commit: c07ffd0

## 2026-10-31 — Phase 14: Chart framework, compute service and reference charts — done
- Built (14a): chart registry entries volcano, heatmap, dendrogram (`packages/contracts/src/charts/`: encodings
  with accepted types, option schemas with ranges/defaults and `requires`/`conflict`/`range` rules, data rules)
  and `validateChartSpec` (field-level errors before any data is read). apps/compute `/stats/cluster` (SciPy
  linkage; R method/metric names; optimal leaf ordering; seeded bootstrap support per clade with the number of
  valid resamples), `/stats/kde`, `/stats/pvalues` (BH/BY, nulls kept), `/stats/zscore`, `/stats/pca` (SVD, sign
  fixed), `/stats/fit-4pl` (top ≥ bottom, EC50-in-range flag), all with structured 422 guards; compute request/
  response schemas live in contracts and are generated as pydantic models. `POST /v1/charts/render`: QuerySpec (or
  saved view) → program scoping → validation → encoded columns only (point cap) → shaping (volcano in TS;
  heatmap/dendrogram matrix in TS with clustering in compute) → Plotly figure JSON + provenance (release ids,
  sqlHash, spec with defaults, rows/dropped rows, transformations, compute versions and seed).
- Built (14b): chart panel under the Data Explorer results: form generated from the registry (type-aware
  column pickers, option controls from the zod schemas, errors next to each control, Apply disabled until valid,
  server data errors mapped back to their control), axis titles, Plotly partial bundle loaded lazily (core +
  scatter, scattergl, heatmap) with a ~60-line `Plotly.react` wrapper, lasso/box selection → "Selected points"
  table, provenance dialog, PNG/SVG download, "Data table" alternative for every chart.
- Decisions (and why):
  - Shaping/figures built server-side (SPEC §8 "ChartSpec → Plotly figure JSON"); the browser only renders.
  - Statistics only in apps/compute; TypeScript does pseudolog and z-scores (science rules). scipy 1.18.0 only:
    PCA by SVD in numpy and BH/BY via scipy, so scikit-learn and statsmodels are not needed yet.
  - SciPy ships incomplete types: one adapter module (`stats/scipy_api.py`) and the SciPy-reference test run in
    pyright basic mode; everything else stays strict.
  - Heatmap dendrograms on their own numeric axes aligned to the heatmap's categories.
  - Volcano panels (facets) not offered yet (removed from its encodings rather than shipped dead); MA, PCA,
    dose-response charts arrive in Phase 15 on the same endpoints.
- Dependencies added: scipy 1.18.0 (BSD-3; ≥ 90 days). plotly.js 4.1.2 (MIT; pinned in ARCHITECTURE) — note:
  every Plotly 4.x release is < 90 days old (4.1.2: 2026-10-05); CLAUDE.md requires 4.x, so taken with this flag;
  please confirm. `es5-ext` install script denied in pnpm-workspace.yaml (message only). Vite `define global`.
- Evidence: `pnpm check` ✓ · `pnpm run test:compute` ✓ (64) · `pnpm run test:contracts VIZ` ✓ ·
  `pnpm run test:api VIZ` ✓ (11, incl. every option changes the output) · `pnpm e2e` ✓ (25) · dendrogram with
  bootstrap N=100 on 200×20 (optimal leaf ordering, correlation): 0.19 s locally (SPEC target < 10 s) · bundle
  sizes in ARCHITECTURE §3 · screenshots in `artifacts/phase-14/`.
- Review: omics-reviewer — fixed: canberra now R's |x−y|/|x+y| (SciPy's differs for opposite signs; P0),
  volcano threshold lines in plotted space (−log10 and pseudolog), labels ranked by significance when y is
  already −log10 p, constant x no longer silently zeroed, bootstrap support reports valid resamples, 4PL reported
  with top ≥ bottom and an extrapolation flag, constant z-scored columns named; documented `weighted` = R
  `mcquitty`; SciPy's Silverman bandwidth differs from R's bw.nrd0 (noted, not changed).
- Test amendments: CON-03 "registry starts empty" now expects the Phase 14 entries (it documented the
  phase-by-phase fill); the compute SciPy-reference test now uses R's canberra as the reference (it asserted
  SciPy's formula, i.e. wrong v1 semantics); compute test stubs in API tests gained `bootstrap_valid` (contract
  change); a NaN p-value case was replaced by −0.01 (NaN cannot be sent as JSON); test typing fixes. Shaping
  option tests were written after the code.
- Gaps: volcano facets (panel encoding); 200k-point WebGL pan smoothness not measured in e2e (scattergl is used);
  long-format heatmaps pivot in TS (fine to ~200k cells, the point cap).
- Commit: 6197c84, b304508

## 2026-10-31 — Phase 15: Remaining charts and omics presets — done
- Built: registry entries for line, bar, scatter 2D, scatter 3D, box/violin, histogram/KDE, lollipop, bubble,
  pie/donut (all v1 options; `packages/contracts/src/charts/{xy,distribution}.ts`) and the omics presets MA plot,
  PCA (scores + variance explained, observations × complete features, long or wide data) and QC panel (IDs per
  run, missing values per run, CVs per feature, intensity distributions) (`charts/omics.ts`). Shared encodings,
  pseudolog (base 2–10) and `requires`/`conflict` rules; facets capped at 24 with the count in the error. apps/api
  shaping per family (`charts/{xy,dist,omics}-shapes.ts`, `dispatch.ts`, shared `common.ts`: groups, facets,
  palettes, layout options — grid lines, shared axes, shared legend). apps/compute `/stats/group-test` (Welch t,
  Mann–Whitney, KS pairwise vs the first group with BH; ANOVA, Kruskal–Wallis overall) and `/stats/group-summary`
  (n, mean, SD, SEM, CI95 by t, median, CV). Web: palette and layout options, Plotly bundle extended (bar, box,
  violin, histogram, pie, scatter3d), labels per chart.
- Every REFERENCE_V1 §8 row has a named VIZ-06 test (contracts: p-values without a group column, required x/y,
  lollipop size type, pseudolog base typed 2–10, no dead "query" option, facet cap declared; API shaping: KDE after
  filtering, > 24 panels, lollipop nulls dropped and counted, bubble pseudolog, heatmap+dendrogram for rows/
  columns/both, negative pie values; e2e: required y and p-values messages with Apply disabled).
- Decisions (and why):
  - Aggregates (mean/median/sum/count) and SD/SEM in TypeScript (science rules allow error bars); CI95 (t quantile),
    group tests and CVs in apps/compute.
  - p-values are refused when the chart splits groups the test would pool (colour/panel) — omics review.
  - QC: missing or ≤ 0 values count as "not quantified" in every panel (tools write 0 for not quantified).
  - Vite pre-bundles the Plotly modules (`optimizeDeps.include`): discovering them on first chart reloaded the page.
- Dependencies: none new.
- Evidence: `pnpm check` ✓ · `pnpm run test:contracts` ✓ (81) · `pnpm run test:api VIZ` ✓ (28) ·
  `pnpm run test:compute` ✓ (73) · `pnpm e2e` ✓ (29) · bundle size in ARCHITECTURE §3 (709 kB gzip, lazy) ·
  screenshots in `artifacts/phase-15/`.
- Review: omics-reviewer — fixed: pseudolog Y with error bars (P0: linear lengths on a log axis) now a conflict;
  n < 2 groups have no error bar (not zero); pooled p-values refused; line z-scores labelled per series; QC zeros
  and placement consistent; pie percentages of pseudolog values refused; moving-average window odd with edge note;
  histogram mean/median labelled when pseudologged; MA hit rule recorded; constant groups give a structured error.
  Open: the reference group for pairwise tests is the first group in data order (no picker yet).
- Test amendments: CON-03 registry contents (Phase 15 set); e2e helper `chartOnPq` gained `signedIn` (the test
  signed in twice on one page); three shaping expectations I had computed wrongly were corrected before the first
  green run (MA hits without p, pie sum, PCA long data).
- Gaps: no picker for the pairwise reference group; scatter 3D has no panels; MA/volcano label collision handling.
- Commit: 2e4b791

## 2026-10-31 — Phase 16: Results pages and cross-experiment views — done
- Built: experiment results page (`/experiments/:id/results`, "Results" on the experiment page): methods
  paragraph (deterministic, from run and release provenance; copy button), QC panel, one volcano per contrast,
  top-hits table (links to protein pages), dose-response viewer, files. Dose-response viewer (registry chart
  `dose_response`: measured responses and the fitted CurveCurator curve per feature as small multiples; regulation,
  FDR, count, sort, fit and log-dose options; explains an empty selection). Protein page (`/proteins/:acc`):
  reference annotations, every experiment and contrast it was measured in, its dose-response curves. Compound page
  (`/compounds/:id`): properties/ADME, targets (compound→target reference release), contrasts it was the treatment
  in, and volcanoes (six most recent) with a known-target overlay (new volcano `highlight` option, matched on any
  accession of a protein group, isoforms → canonical). Comparison view (`/compare`, nav "Compare"): 2–6 contrasts →
  log2 FC scatter, overlap table and UpSet-style intersection bars in Plotly (no UpSet.js — AGPL). APIs:
  `GET /v1/versions/:id/results`, `GET /v1/compounds/:id`, `GET /v1/proteins/:id`, `GET /v1/compare/options`,
  `POST /v1/compare`. Synthetic `fixtures/reference/compound_targets.tsv` (one primary and one off-target per
  compound).
- Decisions (and why):
  - Compound/property/target-annotation pages read the seeded reference tables; compound→target links are a
    reference release (target_annotation kind), so the seed and its counts are unchanged.
  - Compound → contrasts: samples whose factors have that compound_id and whose condition is the contrast's
    numerator.
  - Comparison matches protein groups on accessions; only accessions measured in every contrast are compared
    (missing and ambiguous ones are counted and shown); exclusive intersections.
  - The fitted curve is evaluated from stored parameters in TypeScript (display of a fitted model, no fitting);
    formula from the importer's SOURCE.md.
- Dependencies: none new.
- Evidence: `pnpm check` ✓ · `pnpm run test:api RES` ✓ (methods 3, API 4, shaping 4) · `pnpm e2e` ✓ (34, incl. RES-01…05
  with the demo run) · screenshots in `artifacts/phase-16/`.
- Review: omics-reviewer — fixed: compare requires the contrast (P0: several contrasts of one release would merge),
  truncated reads refused, overlap sorted by significance with totals, only accessions measured everywhere compared,
  accession-level matching with ambiguity counts, methods paragraph calls the thresholds display thresholds, names
  genes for RNA-seq/CRISPR, writes "p" when unadjusted and the contrast from its stored sides, curves without FDR
  counted and named, hidden dose-0 points reported, isoforms match their canonical accession. Open: the compound
  page uses the version's newest DA release, which may not contain every contrast (shown empty then).
- Test amendments: CON-03 and the Phase 15 VIZ-05 registry assertions now expect `dose_response` (phase-by-phase
  fill); e2e release helper generalised (no assertion changes); RES-02 test raises the curve cap before checking
  filters (the default cap hid their effect) and uses an exact "Curves" locator; one shaping expectation corrected
  before the first green run.
- Gaps: dose-response "relevance score" not yet a filter; no PDF/print layout for the results page.
- Commit: fb2ddc1

## 2026-11-01 — CI fix: PIPE-06 sign-in timeout (second occurrence)
- Symptom: on CI the admin's user button did not appear within 5 s of signing in to `/admin/pipelines` (passes
  locally, 34/34). CI artifacts were not reachable from the build container, so the exact cause on the runner is
  not proven. **Update (Phase 18):** the real cause was a sign-in race. Simultaneous OIDC callbacks for the same
  user collided on unique keys and the callback answered 409. Fixed in 22a70b1. The retry below is still
  useful, but it was not the cause.
- Fixed the product weakness that matches it: `useMe` had `retry: false`, so one slow or failed `/auth/me` right
  after login left a signed-in user shown as signed out. A 401 is still final (signed out); network errors and 5xx
  are retried 3 times with backoff. The header and `RequireAuth` show "Could not load your account" with a retry
  button instead of "Sign in".
- Test changes: new AUTH-01 unit test (retry policy). The e2e `signIn` helper waits up to 15 s (it was 5 s) for
  the user button. Same assertion; more time for the first page under CI load.
- Evidence: `pnpm check` ✓ · `pnpm e2e "AUTH|PIPE"` ✓ (5) · full `pnpm e2e` ✓ (34) before the change.

## 2026-11-01 — Phase 17: Search — done
- Built:
  - Hybrid search over experiments and samples (SPEC M9), plus ADR 0020.
  - Migration 0015 adds `search_document`: one per experiment (its latest published or archived version) and
    per sample. Fields are weighted: title A, subtitle and body B, ontology synonyms and de-hyphenated forms C.
    Facet columns, GIN index, soft-deleted when stale.
  - Migration 0015 also adds `search_embedding`: per document, provider and model; `vector(1024)`, smaller
    models zero-padded; HNSW cosine index with iterative scans.
  - Shared indexer (`packages/db/src/search-index.ts`) indexes only fields flagged searchable, plus name,
    description, program, assay, species, spectral library, time points and compound names (own program only).
  - Reindex runs inside the transaction of version publish and archive, and of experiment
    update, archive and unarchive. `pnpm db:seed` reindexes on every run, so older databases get indexed.
  - `GET /v1/search`: OR-ranked full-text (each word a bound `plainto_tsquery`, ranked by words matched then
    `ts_rank_cd`, the last word also as a prefix). Query expansion from seed-term synonyms and the OLS4 cache,
    returned as `expansions`.
  - Optional vector sub-query fused by RRF (k = 60). Both sub-queries are program-scoped in SQL. Facets
    (assay type, program, species, compound, status) cover the scoped matching set before filters. Cursor
    pagination, `ts_headline` snippets with control-character markers (never HTML).
  - `POST /v1/admin/search/reindex` (system admin, audited).
  - Embedding providers: `none` (default), `voyage_4`, `bedrock_titan_v2`, and `local` (apps/compute `/embed`,
    a deterministic hashing embedder).
  - Web: ⌘K / Ctrl+K palette (combobox and listbox; arrows, Enter, Esc; experiments first, then up to 3
    samples, each named by its key) and a header button. `/search` page: query, type, facet checkboxes in the
    URL, hits grouped by experiment (one link each, matching samples listed under it), highlighted snippets,
    "Load more", "500+" when capped, and the "Also searched" expansions.
  - If the embedding call fails, the search answers with full-text only (`mode: fulltext`) instead of failing.
    `capped` marks totals and facet counts as lower bounds when the 500-candidate cap is reached. Embedding
    sizes are checked per provider (Titan and Voyage: 256, 512 or 1024) and at storage or query time.
  - Seed terms gained a small synonym subset (e.g. K562, A549, MCF7, HEK-293, "Human Embryonic Kidney 293").
- Decisions (and why):
  - OR semantics, so a word with no match ("inhibitor") cannot empty the result.
  - Only the latest published version is searchable; drafts are work in progress.
  - Documents are derived and rebuildable; upsert plus soft delete because the app role never deletes.
  - Proposed default provider when AI is enabled: `bedrock_titan_v2` (stays in the customer's AWS account);
    Voyage is opt-in. This answers SPEC §12 Q4 — owner to confirm.
- Dependencies: none new. `@aws-sdk/client-bedrock-runtime` is not on the ARCHITECTURE list of approved AWS
  clients, so it was left out. `bedrock_titan_v2` takes an injected invoker until the owner approves it;
  without one, search falls back to full-text.
- Evidence: `pnpm check` ✓ (api 138, web 30, db 16, contracts 83, query 18, importers 49, compute + ruff +
  pyright) · `pnpm run test:api SRCH` ✓ (16, golden queries 12/12 top-3) · `pnpm run test:compute -k SRCH` ✓
  (3) · `pnpm e2e "SRCH|AUTH|PIPE-06"` ✓ (5) · full `pnpm e2e` 35/36 locally. RES-01 got an HTTP 500 from the
  query service for its volcano while `pnpm check` and a reviewer ran in parallel; the RES specs rerun alone
  passed 9/9 with the query server logged. Screenshots are in `artifacts/phase-17/`.
- Test amendments:
  - DB-01 table list gained the two search tables (own commit, as in Phases 7, 8 and 10).
  - The SRCH-02 embedder test's docstring was rewrapped to the ruff line limit (own commit; no assertion
    change).
  - The SRCH e2e specs are exactly as committed. A first attempt edited their locators to fit the UI; the
    plan-reviewer caught it, the specs were restored, and the UI was changed instead (sample options and links
    are named by their sample key).
- Review: plan-reviewer.
  - Fixed: the test edits above, the full-text fallback when embeddings fail, the capped flag, the
    per-provider dimension checks, the unapproved dependency (removed), and seed/index.ts back under 400
    lines (counts moved to seed/counts.ts).
  - Kept: the reindex audit row is written after the rebuild, which spans many transactions.
- Gaps:
  - Titan v2 needs the Bedrock SDK approved. Its request and response fields could not be checked against
    the AWS docs (host unreachable); verify before enabling.
  - A pre-existing intermittent db-test teardown error (pg 57P01 on an idle pool client when a test container
    stops) appeared once in `pnpm check`; two reruns were clean.
  - `local` is lexical, not semantic.
  - Sample documents of superseded versions stay as soft-deleted rows.
  - No per-facet "exclude own filter" counts.
- CI: added a failure-only step that prints Playwright `error-context.md` files into the job log (artifact
  downloads are blocked from the build container), to diagnose the PIPE-06 sign-in failure that repeats on
  CI but not locally.
- Commit: 57dd9fc

## 2026-11-01 — Phase 18a: Lineage graph, audit viewer and per-entity history — partial (18b pending)
- Built:
  - Lineage (ADR 0021): view `lineage.link` (migration 0016) combines recorded edges with foreign-key relations
    (file→release, version→release, version→run, run→file, release→saved chart). Run launch records its inputs
    (the version, and raw files that passed QC or were overridden). `GET /v1/lineage` takes kind, id, depth 1–6
    and direction; it walks the view with recursive CTEs, caps nodes at 200, and filters by permission (an
    unreadable root is 404; others' private charts are hidden).
  - Lineage page `/lineage/:kind/:id`: layered SVG (upstream left, downstream right; click to centre), depth
    and direction in the URL, and a table alternative. "Lineage" links on the release and run pages.
  - Audit: `GET /v1/audit` (system admin; action, entity, actor and date filters; cursor paging) and
    `GET /v1/audit/export`. The export is RFC 4180 CSV, neutralises formulas, and is itself audited. Admin page
    `/admin/audit` (nav "Audit"): filters, table, "Load more", "Export CSV".
  - Per-entity history: `GET /v1/history/{experiment|experiment_version|dataset_release|file|pipeline_run}/:id`
    for readers of the program. History table on release and run pages, and a History tab on the experiment
    page.
- Fixed on the way (own commit 22a70b1): the OIDC callback race behind the CI PIPE-06 failures (see the CI-fix
  entry above). The user, group and membership writes are now upserts, with a barrier-based regression test.
- Decisions: see ADR 0021. Lineage view instead of a backfill; no graph library; system-admin audit viewer plus
  history tabs for program readers.
- Dependencies: none new.
- Evidence: `pnpm check` ✓ · `pnpm run test:api "LIN|AUD-02"` ✓ (8) ·
  `pnpm e2e "LIN-01|AUD-02|PIPE|AUTH"` ✓ (7) · screenshots in `artifacts/phase-18/` (lineage, release history,
  audit log).
- Test amendments: the e2e data helper can upload a raw file from a buffer and leave a release staged; it now
  passes the buffer as a `Uint8Array` so the e2e typecheck accepts it. No assertion changes.
- Gaps (18b): re-authentication on publish/approve, the admin screens (templates v1.1, picklists, ontology
  sources, roles and group mapping, runner configuration, lifecycle, AI placeholder, health). AUD-02 stays
  open until re-auth is done.
- Commit: 4f3e8da

## 2026-11-01 — README and Celeste design alignment (owner request, between Phases 18a and 18b)
- README: a product README for GitHub (what it does, architecture, prerequisites, install, run, test,
  configuration, layout, common tasks, deployment, security, troubleshooting). The build-kit README moved to
  `docs/BUILD_KIT.md`.
- UI (ADR 0014): the web app adopts the Celeste design system from the owner's MFGAIStudio repository.
  - Tokens with light and dark themes, a dark grouped sidebar (collapsible, drawer on mobile, ⌘K trigger, user
    card), a top bar (page title, theme toggle, runs, account), cards, tables, tabs, pill badges, dialogs and a
    line-icon set.
  - The home page is now a dashboard: welcome, health, area cards and your recent runs.
  - Hard-coded colours were swept to tokens.
- Accessibility and speed fixes found while checking:
  - REG-07 (axe) failed on colour contrast with Celeste's exact muted and badge colours, so they were darkened
    to pass WCAG AA.
  - A dialog backdrop blur slowed the e2e suite from 4.4 to 6.1 min and made MAN-03 time out; it was removed.
    Base and final runs were compared.
- Evidence: `pnpm check` ✓ · full `pnpm e2e` ✓ (38 passed, 4.2 min) · screenshots in `artifacts/ui-refresh/`
  (home, experiments, experiment, datasets, explore, search, dark, mobile, drawer).
- Test changes: none.
- Gaps:
  - Plotly charts and AG Grid stay light in dark mode.
  - Earlier phases' screenshots show the old look; they are kept as phase records.

## 2026-11-01 — Phase 18b-1: Re-authentication on publish/approve and template versioning — partial (18b-2 pending)
- Built:
  - Re-authentication (SPEC M10, §10): publishing a version, approving or rejecting a release, and overriding
    QC (plus publishing a template) need a sign-in within `REAUTH_MAX_AGE_SECONDS` (default 900). Otherwise
    the API answers 401 `reauth_required`, checked before anything is loaded or written.
  - API tokens are exempt: not interactive; their scopes still apply.
  - `/v1/auth/me` reports `auth_time` and `reauth_max_age_seconds`.
  - The web shows "Confirm it’s you" on `reauth_required`. "Sign in again" goes through the IdP with
    `prompt=login` and `max_age=0` (Keycloak asks for the password again), back to the same page, and the user
    repeats the action.
  - Template versioning (SPEC M11, ADM-01):
    - `GET /v1/admin/templates` lists versions with how many experiment versions pin each.
    - `POST /v1/admin/templates` creates the next major/minor/patch version as a draft, with key-field and
      duplicate checks.
    - `GET …/preview` is the migration preview: added, removed, changed and newly required fields, and pinned
      counts.
    - `POST …/publish` (with reason; audited; the previous version is retired).
    - New experiments and new versions (clone) pin the current published template, never a draft. Published
      versions keep theirs.
  - Admin page `/admin/templates` (sidebar "Templates"): versions table, field editor (contract-validated),
    migration preview, publish with reason.
- Fixes found on the way:
  - `currentTemplate` could hand a draft template to new experiments.
  - The manifest grid now always shows required template fields, so a newly required field can be filled.
  - The Paste TSV dialog closes once rows are applied; the mapping preset is saved in the background, and a
    failure shows in the editor message. Before, the dialog waited on the save and timed out under load.
- Decisions: a template version is immutable once published (409). The built-in template stays listed until a
  stored version replaces it.
- Dependencies: none new.
- Evidence: `pnpm check` ✓ · `pnpm run test:api "ADM-01|AUD-02"` ✓ · full `pnpm e2e` ✓ (40 passed, 4.5 min) ·
  screenshots `artifacts/phase-18/template-preview.png`, `template-published.png`, `reauth-dialog.png`.
- Test amendments (own commits; these new tests had not passed before):
  - AUD-02 re-auth e2e asserts Keycloak's "Please re-authenticate to continue" page (the username is kept)
    instead of filling a username.
  - ADM-01 e2e looks for the new column by its key (grid headers are keys).
  - ADM-01 e2e fills required DDA fields left by earlier runs for the "before" experiment only; a setup
    expression was fixed.
- Commit: 5c20885

## 2026-11-01 — Phase 18b-2: Admin settings — Phase 18 done
- Built (SPEC M11):
  - **Programs** (`/admin/programs`): create and edit, with unique upper-case codes and an "approval required
    to publish" flag. Audited.
  - **Picklists** (`/admin/lists`):
    - Species (NCBI Taxonomy ids), spectral libraries and time points (must parse as times).
    - Built-in defaults until saved; replacing a list soft-deletes old values. Audited.
    - The new-experiment form offers them: a species select, and suggestion lists for libraries and time
      points.
  - **Ontology sources:** admins switch known OLS4 sources off. The manifest editor's lookups for a disabled
    source answer 422 `ontology_disabled`; other prefixes and stored terms are unaffected.
  - **Access** (`/admin/access`): IdP group → role mappings stored by admins (migration 0017,
    `group_role_mapping`). They are merged with `AUTH_GROUP_ROLE_MAP` when roles are loaded, which happens on
    every request, so removals apply immediately. Environment mappings are shown read-only.
  - **Lifecycle** (`/admin/lifecycle`): editor for the existing per-role storage policies, with the generated
    S3 rules.
  - **Health** (`/admin/health`):
    - Checks: database, object storage, query service, compute service, identity provider, job queue,
      search index (3 s timeout each; one being down degrades the report, never fails it).
    - Pipeline runners (configured or not) and the AI assistant placeholder (off).
- Fixes from the plan-reviewer:
  - The new-experiment form could submit no species when an admin's list lacked the default; the shown choice
    is now the saved one.
  - Ontology prefixes outside the known list stay enabled; only explicitly disabled sources are blocked.
  - A missing `auth_time` in the ID token now counts as long ago, so a silent IdP sign-in cannot pass
    re-authentication (`authTimeFrom`, unit-tested).
  - An empty program edit is a 400, not a 500.
  - The Access page copy says changes apply on the next request.
  - Earlier phases' screenshots that e2e runs rewrote were restored.
- Also fixed:
  - Postgres pools and clients now have error listeners. A connection the server closes (restart, shutdown)
    was an unhandled error: the intermittent 57P01 in test teardown, and a crash risk in production.
  - The sidebar sits in a full-height rail, so long pages no longer show a gap under it.
- Dependencies: none new.
- Evidence: `pnpm check` ✓ · `pnpm run test:api "ADM|AUD-02"` ✓ (20) · full `pnpm e2e` ✓ (43 passed, 4.6 min) ·
  screenshots `artifacts/phase-18/admin-lists.png`, `admin-health.png`.
- Test amendments (own commits):
  - DB-01 lists the three new tables, and the order was corrected (`app_session` before `app_setting`).
  - One non-null assertion was added in the ADM-02 test for the typecheck; no behaviour change.
  - A unit test for `authTimeFrom` was added.
- Gaps:
  - Direct user or group role bindings have no admin UI (roles come from IdP group mappings).
  - Runner configuration is read-only status; runners are configured in the deployment.
  - AI settings are a placeholder until Phase 19.
- Commit: 990e4b6

## 2026-11-01 — Phase 19a: AI assistant — providers, tools as the user, panel, golden eval
- Built (SPEC M12, §11; ADR 0022):
  - **Providers:** `none` (the default: no assistant), `stub`, `anthropic` and `bedrock`, set by `AI_PROVIDER`
    (`AI_MODEL` defaults to `claude-opus-5-5`; `AI_MONTHLY_TOKEN_BUDGET` defaults to 5,000,000).
    - The Messages API adapter (`anthropicProvider`) uses adaptive thinking and automatic tool choice, replays
      the model's own blocks in the tool loop, and handles `refusal` before reading content.
    - Its SDK client is injected. `anthropic` and `bedrock` stop at startup with a message until the SDK
      dependency is approved (below).
  - **Tools** (zod input, risk class), run in-process through the API with the caller's credentials:
    - `search_experiments`, `get_experiment`, `list_datasets`, `describe_release`
    - `build_query` (validated QuerySpec + Explorer link), `run_query` (first 25 rows)
    - `get_results_summary`, `get_lineage`, `suggest_chart`, `render_chart`
    - A 404, or a 403 on a read, reads as "not found" to the model.
  - **API:**
    - `GET /v1/ai/settings`
    - `PUT /v1/admin/ai-settings` (system admin, audited)
    - `POST /v1/ai/conversations` (409 `ai_disabled` when off)
    - `GET /v1/ai/conversations/{id}` (owner only)
    - `POST …/messages` (429 `ai_budget_exhausted` at the monthly budget)
  - **Storage:** migration 0018 (`ai_conversation`, `ai_message`) with tool calls, provenance, refusal and token
    counts.
  - **Audit:** every tool call writes `ai.tool_call` as `ai_assistant_on_behalf_of`, recording the input, status
    and error, never rows.
  - **Provenance:** provider, model, prompt version, tools, QuerySpecs, release ids and tokens.
  - **Web:**
    - An "Assistant" top-bar button, shown only when the assistant is on, opens the side panel.
    - The panel shows a card per tool call: the QuerySpec, row counts and "Open in Explorer".
    - System health has an AI settings card: on/off, write tools, budget, usage and tools.
  - **Golden eval:** `pnpm eval:ai` asks 30 search questions as two users (`apps/api/src/ai/eval/golden.json`).
    It scores by result equivalence: the experiments returned must be exactly the expected ones. Empty
    expectations must be answered "no experiments".
- Evidence:
  - `pnpm check` ✓
  - `pnpm run test:api AI-` ✓ (9, including AI-05: stub eval 30/30)
  - `pnpm e2e "AI-03|ADM-0"` ✓ (5)
  - Screenshots: `artifacts/phase-19/assistant-search.png`, `assistant-query.png`.
- Test amendments (own commit):
  - DB-01 lists the new tables.
  - The ADM-03 e2e now expects the stub provider on the health page, since the e2e stack runs it.
  - AI-03 now creates a published release (the seed has none) and checks that the rows equal the hand-run
    query's rows.
- Not run: the real-provider eval. It needs the SDK approved and a key or Bedrock access; it is recorded here
  when run.
- Waiting on you: approve the model SDKs:
  - `@anthropic-ai/sdk` 0.115.0: Apache-2.0, publisher Anthropic, created 2023-01-31, this version 2026-07-24,
    https://www.npmjs.com/package/@anthropic-ai/sdk
  - `@anthropic-ai/bedrock-sdk` 0.32.0: Apache-2.0, Anthropic, created 2023-10-12, this version 2026-06-30.
  - The newer 1.x releases are under 90 days old.
- Gaps (19b): write tools with approval, the curation assistant in the manifest editor, streaming, and
  `run_analysis`.
- Commit: 244bc8c

## 2026-11-01 — Phase 19b: writes with approval, curation, refusals — Phase 19 done
- Built (SPEC M12, §11.4–7; ADR 0022 updated):
  - **Write tools** (offered only when an admin allows them): `create_saved_view` and
    `apply_metadata_suggestions`.
    - A proposal is stored as `pending_approval` and nothing runs.
    - `POST /v1/ai/conversations/{id}/tool-calls/{callId}/decision` (owner only) claims the proposal and commits,
      runs the write through the API as the user, then records the outcome.
    - The write's audit reason says the assistant proposed it; `ai.approve`/`ai.reject` are audited too.
    - A second decision gets 409 `already_decided`. Approving while write tools are off gets 409
      `ai_writes_disabled`; rejecting still works.
  - **Curation** (SPEC §11.5):
    - `POST /v1/ai/curation/suggest` and the `suggest_ontology_terms` tool return terms only from the ontology
      lookup run as the user.
    - A value matches only when a returned label or synonym equals it; otherwise "no match", with the lookup's
      results as candidates.
    - `apply_metadata_suggestions` re-checks every term at approval and refuses any the lookup did not return.
  - **Manifest editor:** "Suggest ontology terms" lists the invalid values of each ontology column with their
    suggestions. Only ticked rows are applied to the grid, which is then saved as usual.
  - **Refusals:** explained to the user ("declined … your own experiments and datasets"), stored with their
    category, and their tokens count against the budget.
  - **Assistant panel:** proposals show "Waiting for your approval" with the proposed change and Approve/Reject
    buttons. An approved view has an "Open view" link.
  - **Saved views page** (`/views`, "Saved views" in the sidebar): lists your views and your programs' views and
    opens them in the Explorer.
  - **Fix:** the built-in ontology fallback (used when OLS4 is unreachable) now matches and returns the seed terms'
    synonyms (A549 → A-549).
- Reviewer findings (plan-reviewer), all fixed:
  - **Old conversations:** tool calls stored without an id are given one on read.
  - **Approvals after switch-off:** approvals re-check the settings.
  - **Double run:** the approval claim is committed before the write runs.
  - **Budget:** it is re-checked between model calls.
  - **Provenance:** it includes join releases.
  - **Audit:** tool input in the audit log is redacted to ids and term ids.
  - **Scope:** streaming and `run_analysis` are deferred, and the deferral is recorded in PLAN.
- Evidence:
  - `pnpm check` ✓ (api 177 tests before the review fixes)
  - `pnpm run test:api AI-` ✓ (17)
  - `pnpm e2e "AI-0|REG-07"` ✓ (5)
  - Screenshots: `artifacts/phase-19/assistant-approval.png`, `curation-suggestions.png`.
- Full `pnpm e2e`: 45 passed, 1 failed.
  - The failure was RES-01: the volcano got "The query service answered HTTP 500".
  - RES-01 passes alone (26.9 s). Playwright does not capture the servers' output, so the cause is not known yet.
  - This phase does not change the chart or query path. Open: capture web-server logs in e2e and find the cause
    (Phase 22 hardening at the latest).
- Tests added after the tests-first commit:
  - AI-04: a pending proposal cannot be approved after write tools are switched off.
  - AI-02: audit redaction unit test.
- Test infrastructure: `startTestApi` takes an `aiProvider` (a scripted model, used for the refusal test).
- Still waiting on you: approval of the model SDKs (see 19a). The real-provider eval is not run until then.
- Commit: f76df73

## 2026-11-01 — CI e2e: serve the production build; picklist editor guards
- CI's e2e job failed intermittently at sign-in in PIPE-06 (runs 24, 25, 28, 29, 32, 33). The user button did not
  appear within 15 s, and it passed on other pushes.
  - CI ran the e2e suite against the Vite dev server, which compiles each route on first visit. It also reloads
    every open page when it re-optimises dependencies (an earlier reload is noted in vite.config.ts).
  - On a busy runner with pipelines in parallel, the first page after sign-in could miss 15 s.
  - Fix: under CI, Playwright serves `vite build` + `vite preview` on port 5173; local runs keep the dev server.
  - Locally in CI mode, the full suite runs in 3.3 min instead of about 5.
- That run also found two problems in the picklist editor (ADM-02), now fixed:
  - Adding a value before the saved list had loaded would have saved only the new value; Add and Save now wait for
    the list.
  - Adding a value already in the list is blocked with a note, instead of a 422 on save.
- Test amendment (own commit): ADM-02's random time point (2–91 h) could equal a default (6, 24, 48, 72 h) or an
  earlier run's value. It is now unique per run (`<n> min`).
- Evidence: `CI=1 pnpm e2e` 45 passed and 1 failed (ADM-02, the collision above); after the fix,
  `CI=1 pnpm e2e ADM-0` ✓ (4); web unit tests ✓ (30).
- Follow-up: RES-01 then failed in CI with "The query service answered HTTP 500" on the volcano chart (also seen
  once locally in Phase 19).
  - With the query service's log captured, the cause was a race in its release cache: two charts on one page
    downloaded the same release at once into the same `<sha>.parquet.partial`, and the second rename failed
    (ENOENT).
  - Fix (`apps/query/src/objects.ts`): concurrent readers share one in-flight download, and each download writes
    a uniquely named temp file. New test `QRY-05: concurrent reads of one release share a single download`.
    It failed with the CI error before the fix and passes after.
  - Full local `pnpm e2e` after the fix: 45 passed, and the query service logged no errors. RES-03 failed only on
    this machine: the protein page's "Measured in" table is capped, and hundreds of earlier local runs push the
    new experiment past the cap. CI starts from an empty database.

## 2026-11-01 — Phase 20: MCP server, Python SDK and webhooks
- **Dependencies**, approved by the owner on 2026-11-01 ("whatever you suggest"):
  - `@anthropic-ai/sdk` 0.115.0 (MIT; earlier entries said Apache-2.0, which was wrong)
  - `@anthropic-ai/bedrock-sdk` 0.32.0 (MIT)
  - `@modelcontextprotocol/sdk` 1.30.0 (MIT)
  - All are exact-pinned and over 90 days old. `pnpm run licence:scan` passes (196 dependencies).
- Built (SPEC M12/M13; ADR 0023):
  - **MCP server** at `POST /mcp` (Streamable HTTP, stateless, JSON responses):
    - Exposes the assistant's tool registry. Read tools are `readOnlyHint`. Write tools carry
      `tributary/requiresUserInteraction` and need a write scope and admin permission.
    - Tool errors come back as MCP tool errors. Results are cut at 90k characters. Every call is audited as
      `mcp.tool_call` (`ai_assistant_on_behalf_of`).
  - **OAuth 2.1:**
    - RFC 9728 metadata at `/.well-known/oauth-protected-resource[/mcp]`; a 401 carries
      `WWW-Authenticate … resource_metadata`.
    - IdP access tokens are introspected (RFC 7662) and must name `MCP_RESOURCE` in `aud` (no passthrough).
    - PATs of any scope work as a fallback.
    - Tools reach the API in-process through a 2-minute HMAC-signed assertion, so permissions, validation and audit
      stay the API's own.
  - **Read-scoped tokens** may now call the three POST endpoints that only read: `/v1/query`, `/v1/charts/render`
    and `/v1/ai/curation/suggest`.
  - **Agent Skill:** `integrations/claude-skill/SKILL.md` covers connecting, ground rules (QuerySpecs only, cite
    releases, statistics as stored, writes need the user), and workflows (explore an experiment, pull rows,
    compare compounds, charts, failures).
  - **Python SDK** (`packages/sdk-python`, standard library only):
    - `list_experiments` (cursor), `get_experiment`, `list_datasets`, `search`, `run_query`, `iter_rows` and
      `verify_webhook`.
    - Notebook and webhook-receiver examples.
    - `pnpm dev:token` prints a local PAT for it.
  - **Webhooks** (migration 0019):
    - Admin endpoints: create (the `whsec_` secret is shown once), list, delete, ping, deliveries.
    - https only (http to localhost outside production).
    - Signed as `X-Tributary-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`, with a 5-minute replay tolerance.
    - 3 attempts with backoff, no redirects, every attempt recorded.
    - Run status changes from events or polls notify subscribers without blocking them.
  - **Assistant providers:** `AI_PROVIDER=anthropic` uses the Claude API (`ANTHROPIC_API_KEY`).
    `AI_PROVIDER=bedrock` uses Amazon Bedrock (task role; `AI_MODEL` must be set to the account's Bedrock model id).
  - README: AI and MCP settings, an Integrations section and new tasks.
- Evidence:
  - `pnpm check` ✓ (api 188 tests, compute 78 passed and 1 skipped).
  - `pnpm run test:api "MCP-0|API-02"` ✓
  - Against the local stack: `TRIBUTARY_API_URL=http://127.0.0.1:3000 TRIBUTARY_TOKEN=$(pnpm -s dev:token)
    pnpm run test:compute -k API_0` → 4 passed.
  - `test -f integrations/claude-skill/SKILL.md` ✓
- Test amendments (own commit b8cafb9):
  - The AI-01 provider test now expects real providers to build (the SDKs are approved) and Bedrock to require
    `AI_MODEL`.
  - The API-01 fake API routed `/v1/experiments/{id}` to the list handler.
- Gaps:
  - The real-provider eval is still not run: it needs an `ANTHROPIC_API_KEY` or Bedrock access.
  - No wheel build script: install with `pip install ./packages/sdk-python`.
  - The SDK is hand-written, not generated (ADR 0023).
  - IdPs without token introspection need JWKS validation.
  - The live-stack SDK test is skipped in CI's `check` job, which has no stack.
- Security review (plan-reviewer), fixed:
  - **Assertions:** the in-process assertion is signed with a random key generated per process (not
    `COOKIE_SECRET`), lives 60 s, and is tested against forging, tampering, expiry and scope escalation.
  - **OAuth tokens:** introspected once (an IdP error is a 401) and must carry `tributary:read`.
  - **Webhook SSRF guard:** in production, hosts must resolve to public addresses, at creation and before each
    delivery. Raw network errors are no longer returned.
  - **MCP tool output:** search snippets no longer carry the UI's highlight control characters.
  - Recorded, not fixed: plaintext webhook secrets (KMS in Phase 22). The SDK is 1.x, not "v2" (ADR 0023).
- Commit: ece946d

## 2026-11-01 — Open source (Apache-2.0) and Render hosting for a public demo
- **Owner decisions:**
  - Licence: Apache-2.0.
  - Hosting: Render only (first proposed as a VPS; changed by the owner mid-way).
  - Purpose: a public demo.
- **Branch housekeeping:** PR #1 was merged before the Phase 20 commits were pushed, so Phase 20 was not in
  `main`. The branch was restored from the remote and `main` merged into it (no force-push). Phase 20 goes into
  `main` with this PR.
- Built (ADR 0024):
  - **Open-source files:** `LICENSE` (Apache-2.0, canonical text), `NOTICE`, `CONTRIBUTING.md`,
    `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates. README has the licence, a "Deploy to Render"
    button and the deployment options.
  - **Demo mode:** a public `GET /v1/instance` and a banner on every page with the demo logins.
    - Configured by `DEMO_MODE`, `DEMO_LOGINS` (an admin login is refused at startup), `INSTANCE_NAME` and
      `DEMO_NOTICE`.
  - **Render Blueprint** (`render.yaml`): seven services, one Dockerfile each, in `deploy/render/`.
    - Caddy for the web (SPA, `/api`, `/auth`), SeaweedFS S3 on a disk, the API with a pre-deploy step, query,
      compute, Keycloak with a setup script, and pgvector Postgres on a disk.
    - Generated secrets come from an environment group.
  - **Configuration for hosts that cannot compose values:**
    - the database URL in parts (URL-encoded)
    - `QUERY_HOSTPORT`, `COMPUTE_HOSTPORT` and `S3_HOSTPORT`
    - `BUNDLED_KEYCLOAK`, so the issuer follows `PUBLIC_URL`
    - plain-HTTP issuers in production only on `localhost`/`*.localhost`
  - **Local trial** (`deploy/local-trial/compose.yml`): the same Dockerfiles and variables, at
    `http://tributary.localhost:8080`.
  - **Guide:** `docs/DEPLOY_RENDER.md` covers deploy, checks, custom domain, configuration, updates, resetting the
    demo, backups, real use, the local trial and troubleshooting.
- Evidence:
  - All seven images build (`docker build` with each Dockerfile).
  - **Local trial:** the pre-deploy migrated, created the buckets and seeded the demo data. Keycloak setup printed
    `configured for http://tributary.localhost:8080`.
  - **Browser smoke test:**
    - the banner shows both demo logins
    - scientist and viewer sign in through Keycloak
    - the Experiments page lists the demo data, and the Explorer returns 25 rows
    - a browser upload to `s3.tributary.localhost:8333` through a presigned URL returned 200 with an ETag, and
      the upload completed
    - screenshots in `artifacts/deploy/`
  - `pnpm run test:api OSS-01` ✓ (7).
  - A first version targeting a single VPS (Caddy with automatic HTTPS) was also built and smoke-tested over
    HTTPS before the owner chose Render. It was removed to keep one deployment path.
- Not verified here: applying `render.yaml` on Render itself, which needs the owner's account. The first deploy
  is the check, and `docs/DEPLOY_RENDER.md` → "Checking it works" lists what to look at.
- For the owner to fill in: the code-of-conduct contact address (`CODE_OF_CONDUCT.md`,
  `conduct@REPLACE-WITH-YOUR-DOMAIN`). Enable GitHub private vulnerability reporting (Settings → Security) for
  `SECURITY.md`.
- Commit: 72bddce

## 2026-11-01 — Free public demo on Hugging Face Spaces
- **Why:** the owner asked for a free deployment, and Render's free tier cannot run the stack (0.1 CPU and 512 MB
  per free service, no disks, no private networking, a Postgres that is deleted after 30 days). The owner chose a
  Hugging Face Docker Space (ADR 0025).
- Built:
  - `deploy/huggingface/Dockerfile`: one image with every service.
    - Postgres 17 + pgvector, SeaweedFS, Keycloak (with its own Java 21), compute on Python 3.12, query, API and
      Caddy.
    - It builds from the public GitHub repository, or from a local checkout with
      `--build-context source=.`.
  - `start.sh` starts the services in order, generates secrets per start, and exits if any service stops.
  - The Caddyfile serves one port and routes the S3 bucket paths unchanged, so presigned uploads work through the
    Space's address.
  - The Space card (`README.md`) and the guide `docs/DEPLOY_HUGGINGFACE.md`.
  - The demo banner offers "Open Tributary in a new tab" when the app is embedded in a frame.
  - README: the free option comes first.
- Evidence (local run with `PUBLIC_URL=http://localhost:7860`, as uid 1000):
  - startup completed (`web on :7860`)
  - the banner shows the demo logins
  - scientist signs in; the Experiments page lists the demo data, and the Explorer returns 25 rows
  - a browser upload to `/tributary-raw/…` through a presigned URL returned 200 and completed
  - admin (with `TRIBUTARY_ADMIN_PASSWORD`) sees every health check OK: database, object storage, query,
    compute, identity provider, job queue and search index
  - the Keycloak admin path returns 404
  - memory is about 1.1 GB when idle
  - screenshots in `artifacts/deploy/hf-space-*.png`
- Fixed during the trial:
  - SeaweedFS's volume server took port 8080 from Keycloak (moved to 8090).
  - The setup step needed the API's sign-in settings exported.
- Not verified here:
  - a build on Hugging Face itself (it needs the owner's account and a public repository)
  - the embedded-frame link, which can only be seen inside the Space page
- Commit: 42e1a83
- **Follow-up:** the "open in a new tab" banner change had not been applied in that commit; my text replacement did
  not match the formatted file and nothing failed loudly. It is added now, with a unit test
  (`isEmbedded`, `OSS-01: the app knows when it runs inside a frame`).

## 2026-11-02 — Phase 21: Infrastructure as code (plan only) — done
- Built:
  - **Modules** (`infra/terraform/modules`): kms, network, s3, s3tables, rds, ecs-service, alb, cloudfront,
    eventbridge-sqs, batch, healthomics, iam. `envs/dev` composes them, with `terraform.tfvars.example`.
  - **Validation:** `pnpm run infra:validate` (`infra/terraform/validate.sh`: fmt, validate, tflint, checkov).
  - **CI:** an `infra` job in CI. `.github/workflows/aws.yml` builds arm64 images to ECR and runs `terraform plan`,
    only once `AWS_PLAN_ROLE_ARN` is set.
  - **API:** builds the AWS Batch and HealthOmics runners from its environment (`env-runners.ts`, PIPE-01 test).
  - **Database:** `DATABASE_SSLMODE` for connections configured from parts (OSS-01 test).
  - **Docs:** `docs/DEPLOY.md`, the AWS runbook (resources, cost table, tools, prerequisites, variables, plan,
    apply by a human, updating, rollback, production notes).
- Decisions (and why): ADR 0026.
  - Validation runs in CI because the plan forbids installing the tools here.
  - IAM write actions are scoped to account ARNs.
  - Availability zones are explicit.
  - The KMS key policy skips are inline, with reasons.
- Dependencies added: none (CI installs terraform via hashicorp/setup-terraform@v3, tflint via
  terraform-linters/setup-tflint@v4, and checkov==3.4.0 via pip on the runner only).
- Evidence, CI `infra` job on a6c4ca8 + aa17219 (run 41396468101):
  ```
  == terraform fmt
  == terraform validate envs/dev/
  Success! The configuration is valid.
  == tflint
  == checkov
  Passed checks: 463, Failed checks: 0, Skipped checks: 3
  infra:validate: all checks passed
  ```
  The 3 skips are the inline KMS key-policy skips; the rest are skipped by `.checkov.yaml` with reasons.
  The first CI run found 10 checkov issues, then 2 more. All were fixed:
  - scoped Batch, Omics and Logs IAM
  - pinned AZs
  - multipart abort on exports
  - our own CloudFront headers policy with HSTS preload
  - KMS inline skips

  `pnpm check` ✓ (local, exit 0).
- Gaps and follow-ups:
  - **No real plan yet:** `terraform plan` has not run against an account, because no sandbox profile was
    provided. `aws.yml` runs it once the repository variables are set.
  - **Alarms:** CloudWatch alarms are listed in `docs/RUNBOOK.md` but are not in Terraform.
  - **Production database TLS:** use `verify-full` with the RDS CA bundle.
- Commits: cf618dd, a6c4ca8, aa17219

## 2026-11-02 — Phase 22: Hardening and v2.0 release — partial
- Built:
  - **Observability (OPS-08):** request ids and W3C trace context go from api to query and compute.
    - A valid inbound `x-request-id` is kept, else a UUID is used; it is echoed in the response and logged as `reqId`.
    - `traceparent` is continued or started; `traceId` is on every request log line through Fastify's
      `childLoggerFactory`.
    - Only the internal services receive the headers (a fetch wrapper with an AsyncLocalStorage context that
      survives body parsing).
    - Compute logs one JSON line per request to stdout.
    - No new dependencies.
  - **Load test (OPS-04):** `pnpm run load:test` (`scripts/ops/load-test.mjs`, dependency-free), with 8 concurrent
    users against the full stack.
  - **Restore rehearsal (OPS-06):** `pnpm run ops:rehearse-restore` and `docs/RUNBOOK.md` (backups, restore,
    alarms, logs, routine operations, incident checklist).
  - **Accessibility (OPS-09):** an axe (WCAG 2.2 AA) e2e test over every page, and two fixes it found:
    - the release preview now scrolls by keyboard;
    - the Explorer no longer shows an empty grid header before the first query.
  - **Docs:** `docs/USER_GUIDE.md`, `docs/ADMIN_GUIDE.md`, `docs/DEMO.md` and `CHANGELOG.md`.
- Load test, local, 4 vCPU, seeded data, 8 users × 10 requests after one warm-up:

  | Scenario | p50 ms | p95 ms | SPEC §9 target p95 |
  |---|---:|---:|---|
  | Explorer, one experiment: filter + sort + page | 65 | 224 | < 2,000 |
  | Cross-experiment query | 111 | 167 | < 8,000 |
  | Join with reference table | 85 | 208 | < 3,000 |
  | Volcano render (figure JSON) | 33 | 51 | interactive (client) |
  | Heatmap, rows + columns clustered | 97 | 182 | < 10,000 |
  | Clustering 2,000 × 100, both axes (compute) | 392 | 493 | < 10,000 |

  - **Gap:** seeded data is small. Engine scaling to 5M–50M rows is `pnpm bench:query` (Phase 12). An in-region
    run waits for a sandbox AWS account.
- Security:
  - **Reviews:**
    - `/security-review` on the branch diff: no findings at or above the reporting bar (noted as hardening: dev
      `no-verify` DB TLS, no ALB origin secret).
    - `/code-review high`: 10 findings, all fixed in cfa9a92 and b38cba0:
      - CloudFront→ALB certificate name
      - KMS for OAC and S3 Tables
      - overlapping S3 lifecycle rules
      - ECR expiring deployed tags
      - aws.yml pipefail and immutable re-runs
      - trace ids missing on Fastify's own log lines
      - compute logs dropped under uvicorn
      - required tags
      - S3 Tables CMK and retention
      - HealthOmics behind a flag
      - exact action pins
  - **Ticketed:** `pnpm audit --prod` reports 6 advisories (4 high, 2 moderate), all in
    `@modelcontextprotocol/sdk` 1.30.0 and fixed in 1.32.0 (published 2026-10-02, under the 90-day rule).
    - Exposure is limited: bodies are parsed and size-limited by Fastify (1 MB), the transport is per request, and
      the SDK's OAuth client and bearer-auth helpers are not used.
    - **Needs the owner's approval to upgrade.**
  - **Licence scan:** 196 dependencies, all allowed. SBOM in CI.
- Decisions:
  - **Observability without the OTel SDK:** dependency-free id and trace propagation. Exporting spans to a
    collector needs `@opentelemetry/*` packages, which need approval.
  - **New tracker ids:** OPS-08 (trace propagation) and OPS-09 (accessibility pass) were added to
    `features.json`, because OPS-04…07 did not cover them.
- Dependencies added: none.
- Test changes, disclosed:
  - The OPS-08 compute test's `caplog` fixture is typed instead of using a `noqa` (ruff RUF100).
  - Prettier formatting only on the OPS-08 tests.
  - A log-coverage test was added after the review.
- Evidence:
  - `pnpm check` ✓ (exit 0; api 212 tests).
  - `pnpm e2e OPS-09` ✓ and `pnpm e2e EXP-0` ✓ (local).
  - CI `infra` ✓ (checkov 463 passed, 0 failed).
  - Screenshots in `artifacts/phase-22/`.
- Gaps and follow-ups:
  - **Release:** tag `v2.0.0` after merge (owner to confirm). OPS-07 stays false until then.
  - **AWS:** an in-region benchmark and a human install and restore rehearsal need a sandbox account.
  - **Approvals:** the OTel SDK and the MCP SDK 1.32.x upgrade.
  - **Unrelated flake:** CI e2e RES-02 failed once with "Failed to fetch" on a commit that changed only Terraform;
    it passes 3/3 locally and passed on the next CI run.
- Commits: a79a0b0, c34df15, e8866b4, 3c17a98, 74b68d6, 818e83d, 4d3e219, 94be55a, cfa9a92, b38cba0

## 2026-11-02 — Phase 23: Legacy data onboarding — done (relational extraction deferred)
- Built (ING-06):
  - **Plan:** `POST /v1/onboarding/plan` is a dry run over a linkable prefix.
    - Path patterns (`{experiment}`, `{sample}`, other tokens become manifest columns, `{*}` is ignored) give
      the experiments, inferred sample manifests (`sample_key`, path tokens, and `raw_file`/`instrument_run` for
      raw files) and file roles.
    - Unmatched objects are reported. Conflicting values for the same sample give warnings.
  - **Runs:** `POST /v1/onboarding/runs` and `…/resume` execute the plan through the API's own routes, in
    process, as the caller. Authorisation, validation, immutability and audit are those of the normal endpoints.
    - `max_experiments` per call; imports wait for QC; failed items are retried on resume.
    - Existing experiments, samples, files and releases are reused, never duplicated or overwritten.
  - **Report:** `GET /v1/onboarding/runs/:id` gives counts per kind and status, failures with reasons, unmatched
    objects, totals, and each file's sha256, size and ingest status.
  - **Schema:** migration `0020_onboarding`.
  - **Docs:** a section in `docs/ADMIN_GUIDE.md`.
- Decisions (and why):
  - **No new write paths:** running through the existing routes in process means nothing bypasses the rules
    already enforced there.
  - **Nothing guessed:** inference comes only from the caller's patterns, and inferred manifests are drafts with
    their cell errors stored, for review before publishing.
- Dependencies added: none.
- Test changes, disclosed:
  - DB-01's expected table list gained `onboarding_item` and `onboarding_run`.
  - The ING-06 retry assertion now follows a third resume. The first import attempt happens at the second
    resume, once the file has passed QC. `attempts = 2` is still asserted.
- Evidence:
  - `pnpm run test:api ING-06` ✓ 6/6, on a synthetic layout: 2 experiments, 14 Thermo RAW files, 2 DIA-NN
    matrices (one deliberately broken), and an unmatched notes file.
  - `pnpm check` ✓.
- Gaps and follow-ups:
  - **Relational extraction is deferred.** Extracting tables through DuckDB's postgres/mysql scanners into
    reference datasets is not built: this environment cannot download DuckDB extensions (extensions.duckdb.org
    returns 403 through the proxy), so it could not be tested.
    - **Options for the owner:** allow that host, or bundle the extensions in the query image.
  - **No UI for onboarding yet:** it is API only.
  - **Linking by key:** a file whose key is a prefix of another object's key is refused, with a reason, rather
    than linked.
- Commits: e55e0d0, 0f5ed21, 2014c8d, 2a0718c
- **Follow-up (Phase 22):** CI e2e failed on OPS-09.
  - **Cause:** on a freshly seeded stack, run in parallel, no dataset release existed yet. The test had assumed
    data created by other tests.
  - **Fix:** the test now creates its own published experiment and release (56601be). The pages and checks are
    unchanged, and it passes locally (2/2).

## 2026-11-03 — Phase 24: Pathway enrichment — done
- Built:
  - **Compute:** `/stats/enrichment`, ORA with a one-sided hypergeometric test from log sf, a p floor and BH across
    the tested sets (ENR-01).
  - **Gene-set collections:** migration 0021 and a system-admin GMT import, audited, with line-numbered errors
    (ENR-02).
  - **`POST /v1/enrichment`:**
    - hit selection by source adjusted p and fold change, with a strict sign test;
    - a tested-only universe, or the annotated option;
    - species check, isoform normalisation, protein-group counters, and full provenance (ENR-03).
  - **Results page:** a "Pathway enrichment" panel with a dot plot (term-FDR line) and table.
  - **Demo data:** `reference/gene_sets.gmt` (20 invented modules, on their own RNG stream, so no other fixture
    changed), seeded as "Demo modules (synthetic)" (ENR-04).
- Decisions (and why): ADR 0027.
  - ORA now, GSEA later.
  - The default universe is the measured and tested features; the clusterProfiler-style annotated universe is an
    option.
  - GO (CC BY) and Reactome (CC0) are allowed; MSigDB is not bundled, because of its licence.
- Science review (omics-reviewer): 11 findings. Fixed:
  - untested features were in the universe;
  - silent truncation of large releases (the contrast is now filtered in the query, and a partial read is a 422);
  - multi-gene hit groups and conflicting identifiers are now counted;
  - species mismatch is refused and isoforms are stripped;
  - the universe choice is offered and recorded;
  - p underflow;
  - the term-FDR line had used the hit threshold;
  - the source adjustment method is now recorded;
  - strict sign test;
  - labels;
  - the error field mapping.
- Dependencies added: none.
- Test changes, disclosed in their own commits:
  - DB-01 table list: the gene-set tables.
  - The ENR-01 test file runs in pyright basic mode (as `test_stats.py` does, for SciPy).
  - The ENR-03 untested test counts every gene of a two-gene group.
  - The ENR-04 e2e expects the reviewed provenance wording.
  - `publishedDaRelease` (test helper) gained optional bytes and species.
- Evidence: `pnpm check` ✓ (api 227, compute 86), and `pnpm e2e ENR-04` ✓ and `OPS-09` ✓ locally.
  - The screenshot is `artifacts/phase-24/enrichment.png`.
  - With random demo modules, nothing passes the term FDR, which is the honest result.
- Gaps and follow-ups:
  - GSEA (rank-based).
  - Term redundancy reduction.
  - Network view (needs a graph-renderer dependency, so approval first).
  - A UI for importing gene sets (API only today).
- Commits: 6d73c40 … e73f300

## 2026-11-03 — Phase 25: Hit triage board — done
- Built:
  - **Schema:** migration 0022 with `triage_item` (unique per program, kind and key), `triage_evidence` (snapshots)
    and `triage_event` (append-only: the app role has no UPDATE).
  - **API:** list, create (idempotent), read, change status or owner (a status change needs a reason, which is also
    the audit reason), comment, add evidence (TRI-01…03).
    - **Owners:** must be members of the program.
    - **Evidence:** a release the caller can read that holds the item: the protein's row in a differential-abundance
      release (log2 FC and adjusted p), or the compound in a dose-response release.
  - **Web:** a board with one column per decision. Cards are buttons, so it needs no drag and drop. The item panel
    holds the decision with its reason, "Assign to me", evidence, history and comments. "Add to triage" is on the
    protein and compound pages (TRI-04).
- Decisions (and why):
  - **No drag and drop:** decisions need a reason, and drag and drop is hard to make accessible.
  - **Evidence is a snapshot:** it stays true because releases are immutable.
  - **History is append-only:** enforced by grants.
- Dependencies added: none.
- Test changes, disclosed:
  - DB-01 table list: the triage tables.
  - OPS-09 also checks `/triage`, so the page list grows and nothing is loosened.
  - TRI-04: Prettier formatting only.
- Evidence: `pnpm check` ✓ (api 232), and `pnpm e2e TRI-04` ✓ and `OPS-09` ✓ locally. The screenshot is
  `artifacts/phase-25/triage-board.png`.
- Gaps and follow-ups:
  - "Add to triage" is not yet on rows of the results page's top-hits table.
  - Evidence cannot yet be attached from the UI.
  - The owner picker supports "Assign to me" only (the API takes any program member).

## 2026-11-03 — Phase 26: Watchlists and alerts — done
- Built:
  - **Schema:** migration 0023 with `watch` (per user, kind and key; soft delete) and `alert` (unique per watch,
    release and contrast).
  - **Alerts on publish:** `notifyWatchers` runs after every publish, both the UI path and pipeline outputs.
    - It reads only the release's hit rows (adjusted p ≤ 0.05 and |log2 FC| ≥ 1, in the query) in one query.
    - It matches watched proteins (isoform suffixes stripped), genes and compounds.
    - Only watchers whose effective roles let them read the program get an alert.
    - Inserts skip duplicates, and an audit row is written. It is best effort: it never fails a publish.
  - **API:** list, create (idempotent), delete (soft) watches; list, read and read-all alerts. Everything is
    personal, so other users get "not found", and every mutation is audited.
  - **Web:** a Watch button on the protein and compound pages, and an Alerts menu in the top bar.
- Found by e2e and fixed:
  - Alert readers and triage owners had used `role_binding` rows only, which missed group-derived roles.
  - Both now use `loadBindings`, as the principal does.
- Dependencies added: none.
- Test changes: DB-01 table list (watch, alert); Prettier formatting of the WAT-03 spec.
- Evidence: `pnpm check` ✓ (api 235), and `pnpm e2e WAT-03` ✓ and `TRI-04` ✓ locally. The screenshot is
  `artifacts/phase-26/alerts.png`.
- Gaps and follow-ups:
  - Email or webhook delivery of alerts: the in-app menu only for now (the webhooks from Phase 20 could carry them).
  - Per-watch thresholds.
  - A page listing all watches.

## 2026-11-03 — Phase 27: Cross-experiment QC and batch effects — done
- Built:
  - **API:** `POST /v1/qc/overview` reads the latest published protein_quant release of each readable experiment
    (newest N, then oldest first). A run is one sample × instrument run.
    - IDs = protein groups quantified (intensity > 0, or a log2 intensity) and not imputed.
    - % missing is measured against the release's protein groups.
    - Median log2 intensity per run and median IDs per experiment come from apps/compute.
    - Runs with IDs < 0.5 × their experiment's median are flagged.
  - **PCA (apps/compute):** unflagged runs × protein groups quantified in all of them, matched by sorted
    accessions; centred, not scaled. Colour by experiment, plate, condition or date (plates and conditions named
    within their experiment).
  - **Provenance:** every counting rule, counts of imputed cells, derived log2 values and dropped rows, the dataset
    and importer per experiment, and the source normalisation. It warns when normalisation differs. An oversized
    release is skipped and listed, never truncated.
  - **Web:** a `/qc` page with the IDs trend, the PCA, a runs table and the provenance list. It is in the nav and
    the a11y sweep.
- The omics-reviewer found 15 issues. All are fixed, with unit tests in `qc/runs.test.ts`:
  - imputed cells counted as IDs
  - re-injections merged under one sample
  - log2-only releases read as empty
  - mixed normalisation not flagged
  - group-string order
  - plate labels repeating across experiments
  - colours repeating
  - q-value policy not stated
  - skip reasons, dropped rows, release choice and PC2 fallback
  - injection-order suggestion in the trend
  - pca_note wording
  - flag edge cases
- Dependencies added: none.
- Test changes: the QCD-02 expected IDs for the poor run are derived from the modified matrix. The fixture's first
  protein row is empty in every run, so the hard-coded 10 was wrong; this is its own commit.
- Evidence: `pnpm check` ✓ (api 243), and `pnpm e2e QCD-03` ✓ and `OPS-09` ✓ locally. The screenshot is
  `artifacts/phase-27/qc-overview.png`.
- Gaps and follow-ups:
  - Precursor-level QC (mzQC, retention-time drift) is not shown.
  - The overview is computed on request and not cached.
  - Acquisition order is not recorded, so the trend uses manifest order.

## 2026-11-04 — Phase 28: Compound structures and structure search — done
- Built (ADR 0028):
  - **RDKit:** `@rdkit/rdkit` 2025.3.4-1.0.0 (BSD-3-Clause, approved 2026-11-04) runs in apps/api.
  - **Structure endpoint:** `GET /v1/compounds/{id}/structure` returns:
    - an SVG depiction, canonical SMILES and computed InChIKey;
    - descriptors: MW, exact MW, Crippen logP, TPSA from N and O, Lipinski and RDKit donor/acceptor counts,
      rotatable bonds, rings;
    - the component count (salts);
    - every batch, with a flag when batches register different structures.
  - **Search:** `POST /v1/compounds/search` does substructure search (SMARTS, or SMILES read as a molecule) or
    similarity search (Morgan radius 2, 2048 bits, Tanimoto).
    - It covers every distinct batch structure in the readable programs.
    - The first match is highlighted and matches are counted.
    - Unreadable registered SMILES are listed with program, compound and batch.
  - **Web:**
    - The structure and descriptors appear on the compound page, with a batch picker.
    - A new "Structures" page has a query, a mode, SMARTS or SMILES, a threshold, and hit thumbnails linking to
      the compound in its program.
    - SVGs are shown as images, never injected into the page.
- Found and fixed along the way: mutations sent while `/v1/auth/me` was still loading went out without a CSRF
  token, so pages that POST on load (QC, structure search) got 403 on a fresh load. React Query's retries had
  hidden this on the QC page. They now wait for the session (AUTH-01 unit test).
- Chemistry review: 11 findings, all fixed with tests (`chem-structures.test.ts`):
  - Lipinski vs RDKit HBD/HBA
  - SMILES vs SMARTS queries
  - stereochemistry stated
  - salt components flagged
  - batch structures
  - program-scoped compound IDs
  - null instead of 0
  - labels
  - match counts
  - text after a space
  - invalid entries named in full
- Dependencies added: `@rdkit/rdkit` 2025.3.4-1.0.0 (approved).
- Test changes, each in its own commit:
  - The CHEM-02 `invalid_structures` assertion now expects program, compound and batch.
  - The AUTH-01 test now drives the wait through `fetchMe`.
  - The CHEM-04 e2e test uses the exact name for the Search button.
  - The CHEM-02 chloro query uses chlorobenzene: the Cl is meta to the amide N, not para.
- Evidence: `pnpm check` ✓ (api 249, web 32), and `pnpm e2e CHEM-04` ✓ and `OPS-09` ✓ locally. The screenshots are
  `artifacts/phase-28/substructure-search.png` and `compound-structure.png`.
- Gaps and follow-ups:
  - There is no structure drawing (sketcher): queries are typed.
  - No parent-structure standardisation.
  - No stereo-aware search.
  - Search time grows with the number of compounds (up to 50k batches per search).

## 2026-11-04 — Phase 29: 3D protein structure viewer — done
- Built (ADR 0029):
  - **API:** `GET /v1/proteins/{id}/model` and `/model.cif` serve models from a local directory
    (`PROTEIN_MODELS_DIR`) or AlphaFold DB (`ALPHAFOLD_URL`), from the same origin.
    - Only UniProt accessions are sent out.
    - Other hosts and redirects are refused.
    - Files are cached in memory.
    - Each model is labelled predicted, with its confidence metric and licence.
  - **Synth:** three synthetic ModelCIF models (helix–loop–helix) with per-residue pLDDT. They carry
    `ma_qa_metric` and B-factors, so the viewer behaves as it does with AlphaFold files.
  - **Web:** a "3D model" section on protein pages. Mol* loads on demand, coloured by pLDDT with a key, and the
    source, entry and licence are shown.
- Also fixed: `licence:scan` checked only the root workspace's dependencies (147 of about 1000 Node packages). It
  now checks every workspace (`-r`), and all 1026 pass. `stack-trace@0.0.9` (via plotly.js) has no licence field;
  its LICENSE file is MIT and is recorded by exact version.
- Dependencies added: `molstar` 5.11.0 (approved).
- Root script added: `format:compute` (ruff format and fix).
- Test changes: the STRUC-02 test's mmCIF loop parser was fixed (it dropped the first header line), and an unused
  type was removed from the STRUC-01 test, each in its own commit.
- Evidence: `pnpm check` ✓ (api 252, web 32, compute 88), and `pnpm e2e STRUC-03` ✓ locally. The screenshot is
  `artifacts/phase-29/protein-3d-model.png`.
- Gaps and follow-ups:
  - Peptide or site mapping onto the structure.
  - Experimental PDB structures.
  - PAE.
  - The AlphaFold path was tested with a stub, because this environment cannot reach EBI.

## 2026-11-04 — Phase 30: Gene–concept network — done
- Built:
  - **API:** enrichment responses carry `hit_genes`. Each hit identifier in the universe has its log2 FC when it is
    a hit in one feature. When it is a hit in several, it has the feature count and whether their signs agree, and
    no value is picked.
  - **Web:** a gene–concept network (Cytoscape.js `cose` layout) under the enrichment results.
    - It shows the top 8 sets and their hit genes.
    - Genes are coloured by log2 FC (diverging, clamped at ±3). Multi-feature genes are grey with a dashed edge.
    - A table alternative lists every gene with its value and sets.
    - Cytoscape loads on demand.
- Also fixed: the error-alert text on its pink background was 4.4:1 contrast, now 5.9:1 (AA). The a11y sweep found
  it on a protein page whose AlphaFold lookup cannot reach EBI from this environment.
- Dependencies added: `cytoscape` 3.34.0 (approved).
- Test changes: none.
- Evidence: `pnpm check` ✓ (api 253, web 33), and `pnpm e2e NET-02`, `ENR-04` and `OPS-09` ✓ locally. The
  screenshot is `artifacts/phase-30/gene-concept-network.png`.
- Gaps and follow-ups:
  - Protein–protein interaction networks need a STRING-style reference dataset: a new dataset contract and
    importer.
  - The network cannot be exported as an image yet.

## 2026-11-04 — Phase 31: Team notifications (Slack and Teams) — done
- Built (ADR 0030):
  - **Migration 0024:** `notification_route` and the `notification_delivery` outbox.
  - **API:** system-admin routes, kept secret and checked against Slack's and Teams' own hosts, with audit. They
    support list, create, update, delete, test and deliveries.
  - **Events** from publish (UI and pipeline outputs), version publish, triage decisions and finished runs.
  - **Sweep:** a 15 s sweep in the API process. It claims rows with `SKIP LOCKED` and makes 5 attempts with
    backoff.
  - **Web:** an Admin → Notifications page to add a channel, send a test, pause, remove, and see the last
    deliveries.
- Dependencies added: none.
- Test changes: DB-01's table list gains the two new tables.
- Evidence: `pnpm check` ✓ (api 256, web 33, db 17), and `pnpm e2e NOTIF-04` ✓ and `OPS-09` ✓ locally. The
  screenshot is `artifacts/phase-31/notifications.png`. The test message fails locally because this sandbox
  cannot reach Slack, and the page reports that.
- Gaps and follow-ups:
  - Personal email (needs SES or SMTP approval).
  - Per-user preferences.
  - A real Slack/Teams check: use **Send test** on a real channel.

## 2026-11-04 — Phase 32: Excel sample sheets — done
- Built:
  - **Upload:** the manifest editor's **Upload file** accepts `.xlsx`, parsed in the browser by read-excel-file.
    - It reads the sheet named "samples", or else the first, and says which sheet it read.
    - Numbers keep the text Excel stored.
    - Date cells become ISO dates, with a warning (Excel turns names like SEPT1 into dates).
    - Duplicate and unnamed columns are reported.
    - The usual preview and column mapping follow.
  - **Download Excel:** writes the manifest as `.xlsx` with every cell as text (write-excel-file).
  - **Also fixed:** wide upload previews now scroll inside their card.
- Dependencies added: `read-excel-file` 9.3.5 and `write-excel-file` 4.1.1 (approved).
- Test changes: the XLS-01 e2e checks "1 µM" in the grid after Apply, because the preview shows only the first five
  rows. This is in its own commit.
- Evidence: `pnpm check` ✓, and `pnpm e2e XLS-01`, `MAN-01` and `OPS-09` ✓ locally. The screenshot is
  `artifacts/phase-32/xlsx-preview.png`.

## 2026-11-04 — Phase 33: Experiment reports — done
- Built:
  - **Report page:** `/experiments/{id}/report`, linked from the results page. It shows:
    - methods;
    - per contrast: hit counts at the display thresholds (counted by the query service), the volcano and the top 10
      hits;
    - data and files.
  - **Print / save as PDF:** print styles hide the app frame.
  - **Download PowerPoint:** built in the browser with pptxgenjs, from a unit-tested slide plan, using the rendered
    volcano images.
  - **Audit:** both exports are recorded by `POST /v1/versions/{id}/report-exports` and audited
    (`report.export`).
- Dependencies added: `pptxgenjs` 4.0.1 (approved).
- Test changes: the REP-01 payload type was tightened (typecheck only, its own commit).
- Evidence: `pnpm check` ✓ (api 257, web 38), and `pnpm e2e REP-03` and `OPS-09` ✓ locally. The screenshots are
  `artifacts/phase-33/report.png` and `report-print.png`.
- Gaps and follow-ups:
  - The report covers differential-abundance contrasts. QC, dose-response and enrichment sections can follow.

## 2026-11-04 — Phase 34: Personal email — done
- Built:
  - **Migration 0025:** `notification_preference` and the `email_delivery` outbox.
  - **API:** `GET` and `PUT /v1/me/notification-preferences` (own only, audited). Emails are on by default for
    three events:
    - a new hit for an item you watch (one email per release);
    - a triage item assigned to you (not by yourself);
    - your pipeline run finished.
  - **Sending:** the 15 s notification sweep sends emails with the same claiming, retries and backoff as channel
    deliveries.
  - **Transport:** `EMAIL_TRANSPORT` = `ses` (@aws-sdk/client-sesv2) or `smtp` (nodemailer). Unset means emails
    are not queued.
  - **Content:** names and a link only.
  - **Web:** an "Email notifications" page in the user menu.
- Dependencies added: `@aws-sdk/client-sesv2` 3.1156.0 and `nodemailer` 9.0.4 (approved). MIT-0 was added to the
  licence allowlist (ARCHITECTURE §9).
- Test changes: DB-01's table list gains the two new tables.
- Evidence: `pnpm check` ✓ (api 260), and `pnpm e2e MAIL-01`, `OPS-09`, `TRI-04` and `WAT-03` ✓ locally. The
  screenshot is `artifacts/phase-34/email-settings.png`.
- Gaps and follow-ups:
  - Digests (daily or weekly).
  - HTML email.
  - A real SES/SMTP send needs a configured installation.

## 2026-11-05 — Phase 35: SCIM user provisioning — done
- Built (ADR 0031):
  - **Migration 0026:** SCIM identity columns, `deactivated_at`, group-membership `source`, and the `scim` token
    scope.
  - **Endpoints:** `/scim/v2` discovery, Users and Groups.
  - **Deactivation:** blocks access at once and is reversible.
  - **Linking:** the first sign-in links to the provisioned account.
  - **Memberships:** sign-in group claims never undo SCIM memberships.
  - **UI:** Admin → Access shows the SCIM endpoint and creates or revokes the token.
- **Found and fixed during the phase:**
  - A token without `read` or `write` could still perform reads through the general auth hook and the MCP
    endpoint. Now `/v1` and MCP require one of those scopes (tests in SCIM-01).
- Dependencies added: none.
- Evidence: `pnpm check` ✓ (api 264), and `pnpm e2e SCIM-04`, `AUTH-01` and `OPS-09` ✓ locally. The screenshot is
  `artifacts/phase-35/scim-token.png`.
- Gaps and follow-ups:
  - Not supported: bulk, sort, ETags, complex filters, enterprise extension attributes.
  - Not yet tested against a live Okta or Entra tenant.

## 2026-11-05 — Phase 36: Usage analytics for admins — done
- Built:
  - **API:** `GET /v1/admin/usage?weeks=` (system admins), counted from the audit log and the registry, with no
    new tracking. It returns:
    - weekly measures (active people, experiments, publishes, imports, runs, exports, assistant, triage);
    - totals;
    - per program and per person;
    - a definition for every measure, and a figure.
  - **CSV:** `/v1/admin/usage/export` is audited (`usage.export`).
  - **Web:** an Admin → Usage page with headline numbers, a weekly chart plus a table, programs and people, a CSV
    download, and the definitions.
- Also fixed:
  - Weeks are computed as UTC text, so a server in another time zone cannot shift them.
  - The demo seed created its own account as a person. It is now a service (seed fix, plus migration 0027 for
    databases seeded before).
- Dependencies added: none.
- Evidence: `pnpm check` ✓ (api 266), and `pnpm e2e USE-03` and `OPS-09` ✓ locally. The screenshot is
  `artifacts/phase-36/usage.png`.

## 2026-11-09 — Phase 37: Support diagnostics bundle — done
- Built:
  - **Endpoint:** `GET /v1/admin/support-bundle` (system admins), audited as `support.bundle`. It contains:
    - version and build, Node and Postgres versions;
    - migrations applied and pending;
    - the health report;
    - a configuration summary from an allowlist (switches, counts and host names only);
    - record counts;
    - the last 7 days' failures: pipeline runs, channel deliveries, emails without addresses, rejected imports.
  - **UI:** a "Download support bundle" button on Admin → Health.
  - **Version:** the API reports 2.1.0-dev (it was a hard-coded 0.0.0), plus `APP_BUILD` when the deployment sets
    it.
- Tests: secrets (cookie secret, OIDC client secret, internal token, SMTP password, webhook URL) and personal data
  never appear in the bundle.
- Evidence: `pnpm check` ✓ (api 268), and `pnpm e2e SUP-02`, `ADM-03` and `OPS-09` ✓ locally.

## 2026-11-09 — Phase 38: Validation pack — done
- Built:
  - **Generator:** `scripts/validation-pack.mjs` (no dependency) writes `docs/validation/TRACEABILITY.md` and `.csv`.
    Each requirement in features.json gets its verification method (automated test, or command/document check), the
    tests that carry its feature ID and its status. 139 requirements and 562 linked tests, with no gaps.
  - **Check:** `pnpm check` now runs `test:scripts` and `validation:pack --check`. It fails when the matrix is stale or
    a requirement marked passing has no evidence. A verify command that runs tests counts only with tests that
    match.
  - **Templates:** `docs/validation/` holds:
    - a README (Tributary is not a validated system; the pack supports the customer's own validation);
    - IQ and OQ protocol templates, with the OQ steps tied to feature IDs;
    - a 21 CFR Part 11 controls map, with partial and procedural controls stated as such.
- Fixed during the phase: test-shaped text inside strings (the generator's own fixtures) was counted as evidence. Only
  calls at the start of a line in the file's own language count now, and a regression test covers this.
- Dependencies added: none.
- Test amendment (disclosed): MAIL-01 in `apps/api/src/email.test.ts` failed in CI by chance. Its "no data values"
  pattern `e-\d` matched a random release UUID (`…8dfe-58…`). The test now replaces UUIDs with `<id>` before applying
  the same pattern. The assertion is otherwise unchanged.

## 2026-11-09 — Phase 39: Fuller experiment reports — done
- Built (web only, from existing endpoints):
  - **QC section:** the QC panel of the version's protein-quantity release.
  - **Pathway enrichment:**
    - Pick gene sets, then **Add to report**. Enrichment runs for every contrast with the report's display thresholds.
    - It states the collection, hit definition and method, plus per contrast: hits, background, sets tested and how
      many pass the term FDR.
    - It shows the top 10 sets and the API's recorded transformations.
    - A contrast without hits says so; the others still run.
  - **Dose-response section:**
    - curves per class, as the source tool classed them (a capped count is shown as "> n");
    - the curves figure;
    - the top regulated curves by FDR, then pEC50 (it says when ranking is by pEC50 only).
  - **Output:** every section is in the PowerPoint plan. Controls are not printed, nor is the enrichment section until
    it has a result.
- Science review (omics-reviewer):
  - **P1, fixed:** a contrast without hits made the whole enrichment fail.
  - **P2s, fixed:**
    - an "unclassified" label for curves the tool did not class;
    - capped counts;
    - "measured set members" for K;
    - significance and provenance shown with the enrichment;
    - QC caption (per sample, pooled CV, missing or ≤ 0 = not quantified);
    - FDR (q-value) label, and the pEC50-only ranking note.
- Not changed:
  - The QC panel still pools conditions for the CV and plots per sample. This is the existing chart (Phase 9); the
    caption says so.
  - Colouring by condition would need a sample-metadata join in the chart. That is a follow-up.
- Test amendments (disclosed): this phase's own REP-04…07 tests were tightened after the review, before the
  implementation was committed, in commits `5f319c6` and the REP-07 caption commit.
- Dependencies added: none.

## 2026-11-09 — Phase 40: Content-Security-Policy — done
- Built:
  - **One policy:** `infra/terraform/modules/cloudfront/csp.json`.
    - CloudFront's response-headers policy builds the header from it in Terraform: new `upload_origin` input, from the
      S3 module's `raw_bucket_origin`.
    - The Vite dev and preview servers build it with `apps/web/src/security/csp.ts`. The dev server also allows inline
      scripts, for React refresh.
    - No `unsafe-eval`, no inline scripts, `frame-ancestors 'none'`, `object-src 'none'`. `connect-src` allows
      `'self'` plus the raw bucket, for presigned uploads.
  - **Eval removed from the browser (found by the e2e test):**
    - Plotly `scattergl` now uses Plotly's strict (precompiled regl) module, the one its own `lib/index-strict.js`
      uses.
    - Mol* 5.11 `mol-util/string.js` `interpolate` (`new Function`, mouse-binding help only) is rewritten by a
      Vite/Rolldown plugin. A changed Mol* fails the build.
    - Mol*'s movie-export encoder (`h264-mp4-encoder`, Emscripten embind) is aliased to a stub that refuses.
    - zod runs `jitless`, so its eval probe does not trigger a violation.
- Evidence:
  - The whole e2e suite (64 tests) passes against the production build served with the policy.
  - SEC-02, STRUC-03, NET-02 and REP-03 pass on the dev server. Correction (Phase 41): that run actually hit a
    leftover preview server. SEC-02 and STRUC-03 were re-run on fresh dev servers in Phase 41 and pass.
- Not verified locally: Terraform is not installed here; CI's infra job runs fmt, validate, tflint and checkov.
- Dependencies added: none.

## 2026-11-09 — Phase 41: QC CVs per condition — done
- Built:
  - **Shared spec:** `apps/web/src/results/qc-spec.ts` is used by the results page and the report.
    - When every sample of the version has a condition, it left-joins the version's sample sheet on
      (experiment_version_id, sample_key) and colours by condition, so CVs are computed within each condition.
    - Otherwise CVs stay pooled, and the caption and slide say which.
  - **CV note:** names the column without the join alias.
- Fixed:
  - **Pre-existing:** the compute service takes at most 200 groups per group-summary request. QC panels of more
    than 200 proteins failed ("The computation failed"), so every real-sized dataset did. The API now batches
    requests at 200 and merges them in order, and records every compute version that answered.
  - **Science review (omics-reviewer):**
    - runs not in the sample sheet form a labelled "not in the sample sheet" group with a note, never "all runs";
    - the CV note counts feature–condition pairs and names conditions without CVs;
    - imputed values (`is_imputed`, read when present via the chart registry's new `readIfPresent`) count as not
      quantified, with a note (this predates the phase);
    - the caption says CVs use all runs of a condition.
- Test amendments (disclosed, each in its own commit):
  - QCD-05 note wording ("within condition");
  - QCD-04 replicate test data;
  - REP-07's QC caption: the fixture records conditions, so the caption is now the per-condition one;
  - a type-only `!` in the QCD-04 contract test.
- Evidence: `pnpm check` ✓, and `pnpm e2e "QCD-0|REP-0|RES-01|SEC-02"` ✓ (6) on fresh dev servers. Before the
  review fixes, the full e2e suite (65) passed.
- Not done: no screenshot for this phase. The QC panel looks as before, with one box per condition in the CV panel.
- Dependencies added: none.

## 2026-11-10 — Phase 42: Compound selectivity profile — done
- Why: competitors' registries and ELNs do not answer "how selective is this compound, and what else does it hit?"
  from proteomics data. Tributary holds the dose-response curves needed to answer it.
- Built:
  - **Endpoint:** `GET /v1/compounds/{id}/selectivity?release_id&pec50_min&direction`, computed per readable
    dose-response dataset (one profiling experiment). It reports:
    - proteins tested (classed by the tool) and regulated (up, down);
    - S(x) after Karaman et al. 2008;
    - the selectivity window against annotated primary targets;
    - a ranked figure and provenance notes.
  - **Compound page:** a Selectivity section with dataset, direction and threshold in the URL.
- Science review (omics-reviewer), all fixed:
  - **P0:** an experiment with one dose-response dataset per compound could profile the wrong dataset. Selection is
    now per release.
  - **P1s:**
    - curves without a class are no longer counted as tested;
    - a direction choice, with notes on what regulation means per assay design;
    - correct notes when a target is regulated but has no pEC50;
    - gene-level features match annotations by gene symbol.
  - **P2s:**
    - ambiguous protein groups flagged;
    - duplicate curves counted and noted;
    - "apparent potency in this assay" (not "cellular");
    - thresholds and potencies outside the tested dose range flagged;
    - figure symbols, threshold and truncation labelled;
    - EC50 unit rounding.
- Found from the screenshot: compound-to-target links are a reference dataset (as the compound page's Targets table
  reads them), not the `target_annotation` table. The test setup first inserted into the table, which hid the bug.
- Test amendments (disclosed, each in its own commit): this phase's SEL-02 setup, and SEL-01…03 tightened after the
  review. The shared test helper gained importer options and extra datasets per version.
- Evidence: `pnpm check` ✓, and `pnpm e2e "SEL-03|RES-04|SEC-02"` ✓. Screenshot: `artifacts/phase-42/selectivity.png`.
- Dependencies added: none.
- Not done: TPP (thermal proteome profiling) import. The TPP package's result-table format could not be read from
  here: Firecrawl's daily limit was reached, and Bioconductor and rdrr.io are blocked. Guessing a format is not
  allowed.
