# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]
- Fuller experiment reports (REP-04…07): the report and its PowerPoint now include:
  - QC;
  - pathway enrichment for every contrast, added on demand with the report's display thresholds and full
    provenance;
  - dose-response counts per class, the curves figure and the top curves.
- Validation pack (VAL-01…02): `docs/validation/` gives a traceability matrix from every requirement to its tests
  and status, regenerated and checked by `pnpm check`. It also has IQ and OQ protocol templates and a 21 CFR Part 11
  controls map that customers adapt for their own validation.
- Support bundle (SUP-01…02): Admin → Health → Download support bundle gives versions, migrations, health,
  configuration switches and the last week's failures, with no secrets or personal data. The download is audited.
- Usage analytics (USE-01…03): Admin → Usage shows active people, weekly activity, programs and people, with a CSV
  download. It is counted from the audit log, with nothing tracked or sent elsewhere.
- SCIM 2.0 provisioning (SCIM-01…04):
  - Okta, Entra ID and other IdPs create, update and deactivate users and groups.
  - Deactivation ends access at once.
  - Admin → Access shows the endpoint and token.
- Personal email (MAIL-01…03):
  - Emails for new hits on watched items, triage items assigned to you, and your finished pipeline runs.
  - Choose them under your name → Email notifications.
  - Sent through Amazon SES or SMTP.
- Experiment reports (REP-01…03):
  - A report page per version, with methods, hit counts, volcano and top hits per contrast.
  - Print to PDF or download as PowerPoint. Every export is audited.
- Excel sample sheets (XLS-01…02):
  - Upload `.xlsx` manifests. Numbers are kept as stored, dates are flagged, and duplicate or unnamed columns are
    reported.
  - Download a manifest as `.xlsx`.
- Team notifications (NOTIF-01…04): post finished runs, published versions and releases, and triage decisions to
  Slack or Microsoft Teams channels, with retries and a delivery history (Admin → Notifications).
- Gene–concept network (NET-01…02):
  - Enrichment results show the top gene sets and their hit genes as a network coloured by log2 FC, with a table.
  - Genes that are hits in several features are marked, never given one picked value.
- Fix: error messages meet AA colour contrast.
- 3D protein models (STRUC-01…03):
  - A Mol* viewer on protein pages, coloured by pLDDT, with the model's source and licence.
  - Models come from a local directory or AlphaFold DB, served by the API (`PROTEIN_MODELS_DIR`, `ALPHAFOLD_URL`).
- Fix: `licence:scan` now checks every workspace package's dependencies.
- Compound structures and structure search (CHEM-01…04):
  - Structures and descriptors (RDKit) on compound pages: Lipinski counts, Crippen logP, TPSA, salts and
    differing batches flagged.
  - Substructure search (SMARTS or SMILES) and similarity search (Morgan, Tanimoto) on a new Structures page.
- Fix: pages that send a request on load no longer fail with a CSRF error on a fresh load.
- Cross-experiment QC (QCD-01…03):
  - A QC page with identifications per run across experiments and runs flagged for low IDs.
  - A PCA of runs coloured by experiment, plate, condition or date, to spot batch effects.
  - A table of runs, with every counting rule listed.
- Watchlists and alerts (WAT-01…03):
  - Watch a protein, gene or compound.
  - When a release you can read is published with a hit for it (adjusted p ≤ 0.05 and |log2 FC| ≥ 1), you get an
    alert in the Alerts menu.
- Hit triage board (TRI-01…04):
  - Proteins and compounds per program are marked advance, watch or drop. A status change needs a reason.
  - Owners, comments and evidence snapshots from releases.
  - An append-only history with audit rows.
  - "Add to triage" on protein and compound pages.
- Pathway enrichment (ENR-01…04):
  - Over-representation analysis of a contrast's hits against GO, Reactome or in-house gene sets (imported from
    GMT), with a dot plot and table on the results page.
  - The provenance records the universe, thresholds, protein-group handling and the source release of the gene
    sets.
- Bulk onboarding of legacy data (ING-06):
  - Path patterns turn a folder layout into experiments, inferred sample manifests and file roles.
  - Resumable batch runs, with imports that wait for QC.
  - A migration report with counts, failures and checksums.

## [2.0.0] — 2026-11
The first release of the rebuilt platform ("v2"). It covers the v1 scope (`docs/REFERENCE_V1.md`) and adds
pipelines, a query engine, charts, search, lineage, an assistant and AWS infrastructure.

### Registry and samples
- **Experiments** with program templates and custom fields. Versions are immutable once published (enforced by a
  database trigger). Publishing needs a reason and a recent sign-in. Version diffs.
- **Sample manifest editor:**
  - Quantities are parsed and normalised to SI units.
  - Errors are reported per cell.
  - Paste TSV block with saved column mappings.
  - Plate layout.
  - Contrasts editor.
  - SDRF import and export, validated.
  - Ontology suggestions (OLS4) applied only when accepted.

### Files, pipelines and datasets
- **Uploads:** resumable multipart uploads straight to object storage, checked on arrival (checksum, format,
  compression). QC overrides are recorded.
- **Pipelines:** Nextflow pipelines with launch forms generated from nf-schema, and a QC gate.
- **Runners:** local, AWS Batch and AWS HealthOmics. Run pages update live, with logs, outputs, cancel and re-run.
- **Datasets** with immutable numbered releases, staged then published. Each release records its statistics, quality
  rules and transformations.
- **Importers:** DIA-NN, MaxQuant, FragPipe, Spectronaut, limma-style tables, CurveCurator and more. Every importer
  states its source and its missing-value meanings.

### Query and analysis
- **Query engine:** QuerySpec → parameterised DuckDB SQL over Parquet/Iceberg. No SQL is accepted from browsers or
  the AI. Queries are scoped to the caller's programs.
- **Data Explorer:**
  - Filters, joins to metadata and reference tables, sorting and paging.
  - Exports (audited).
  - Saved views, and copy as Python, R or JSON.
- **Charts** through a chart registry with field-level validation and provenance:
  - volcano, MA, heatmap with clustering and dendrograms, PCA, dose-response, QC panel
  - line, bar, scatter 2D/3D, box/violin, histogram/KDE, lollipop, bubble, pie/donut

  Statistics are computed in the compute service.
- **Results pages:** per experiment, protein, compound, and contrast comparisons.

### Search, trust and administration
- **Search:** full-text and semantic, with a ⌘K palette.
- **Lineage:** raw file → run → release → chart.
- **Audit log:** an append-only table covering mutations, exports, admin changes and AI tool calls, with filters
  and CSV export.
- **Admin pages:** programs, templates (versioned), picklists, ontology sources, group-to-role mapping, storage
  lifecycle, health, pipelines.
- **AI assistant** (off by default): it answers through tools under the user's permissions, and its writes wait for
  approval.
- **MCP server and Python SDK:** personal access tokens or IdP tokens. Signed webhooks.

### Operations
- **Deployment options:**
  - Terraform for the customer's AWS account: plan in CI, apply by people (`docs/DEPLOY.md`, ADR 0026).
  - A free public demo on Hugging Face Spaces.
  - A Render Blueprint.
- **Logs:** request ids and W3C trace context are logged from the API through the query and compute services.
- **Runbook:** backups, a restore rehearsal and alarms (`docs/RUNBOOK.md`).
- **Load test:** `pnpm run load:test`, plus `pnpm bench:query` for engine scaling.
- **Accessibility:** a pass over every page (axe, WCAG 2.2 AA).
- **Licence scan** against an allowlist, and an SBOM in CI.
- **Guides:** `docs/USER_GUIDE.md`, `docs/ADMIN_GUIDE.md` and `docs/DEMO.md`.

### Known gaps
- **No real AWS plan yet:** `terraform plan` has not run against a real account (no sandbox profile was
  provided). CloudWatch alarms are documented but are not in Terraform.
- **Traces without a collector:** traces are propagated and logged; exporting them to an OpenTelemetry collector
  needs the OTel SDK (new dependencies, pending approval).
- **MCP SDK advisories:** `@modelcontextprotocol/sdk` 1.30.0 has advisories that are fixed in 1.32.0. The upgrade
  is pending approval, because that release is under the 90-day minimum age. Exposure is limited: request bodies
  are parsed and size-limited by Fastify, and the SDK's OAuth client and bearer-auth helpers are not used.
