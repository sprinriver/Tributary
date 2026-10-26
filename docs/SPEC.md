# Tributary — Product Specification v2.0

Status: draft for build · Owner: Spring & River · Last updated: 2026-10-26
Companion docs: `docs/ARCHITECTURE.md` (how), `docs/PLAN.md` (order of work), `docs/REFERENCE_V1.md` (what v1 did).
Every feature below ends with an **E2E check** — the build is not done until that check passes.

---

## 1. Product summary

**One line.** A proteomics-first experiment data platform that a drug-discovery team installs in its own AWS
account: register experiments with structured, ontology-backed metadata; run standard pipelines; explore,
join and chart results across experiments and against compound data; and let AI assistants use the data
safely through governed, deterministic tools.

**Problem (from v1 and market research).**
- Experimental data is large, multi-dimensional (proteomics, genomics) and scattered: data silos are the top
  challenge for 57% of lab leaders; 49% need help with standards and ontologies to make data FAIR.
- Experiment lifecycle (versioning, processing, annotation) is manual and error-prone; reproducibility suffers.
- Tools to integrate and analyse datasets from multiple sources are weak; omics results rarely meet
  chemistry (compounds, ADME) in one place.
- Commercial platforms are NGS-centred, services-heavy, priced for enterprises, or cap out on large tables
  (e.g. ~1,000 points per chart block, 50,000-row analysis sources in one leading ELN).

**Positioning — where we win.**
1. Proteomics as a first-class data type: native import of DIA-NN, Spectronaut, MaxQuant, FragPipe and
   quantms (QPX) outputs; dose-response proteomics (CurveCurator) as first-class results.
2. Omics ↔ chemistry joins for small-molecule programs (compound registry IDs, ADME, target annotations).
3. Installs in the customer's own AWS account at small-biotech cost (~$400–500/month infra before compute),
   with SSO and audit trail included, not enterprise-gated.
4. Fast on big matrices: DuckDB over Parquet/Iceberg, server-side paging, WebGL charts.
5. Open formats (Parquet/Iceberg, SDRF export, OpenAPI) — no lock-in.
6. AI that is safe to use: assistants call validated, deterministic analyses with the user's own permissions,
   show the query they ran, and need approval for any write.

**Non-goals for v2.0.** ELN, LIMS/inventory, compound registration (we link to the customer's registry),
raw MS/NGS signal processing inside the app (pipelines do that), single-cell explorer, genome browser,
validated GxP system (we ship "Part 11-ready" controls, not validation), multi-tenant SaaS.

---

## 2. Users and their top jobs

| Persona | Top jobs |
|---|---|
| Bench scientist | Register an experiment from a sample sheet; launch the standard pipeline; see QC, volcano and dose-response results the same day; find past experiments. |
| Computational biologist | Query, filter and join results across experiments; export to notebooks; re-run analyses with changed parameters; trust lineage. |
| Programme lead / medicinal chemist | "What does compound X do across all experiments?" "Where else did protein Y move?" Compare compounds on targets and ADME. |
| Data / platform admin | Manage programmes, picklists, templates, ontologies, pipelines, users and roles; audit; retention. |

---

## 3. Scope

**v2.0 (this build):** M1–M13 below. Assay types: proteomics (DIA, DDA, TMT), RNA-seq differential
expression, CRISPR screen gene summaries. Raw NGS files (FASTQ, BAM, CRAM, VCF) are registered and tracked
as files with lineage; they are not queried interactively.

**v2.1+ (later):** PTM site-level data (`site_quant`), variant tables from VCF, single-cell metadata and
embeddings, TPP melting-curve viewer and Kinobeads-specific views, enrichment/pathway views, Excel (XLSX)
manifest import, ELN/registry connectors (e.g. Benchling), multi-tenant hosted demo, Seqera Platform runner
adapter.

---

## 4. Domain model

All IDs UUIDv7. All tables carry `tenant_id` (single value per deployment; kept for a future SaaS),
`created_at`, `created_by`, `updated_at`, `deleted_at`.

| Entity | Key fields | Rules |
|---|---|---|
| **Program** | name, code, description | Top-level grouping and permission scope (v1 "scientific program"). |
| **AssayType** | key (`proteomics_dia`, `proteomics_dda`, `proteomics_tmt`, `rnaseq`, `crispr_screen`, `ngs_raw`), label, family (proteomics/genomics) | Seeded; admin can disable. |
| **MetadataTemplate** | assay_type, version (semver), fields[], status | Defines required/optional experiment and sample fields, types, ontologies, units. Versioned; experiments pin a template version. Seed templates aligned with SDRF-Proteomics. |
| **MetadataFieldDef** | scope (`experiment`/`sample`), key, label, type (`text`, `number`, `integer`, `boolean`, `date`, `enum`, `ontology_term`, `quantity`), unit (UO term), ontology (e.g. NCBITaxon, Cellosaurus, UBERON, EFO, ChEBI), enum values, required, **searchable**, template_id or experiment_version_id (custom field) | v1 "custom keys with Is Semantic Search". Custom fields are per experiment version; template fields are shared. |
| **Experiment** | program_id, assay_type, name, urn | Logical container. URN: `urn:tributary:experiment:<uuid>`. |
| **ExperimentVersion** | experiment_id, version_number (1..n), parent_version_id, status (`draft`→`published`→`archived`), template_version, experiment_date, species (NCBITaxon term), spectral_library (for proteomics), time_points[] (quantity), description, custom (jsonb), publish_reason, published_by/at, urn `urn:tributary:experiment:<uuid>:v<n>` | Drafts editable; published versions immutable (DB trigger). "Create version" clones a version into a new draft. Exactly one `latest_published` per experiment. |
| **Sample** | experiment_version_id, sample_key (unique in version), source_name, characteristics (jsonb: organism, cell_line, tissue, cell_type, disease…), factors (jsonb: compound_id, dose_molar, dose_display, time_hours, condition, replicate_group…), technical (jsonb: plate, well, fraction, label_channel, instrument_run), custom (jsonb) | Typed by the template + custom field defs. Validation errors stored per cell. |
| **SampleFile** | sample_id, file_id, role (`raw`, `processed`, `other`) | Links samples to raw files (v1 manifest "raw-file URI"). |
| **Contrast** | experiment_version_id, label, numerator (condition expression), denominator, method_hint | Analysis design, separate from samples (SDRF excludes analysis design). E.g. `CPD-0001@1µM vs DMSO`. |
| **FileObject** | bucket, key, s3_version_id, sha256, size_bytes, format (detected), declared_format, storage_class, ingest_status, qc_report (jsonb) | Never mutated in place; new upload = new object version. |
| **Dataset** | kind (see §6.2), experiment_version_id (nullable for reference datasets), program_id, name | Logical dataset. |
| **DatasetRelease** | dataset_id, release_number, contract_version, storage (`iceberg` table + snapshot_id, or parquet prefix), row_count, column_stats (jsonb), source (importer key + version, pipeline_run_id, file_ids), transformations[] (jsonb), status (`staged`→`published`/`rejected`), published_at | Immutable once published. Explorer shows published releases only. |
| **PipelineDefinition** | key, name, repo, revision, runner_types[], assay_types[], params_schema (nf-schema JSON), default_params, output_importers (map of output glob → importer key) | Admin-managed. |
| **PipelineRun** | pipeline_definition_id, experiment_version_id, runner (`local`, `aws_batch`, `healthomics`), external_id, status (§7.4), params (jsonb), work_dir, output_uri, log_links[], started/finished_at, cost_estimate, triggered_by | v1 "Trigger NextFlow" + job status + log link. |
| **Compound** (reference) | compound_id (registry ID), batch_id, name, smiles, inchikey, external_ids (jsonb: chembl…), program_id | Imported from the customer's registry export; we never register compounds. |
| **CompoundProperty** (reference) | compound_id, property (e.g. logD7.4, kinetic solubility, Papp A→B, CLint), value, unit, qualifier (`=`, `<`, `>`), assay_category (`ADME`, `physchem`, `binding`, `functional`, `tox`), assay_name | Activities normalised to −log molar where relevant. |
| **TargetAnnotation** (reference) | uniprot_accession, gene_symbol, family, key, value | Generic key/value, e.g. kinase group, hinge residues, pocket annotations. |
| **SavedView** | name, owner, query_spec, chart_spec (optional), visibility (`private`, `program`), share_token | Shareable explorer state (v2 addition). |
| **LineageNode / LineageEdge** | node kind (`file`, `dataset_release`, `pipeline_run`, `experiment_version`, `chart`, `ai_artifact`), edge relation (`input_to`, `produced`, `derived_from`, `describes`) | OpenLineage-shaped; traversed with recursive CTEs. |
| **AuditEvent** | actor_id, actor_type (`user`, `service`, `ai_assistant_on_behalf_of`), action, entity_type, entity_id, before (jsonb), after (jsonb), reason, request_id, ip, at | Append-only (no UPDATE/DELETE grants). |
| **User / Group / RoleBinding** | from OIDC (sub, email, name, groups); role bindings per program: `viewer`, `contributor`, `approver`, `admin`; plus global `system_admin` | Group→role mapping configurable per customer IdP. |

---

## 5. Modules and features

Notation: **Parity** = must match v1 behaviour (see `docs/REFERENCE_V1.md` section). **New** = v2 addition.

### M1 — Experiment registry

**Parity (REFERENCE_V1 §2–4).**
- List page with filters: assay type, free-text search over searchable fields, experiment date (range in v2),
  name; sortable columns; pagination; row actions *Launch pipeline* and *Create version*.
- Columns available: name, version, URN, program, species/spectral library, time points, created at,
  status, latest flag, parent version, pipeline status, results-available flag. Column chooser (New).
- Create experiment: details (assay type, date, name, species/library, time points, program) and
  experiment-level custom fields with *searchable* flag.
- Create version: opens the editor pre-filled from the selected version; assay type locked; saving creates a
  new draft linked to its parent.

**New.**
- Draft → Publish workflow with required reason; publish validates the manifest against the template and
  blocks on errors. Approver role required to publish when the program setting `requires_approval` is on.
- Version history panel and **diff view** (experiment fields, custom fields, sample rows added/removed/changed).
- Picklists (programs, species/libraries, time points) and templates managed in Admin (M11).
- Archive (hide from default lists; still referenceable).

**E2E check.** Create a proteomics experiment with 3 custom fields (one searchable) → upload a manifest →
publish with a reason → create version 2, change two samples → diff shows exactly those changes →
v1 is still readable and immutable (edit attempt returns 409).

### M2 — Sample manifest editor

**Parity (REFERENCE_V1 §3).** Upload CSV/TSV; editable grid; add row, edit row, delete row; sample-level
custom columns with *searchable* flag shown as removable chips.

**New.**
- Parse in a Web Worker (Papa Parse) with delimiter auto-detection; preview before applying.
- **Paste TSV block** dialog (copy from Excel → paste → map columns) instead of grid clipboard features.
- **Column mapping** step: map uploaded headers to template fields (saved as presets per program).
- Validation against the pinned template with inline cell errors and a summary panel; the same zod schema
  runs in the browser and on save.
- Ontology-backed cells (organism, cell line, tissue, compound class) use a typeahead backed by EBI OLS4
  (configurable base URL; responses cached in Postgres for offline/air-gapped use).
- Quantity cells (dose, time) accept value + unit and normalise to SI with display unit kept.
- Bulk fill (set a column for selected rows), find/replace, undo for the session.
- **Plate layout view** (96/384-well) coloured by any factor; click a well to edit its sample.
- **SDRF-Proteomics export** (validated with `sdrf-pipelines` in apps/compute) and SDRF import.
- Contrasts editor: define comparisons (numerator vs denominator) from condition values.

**E2E check.** Upload a 96-row TSV with 5 deliberate errors (bad well, unknown species, dose without unit,
duplicate sample key, missing required field) → each error shows on its cell → fix them inline → publish
succeeds → exported SDRF passes `sdrf-pipelines` validation.

### M3 — Files and ingest

**New (v1 only stored paths).**
- Browser → S3 presigned multipart upload (resumable; files up to 5 TB per S3 limits; tested to 50 GB).
- **Link existing objects**: register objects already in a customer bucket by prefix (bulk, for migration),
  with checksums computed asynchronously.
- Format detection: extension + content sniffing (gzip/BGZF via `file-type`; custom sniffers for FASTQ,
  VCF, CSV/TSV, Parquet; vendor MS raw formats by extension/structure: `.raw`, `.d`, `.wiff`, `.mzML`).
- Ingest state machine (§7.3) run by pg-boss jobs; each transition audited.
- QC gate: a failed QC report blocks pipeline launch for that experiment version until overridden by an
  approver (override reason audited).
- Storage classes and lifecycle tags per file role (raw → infrequent access after N days; work dirs expire
  after N days) — the v1 programme's "data lifecycle management" requirement, configured in Admin.

**E2E check.** Upload two raw files and a manifest; files reach `qc_passed`; a corrupted gzip reaches
`qc_failed` with a readable reason; launch is blocked until an approver overrides with a reason (the
launch half of this check runs once launch exists, in Phases 10–11).

### M4 — Pipelines

**Parity (REFERENCE_V1 §5).** One-click launch per experiment version; status shown on the list
(SUBMITTED/RUNNING/terminal); link to logs; results-available flag.

**New.**
- Pipeline definitions registry (admin): repo, pinned revision, runners, assay types, `params_schema`
  (nf-schema JSON) → the launch form is generated from it, with defaults from the experiment
  (e.g. SDRF path, species, contrasts).
- Runner adapters behind one interface (§7.4): `local` (dev/test, runs `pipelines/demo` or Nextflow in
  Docker), `aws_batch` (Nextflow head job, Spot-capable, works in every region incl. ap-south-1),
  `healthomics` (AWS HealthOmics StartRun; only in its 8 supported regions).
- Status via EventBridge → SQS consumer with idempotent upserts, plus a poller for non-terminal runs
  (event delivery is best-effort). Per-task progress from trace files.
- Run page: parameters, timeline, task table, recent log lines (CloudWatch FilterLogEvents), deep links,
  outputs, cost estimate, cancel, re-run with edited params (creates a new run; never overwrites outputs).
- On success: outputs matched to importers (`output_importers`) → dataset releases staged → contract checks
  → published; lineage edges written; owner notified (in-app; email optional).
- Supported out of the box: `bigbio/quantmsdiann` (DIA-NN), `bigbio/quantms` (DDA/TMT; SDRF-driven),
  `nf-core/differentialabundance` (limma/DESeq2 contrasts), `nf-core/rnaseq`; plus "custom pipeline" with
  importer mapping. We ship pipeline definitions only: proprietary engines such as DIA-NN run from the
  customer's own container image under the customer's own licence (DIA-NN's academic edition is
  non-profit only).

**E2E check (local runner).** Launch `pipelines/demo` on a seeded experiment → status goes
SUBMITTED → RUNNING → SUCCEEDED in the list without refresh → outputs become published dataset releases →
results page renders → lineage shows files → run → releases.

### M5 — Dataset catalog and importers

**New.**
- Canonical dataset kinds and contracts (§6.2), each with an ODCS v3.2 YAML export and machine-checked
  quality rules (e.g. log2_fc finite, 0 < p_value ≤ 1, ≥ 4 dose levels for curve fits).
- Importers (§6.3) map tool outputs to canonical schemas with DuckDB SQL; original column names and tool
  versions are preserved in the release metadata.
- **Custom tabular import** with a column-mapping UI and saved mapping presets — covers in-house pipeline
  outputs (like v1's) without code.
- Reference data import: compounds, compound properties, target annotations (CSV/TSV/Parquet) with
  upsert-by-key and versioned releases.
- Catalog UI: datasets by experiment/program/kind; schema, column stats, contract, lineage, releases.

**E2E check.** Import a DIA-NN `report.pg_matrix.tsv` fixture and a limma topTable fixture → both pass their
contracts → catalog shows row counts and column stats → a deliberately broken file is rejected with the
failing rule named.

### M6 — Data Explorer

**Parity (REFERENCE_V1 §6).** Pick a primary dataset; filter builder with AND/OR and operators
`= != > >= < <= startswith`; multi-table inner/left/right joins with join conditions; paginated sortable
table; CSV download; "Join & Filter" and "Visualization" tabs.

**New.**
- Metadata tables (experiment versions, samples with their factors, files, runs) are pickable and joinable,
  as in v1 (§6.2 metadata kinds).
- Dataset picker by experiment, by kind across experiments (e.g. "all differential-abundance releases in
  Program A, latest versions only"), or reference data.
- Typed operators per column type: numbers (`= != > >= < <= between`), text (`= != startswith endswith
  contains in notIn`), booleans, nulls (`isNull notNull`), arrays (`contains any`). Nested groups and NOT.
- Joins on **declared join keys** from dataset contracts (e.g. `compound_id`, `uniprot_accession`,
  `gene_symbol`), with an advanced mode for any key pair; protein-group **explode** option so a group
  `P1;P2` joins on each accession and the ambiguity is flagged.
- Server-side pagination and sorting (AG Grid datasource), column chooser, pinned columns,
  number formatting (scientific for p-values).
- Export current result: CSV, TSV, Parquet (streamed; audited).
- **Saved views** (query + optional chart) with share links honouring permissions.
- **Copy as code**: Python (requests + pandas), R (httr2), and the QuerySpec JSON for the API.

**E2E check.** Open a differential-abundance dataset → filter `gene_names startswith "CDK"` AND
`adj_p_value < 0.05` → join compound properties on `compound_id` (left join) → sort by `log2_fc` →
page 3 loads in < 2 s on seeded data → export CSV equals the on-screen rows → save view → reopen via link.

### M7 — Visualization

**Parity (REFERENCE_V1 §7).** Chart types: line, bar, scatter 2D, scatter 3D, box/violin, histogram/KDE,
lollipop, volcano, bubble, heatmap, dendrogram, pie/donut — with their required/optional encodings and
options (pseudolog, standardisation, smoothing, orientation, error bars, p-value calculation, clustering
method, distance metric, leaf ordering, colour threshold, bootstrap N, layout options). Plotly modebar
(PNG download, zoom, pan, box/lasso select, autoscale, reset).

**New.**
- **Chart registry** (§7.2): one schema per chart type drives the form, server validation, data shaping,
  and tests. Apply is disabled until the schema validates; errors appear next to the control (fixes every
  v1 defect class in REFERENCE_V1 §8).
- Type-aware column pickers (numeric slots list only numeric columns), facet cardinality cap (≤ 24) with
  the count shown, minimum rows per group checks, explicit null policy (drop with count shown, or block).
- Omics presets: **volcano** with fold-change and adjusted-p thresholds, labelled top hits, lasso to
  table, and a **known-target overlay** (highlight the compound's annotated targets and off-targets);
  **MA plot**; **PCA** (scores + variance explained); **heatmap with row/column clustering** and
  z-scoring; **dose-response curve viewer** (§M8); **QC panel** (IDs per run, completeness/missingness,
  CV distribution, intensity distributions).
- Statistics computed in apps/compute (clustering + bootstrap, KDE, p-values, 4PL fits, PCA); light
  transforms (pseudolog, z-score, binning, BH) in TypeScript.
- Export PNG/SVG; every chart carries **provenance** (dataset releases, QuerySpec, chart spec, compute
  versions) shown in an info popover and saved with the view.
- Lasso/box selection → "show selected rows" in the table.

**E2E check.** For every chart type: render from seeded data; each REFERENCE_V1 §8 failure scenario now
shows a field-level validation message instead of a server error; volcano with 200k points pans smoothly
(WebGL); dendrogram with bootstrap N=100 on 200×20 returns in < 10 s.

### M8 — Results pages and cross-experiment views

**New.**
- **Experiment results page**, generated automatically when a pipeline run publishes outputs: QC panel,
  one volcano per contrast, top-hits table, dose-response summary, downloadable files, and an auto-written
  **methods paragraph** (tools, versions, parameters, contrasts, thresholds) the scientist can copy.
- **Dose-response viewer**: per protein/compound curves with fitted parameters (pEC50, slope, plateaus,
  curve fold change, relevance score, regulation class), filters by regulation class and FDR, small-multiples grid.
- **Protein / gene page**: every experiment and contrast where it was measured or significant; dose-response
  curves across compounds; target annotations.
- **Compound page**: all omics results for the compound (by contrast and dose), dose-response hits,
  properties/ADME table, targets.
- Cross-experiment comparison: pick 2–6 contrasts → scatter of log2_fc vs log2_fc, an overlap table, and
  UpSet-style intersection bars drawn with Plotly (do not use UpSet.js — AGPL).

**E2E check.** After the M4 demo run, the results page appears with the methods paragraph listing the
pipeline revision; the compound page for a seeded compound lists its contrasts and ADME rows.

### M9 — Search

**Parity.** Free-text "What are you looking for?" across fields flagged searchable.

**New.**
- Hybrid search: Postgres full-text (tsvector, GIN) + pgvector embeddings (HNSW, iterative scans), fused by
  reciprocal rank. Ontology synonyms (from cached OLS terms) expand queries.
- Embedding provider configurable: `none` (full-text only), `bedrock_titan_v2`, `voyage_4`, or a local
  model in apps/compute. Default `none` so the product works with zero AI configuration.
- Faceted results (assay type, program, species, compound, status) and a ⌘K global search.
- Permission filters applied inside every sub-query (no post-filtering leaks).

**E2E check.** Seeded corpus: query "HEK293 inhibitor 24 hours" returns the matching experiment
in the top 3 with full-text only; a viewer of Program A never sees Program B results (tested at API level).

### M10 — Lineage and audit

**New (v1 had file lineage in a graph DB).**
- Lineage graph view for any file, run, release, chart or AI artifact (upstream/downstream, depth control).
- Audit log viewer with filters and CSV export; per-entity history tab.
- Part 11-ready controls (not validation): immutable published versions, reason for change, approve/publish
  step that requires re-authentication (OIDC `prompt=login` / `max_age`), server-synced timestamps, retention.

**E2E check.** For a published release, lineage shows raw files → run (with pipeline revision) → release →
saved chart; the audit tab shows publish with reason and approver.

### M11 — Admin

Programs, role bindings and IdP group mapping, picklists, metadata templates (with versioning and
migration preview), ontology sources, pipeline definitions, runner configuration, storage lifecycle
policies, AI settings (provider, enabled features, budgets), system health.

**E2E check.** Admin creates a template v1.1 adding a required field → existing published versions remain
valid under v1.0 → new drafts must satisfy v1.1.

### M12 — AI assistant and MCP server

See §11 for rules. Features:
- **In-app assistant** (side panel, off by default): answers questions about the user's data by calling
  tools — search experiments, describe datasets, build a QuerySpec ("show CDK proteins down > 2-fold with
  adj p < 0.05 for compound X"), propose a chart spec, explain a chart, summarise a results page.
  Always shows the QuerySpec/chart spec it used, with a one-click "open in Explorer".
- **Metadata curation assistant**: suggests ontology terms for free-text manifest values using OLS lookups
  only (it may not invent terms); suggestions are applied only after the user accepts them.
- **Methods/summary drafting** from run provenance.
- **MCP server** exposing the same tool registry (read tools + approval-gated writes) so Claude, Claude
  Science or other assistants can query the platform with the user's permissions.
- **Agent Skill** (a `SKILL.md` bundle shipped with the product) that teaches a customer's Claude how to use
  these tools well: explore an experiment, compare compounds, build a QuerySpec, cite releases.
- Every AI tool call is audited with the acting user; every AI-produced artifact carries provenance.

**E2E check.** With a stub model in tests (and a real provider in a manual check), the question above yields
a QuerySpec that validates and returns the same rows as the hand-built query; a write tool call pauses for
approval; a viewer's assistant cannot read another program's data.

### M13 — API and SDK

OpenAPI 3.1 generated from zod; versioned `/v1` paths; cursor pagination; generated TypeScript client
(used by apps/web) and Python client (published as a wheel for notebooks); personal access tokens and
service accounts with scopes; webhooks for run and release events (v2.0: run status only).

**E2E check.** The generated Python client lists experiments and runs a QuerySpec in a pytest against the
local stack.

---

## 6. Data contracts

### 6.1 Sample manifest (canonical columns; SDRF-aligned)

| Column | Type | Notes |
|---|---|---|
| `sample_key` | text, unique in version | Required. |
| `source_name` | text | SDRF `source name`. |
| `organism` | ontology_term (NCBITaxon) | Required; defaults from experiment species. |
| `cell_line` | ontology_term (Cellosaurus) | Optional. |
| `tissue` / `cell_type` | ontology_term (UBERON / CL) | Optional. |
| `disease` | ontology_term (EFO/MONDO) | Optional. |
| `compound_id` | text (registry ID) or `vehicle` | Links to Compound reference data when present. |
| `vehicle` | text (e.g. DMSO) | For controls. |
| `dose` | quantity (value + unit) | Normalised to `dose_molar`. |
| `time` | quantity | Normalised to `time_hours`. |
| `condition` | text | Derived default `compound@dose` or `vehicle`; editable. |
| `replicate_group` / `biological_replicate` / `technical_replicate` | text / int / int | |
| `plate` / `well` | text / text (`A01`–`P24`) | Well validated against plate format. |
| `fraction` / `label_channel` | text | TMT channel e.g. `TMT126`. |
| `raw_file` | file reference (S3 URI or uploaded file) | One or more; links SampleFile. |
| `instrument_run` | text | Run name as the search engine reports it. |
| custom columns | per MetadataFieldDef | Searchable flag drives M9. |

Manifest import maps arbitrary headers to these columns (mapping presets). SDRF export maps them to
`characteristics[...]`, `factor value[...]` and `comment[...]` columns per the SDRF-Proteomics templates.
Reserved tokens `not available` and `not applicable` (SDRF convention) are distinct from an empty cell:
empty = not yet filled (blocks publish if required); the tokens = deliberately absent (allowed).

### 6.2 Canonical dataset kinds (v2.0)

Every row carries `experiment_version_id` (except reference kinds) and every release records
`tool`, `tool_version`, `importer`, `importer_version`, `transformations`.

**`protein_quant`** (long format; wide matrices are melted on import)
`sample_key, instrument_run, protein_group (text as reported), protein_ids (text[]), gene_names (text[]),
intensity (double, linear), log2_intensity (double), q_value (double?), n_precursors (int?),
is_imputed (bool), normalisation (text?)`

**`precursor_quant`** (DIA precursor level; needed for QC and re-quantification)
`sample_key, instrument_run, precursor_id, modified_sequence, charge, protein_group, protein_ids, gene_names,
intensity, q_value, pg_q_value?, global_q_value?, retention_time?, ion_mobility?`

**`differential_abundance`**
`contrast_id, contrast_label, feature_type (protein_group|gene), feature_id, protein_ids (text[]),
gene_names (text[]), log2_fc, ci_low?, ci_high?, se?, t_stat?, p_value, adj_p_value, adj_method,
avg_log2_abundance?, n_obs_num?, n_obs_den?, missing_pct?, imputed_pct?, missingness_class?
(complete|MAR|MNAR|partial|unknown), na_reason? (why a statistic is null, e.g. `all_missing_in_group`,
`too_few_replicates`, `independent_filtering`, `outlier`), issue?, method (limma|MSstats|DEqMS|DESeq2|other),
method_version, source_columns (json)`.
Release metadata records the fold-change threshold style: `post_hoc` (|log2FC| cut applied after testing) or
`tested` (tested against a threshold, e.g. limma treat / DESeq2 `lfcThreshold`), so charts label it correctly.

**`dose_response`**
`feature_id, protein_ids, gene_names, compound_id, n_doses, doses_molar (double[]), responses (double[]),
pec50?, ec50_molar?, hill_slope?, top?, bottom?, curve_fold_change?, r2?, curve_p_value?,
relevance_score?, regulation (up|down|not|unclear), fdr?, method (CurveCurator|MSstatsResponse|4PL),
method_version`

**`qc_metrics`** — `scope (run|sample|experiment), scope_key, metric, value, unit?, threshold?, status (pass|warn|fail)`

**`rnaseq_counts`** — `sample_key, gene_id (Ensembl), gene_name, count, tpm?`

**`crispr_gene_summary`** — `gene, n_guides, neg_score, neg_p, neg_fdr, neg_rank, neg_lfc, pos_score,
pos_p, pos_fdr, pos_rank, pos_lfc` (MAGeCK pipe-delimited headers reshaped)

**Reference kinds** — `compound`, `compound_property`, `target_annotation` (§4), and `id_mapping`
(UniProt accession ↔ gene symbol ↔ Ensembl gene ↔ species, versioned by source release, e.g. the UniProt
release used) so joins on identifiers are reproducible.

**Metadata kinds (read-only)** — `experiment_version`, `sample` (characteristics and factors flattened to
columns: organism, cell_line, compound_id, dose_molar, time_hours, condition, replicate_group, …),
`file_object`, `pipeline_run`. Served live from program-scoped Postgres views through DuckDB's postgres
extension with a read-only database role, so results can be joined to manifest factors (v1 parity: the v1
explorer could open its metadata tables).

Declared join keys: `compound_id`, `uniprot_accession` (via exploded `protein_ids`), `gene_symbol`
(via `gene_names`), `sample_key`, `contrast_id`, `experiment_version_id`.

### 6.3 Importers (v2.0)

| Importer key | Source | Target kind | Notes |
|---|---|---|---|
| `diann_pg_matrix` | DIA-NN `report.pg_matrix.tsv` | protein_quant | Melt wide → long; run names → `instrument_run` → manifest. |
| `diann_report_parquet` | DIA-NN `report.parquet` (precursor) | precursor_quant + qc_metrics | Keep q-values; per-run IDs and completeness. |
| `alphadia_output` | AlphaDIA precursor/protein outputs | precursor_quant + protein_quant | |
| `mzqc` | HUPO-PSI mzQC JSON (e.g. from pmultiqc) | qc_metrics | Tracks QC per instrument over time. |
| `spectronaut_report` | Spectronaut report export | protein_quant | Carries condition/replicate; cross-check vs manifest. |
| `maxquant_protein_groups` | MaxQuant `proteinGroups.txt` | protein_quant | Remove reverse/contaminant rows only if flagged, recorded as a transformation. |
| `fragpipe_combined_protein` | FragPipe `combined_protein.tsv` | protein_quant | |
| `quantms_qpx` | quantms QPX Parquet (pg/feature + sample/run) | protein_quant (+ qc) | Apache-2.0 schema; preferred for quantms runs. |
| `limma_toptable` | limma `topTable` (logFC, CI.L, CI.R, AveExpr, t, P.Value, adj.P.Val, B) | differential_abundance | From nf-core/differentialabundance or custom R. |
| `msstats_comparison` | MSstats (Protein, Label, log2FC, SE, Tvalue, DF, pvalue, adj.pvalue, issue, MissingPercentage, ImputationPercentage) | differential_abundance | `issue` → issue; missingness from MissingPercentage. |
| `deqms_result` | DEqMS (`sca.*` columns) | differential_abundance | |
| `deseq2_results` | DESeq2 (baseMean, log2FoldChange, lfcSE, stat, pvalue, padj) | differential_abundance (feature_type gene) | NA padj kept as null with reason. |
| `curvecurator` | CurveCurator output (pEC50, Curve Fold Change, Curve P_Value, Curve Regulation, …) | dose_response | Exact columns verified from CurveCurator docs in Phase 9. |
| `mageck_gene_summary` | MAGeCK `gene_summary.txt` | crispr_gene_summary | |
| `custom_tabular` | any CSV/TSV/Parquet + saved mapping | any kind | UI-driven mapping preset. |

Importers never run tool code: they read files with DuckDB, map, validate and write the release. They must
tolerate column renames between engine versions (keyed by detected tool version) and decimal-comma locale
exports, and record the original column names.

---

## 7. Shared specifications (live in packages/contracts)

### 7.1 QuerySpec (the only way to ask for data — UI, API, AI)
```ts
QuerySpec = {
  source: { releaseIds: UUID[] } | { kind: DatasetKind, scope: { programIds?: UUID[];
            experimentVersionIds?: UUID[]; latestPublishedOnly?: boolean } },
  joins?: { type: 'inner'|'left'|'right'; target: SourceRef; alias: string;
            on: { left: ColumnRef; op: '='|'!='|'>'|'<'|'startsWith'; right: ColumnRef }[];
            where?: RuleGroup;   // filters the joined table inside its subquery (keeps LEFT-join semantics; v1 parity)
            explode?: 'protein_ids'|'gene_names' }[],
  where?: RuleGroup,   // react-querybuilder JSON: { combinator: 'and'|'or', not?: boolean, rules: (Rule|RuleGroup)[] }
  select?: ColumnRef[], orderBy?: { column: ColumnRef; dir: 'asc'|'desc' }[],
  page?: { size: 25|50|100|500|1000; cursor?: string }, limitRows?: number
}
```
The server validates every column against the release contracts (whitelist + type map), validates operator ×
type compatibility, compiles to parameterized DuckDB SQL, applies row/time/memory limits, and returns
`{ rows, columns, totalRows, nextCursor, sqlHash, elapsedMs }`. Raw SQL is never accepted.

### 7.2 Chart registry and ChartSpec
```ts
ChartDefinition = { type: ChartType; label: string;
  encodings: Record<'x'|'y'|'z'|'color'|'shape'|'opacity'|'size'|'hover'|'panel'|'label'|'rowLabel'|'values'|'categories',
             { required: boolean; accepts: ('numeric'|'categorical'|'temporal'|'any')[]; multiple?: boolean }>;
  options: ZodSchema;              // types, ranges, defaults, and cross-field `requires` rules
  dataRules: { minRows?: number; minRowsPerGroup?: number; maxFacets?: number; maxPoints?: number;
               nullPolicy: 'drop-and-report'|'block' };
  compute: 'none'|'ts'|'python';   // where shaping/statistics run
  traces: PlotlyTraceType[] }      // e.g. ['scattergl'] for volcano
ChartSpec = { type; title?; data: QuerySpec | { savedViewId }; encodings; options;
  axes?: { x?: { title?: string }; y?: { title?: string }; z?: { title?: string } };   // v1 parity: axis titles
  layout: { palette; gridX; gridY; sharedX; sharedY; sharedLegend; subplotLegend } }
```
Registry covers the 12 v1 types plus MA plot, PCA, dose-response, QC panel. A test matrix exercises every
option and every `requires` rule per chart.

### 7.3 Ingest state machine
`registered → uploading → uploaded → type_detected → contract_validated → qc_passed | qc_failed →
published | rejected` (files and dataset releases share the pattern). Every transition: timestamp, actor,
audit row. Only `published` releases are visible in the Explorer.

### 7.4 PipelineRunner and run states
```ts
interface PipelineRunner { start(run): Promise<{ externalId }>; getStatus(externalId): Promise<RunStatus>;
  cancel(externalId): Promise<void>; logLinks(externalId): Promise<LogLink[]> }
RunStatus = 'submitted'|'pending'|'starting'|'running'|'stopping'|'succeeded'|'failed'|'cancelled'
```
Adapters map native states (HealthOmics: Pending/Starting/Running/Stopping/Completed/Failed/Cancelled;
Batch: SUBMITTED…SUCCEEDED/FAILED). The API writes `submitted` itself. Transitions are idempotent upserts
keyed by (run_id, external status, event time).

---

## 8. API surface (v1 paths; all zod-validated; all mutations audited)

`/v1/auth/*` (login, callback, logout, me) · `/v1/programs` · `/v1/templates` · `/v1/experiments`
(list/search/create) · `/v1/experiments/:id/versions` · `/v1/versions/:id` (get/patch draft) ·
`/v1/versions/:id/publish` · `/v1/versions/:id/clone` · `/v1/versions/:id/diff/:otherId` ·
`/v1/versions/:id/samples` (bulk upsert/delete, validate) · `/v1/versions/:id/contrasts` ·
`/v1/versions/:id/sdrf` (export/import) · `/v1/files` (initiate/complete multipart, link prefix) ·
`/v1/datasets`, `/v1/releases/:id` (schema, stats, lineage) · `/v1/importers` (run, mapping presets) ·
`/v1/query` (QuerySpec → page) · `/v1/query/export` (stream) · `/v1/charts/render` (ChartSpec → Plotly
figure JSON) · `/v1/views` · `/v1/pipelines` (definitions) · `/v1/runs` (launch, get, cancel, logs) ·
`/v1/search` · `/v1/lineage/:nodeId` · `/v1/audit` · `/v1/admin/*` · `/v1/ai/chat` (streaming) ·
`/v1/ai/tools` · `/mcp` (MCP Streamable HTTP) · `/healthz`, `/readyz`.

---

## 9. Non-functional requirements

| Area | Target (measure, don't assume) |
|---|---|
| Explorer query, one experiment (≤ 10M long rows), filter + sort + page | p95 < 2 s warm, < 5 s cold |
| Cross-experiment query (≤ 50M rows, partition-pruned) | p95 < 8 s |
| Join with reference tables | p95 < 3 s |
| Volcano render | 200k points via WebGL, interactive |
| Heatmap clustering | 2,000 × 100 in < 10 s; larger → async job with progress |
| Manifest editor | 2,000 rows smooth; validation < 1 s |
| Uploads | resumable multipart; 50 GB tested |
| Scale assumptions per customer | 10³–10⁴ experiments, 10⁵–10⁶ samples, 1–200 TB raw |
| Availability | single-AZ default, Multi-AZ RDS option; RPO 24 h (snapshots), RTO 4 h |
| Browsers | latest Chrome, Edge, Firefox, Safari; desktop ≥ 1280×720 (v1 parity) |
| Accessibility | WCAG 2.2 AA for forms, tables and navigation; charts have table alternatives |
| Observability | structured JSON logs (pino), OpenTelemetry traces, request IDs end to end |
| Cost | ≈ $430–520/month per production environment on x86 (≈ $375–465 on Graviton) before pipeline compute |

---

## 10. Security, privacy, compliance

- SSO via OIDC (Okta, Entra ID, Auth0, Keycloak…); no local passwords in production. BFF pattern: tokens
  never reach the browser; httpOnly, SameSite=strict session cookies; CSRF protection.
- Authorisation: CASL abilities from role bindings per program, enforced in the API and mirrored in the UI.
  Every data query is scoped by the caller's programs before compilation.
- Data stays in the customer's AWS account and chosen region. Encryption at rest with customer-managed
  KMS keys (S3, S3 Tables, RDS); TLS everywhere; CloudTrail S3 data events recommended.
- Audit: append-only table; exports to CSV; covers mutations, exports, admin changes, AI tool calls.
- Part 11-ready, not validated: discovery records are usually outside Part 11; data feeding GLP studies or
  submissions is in scope, so the controls exist (immutability, reason for change, re-auth on publish,
  retention) without a validation claim.
- Supply chain: pinned dependencies, lockfiles, SBOM in CI, dependency review, licence allowlist.
- Licences: no GPL/AGPL/BUSL/non-commercial code in the product (see ARCHITECTURE §9). Copyleft tools run
  only as separate pipeline containers; proprietary tools (DIA-NN, Spectronaut, MaxQuant) are never shipped —
  we ingest their outputs.

---

## 11. AI layer rules

1. **Off by default.** Admin enables a provider: Amazon Bedrock in the customer's account (recommended
   default — inference stays inside the customer's AWS boundary), the Anthropic API, or none. Feature flags
   per capability; monthly token budget per deployment.
2. **One tool registry** (zod input/output, risk class `read|compute|write`, required permission, row and
   token budgets). Exposed in-process to the assistant and via the MCP server. Tools execute with the
   **end user's identity**; the data layer, not the prompt, is the security boundary.
3. **No free-form SQL or code against customer data.** The model produces QuerySpecs and ChartSpecs; the
   platform validates and executes them. Deterministic analyses run in apps/compute.
4. **Writes need approval** (accept/reject UI; MCP write tools flagged as requiring user interaction).
5. **Ontology-constrained curation**: suggestions must come from OLS lookups; unknown → "no match", never invented.
6. **Provenance on everything** AI-produced: model, prompt version, tools called, QuerySpecs, releases used.
7. **Expect refusals.** General-availability frontier models can block some biology requests (e.g. target
   discovery or molecular design phrasing). The assistant's job is navigating and explaining the customer's
   own data; handle refusals gracefully and never depend on relaxed safeguards (Anthropic's Life Sciences
   Verification Program is first-party only, not on Bedrock, and not pass-through for platforms).
8. **Accuracy is not assumed**: agents score ~33–65% on realistic bioinformatics benchmarks and ~60% on
   biomedical text-to-SQL. Keep a golden-question evaluation set in CI; show the user what ran.
9. Audit every tool call; no customer data in logs beyond IDs; provider terms must exclude training on
   customer data.

---

## 12. Open questions (resolve before or during the phase that needs them)

1. Celeste conventions to inherit (UI kit, lint rules, folder style) — Phase 0.
2. First design-partner customer's IdP (Phase 3), compound-registry export format (Phase 8), AWS region —
   HealthOmics or Batch? (Phase 10).
3. Do we need XLSX manifest import in v2.0? — Phase 6.
4. Default embedding provider for search when AI is enabled (Titan v2 on Bedrock vs Voyage 4) — Phase 17.
5. AG Grid Enterprise licence for clipboard/Excel (cost vs "Paste TSV" dialog) — Phase 6.
6. Interactive limma re-analysis (not in the v2.0 plan): limma (GPL) and inmoose, its Python port
   (GPL-3.0-or-later), must run as a separate R/Python container (e.g. nf-core/differentialabundance), never
   as a library inside the product. Decide before building any re-analysis feature.
7. DuckDB 2.0 in-region performance on S3 Tables — benchmark locally in Phase 12, in-region in Phase 22;
   DuckLake as fallback.

**Settle before Phase 0 (legal and commercial, not technical):**
8. Does the earlier client contract permit a generalised rebuild? (Ask counsel.)
9. How does Anthropic treat a vendor whose customers hold their own Life Sciences Verification grants?
10. AG Grid Enterprise terms for embedding in a resold product (only if we decide to buy it).
11. India DPDP Act obligations when Kolkata staff access customer systems for support.
12. S3 Tables availability in the regions the first customers choose.
