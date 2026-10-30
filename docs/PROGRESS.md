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
