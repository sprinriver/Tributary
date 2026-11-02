# Tributary user guide

For scientists and analysts. Tributary keeps each experiment's design, samples, files, pipeline runs and results
together, so you can find, query, chart and compare data across experiments.

Screenshots come from the end-to-end tests on synthetic demo data (`artifacts/`).

- [Sign in](#sign-in)
- [Find things](#find-things)
- [Register an experiment](#register-an-experiment)
- [Samples (the manifest)](#samples-the-manifest)
- [Publish a version](#publish-a-version)
- [Upload files](#upload-files)
- [Run a pipeline](#run-a-pipeline)
- [Import results into a dataset](#import-results-into-a-dataset)
- [Explore data](#explore-data)
- [Charts](#charts)
- [Results pages](#results-pages)
- [Lineage and audit](#lineage-and-audit)
- [The assistant](#the-assistant)
- [Python, R and other tools](#python-r-and-other-tools)
- [Roles](#roles)
- [Glossary](#glossary)

## Sign in
1. **Open the app:** use your organisation's address. On a public demo, the banner shows the demo logins.
2. **Sign in:** choose **Sign in**, then sign in with your organisation's identity provider.
3. **Your roles:** your groups there decide what you can see and do in each program (see [Roles](#roles)).

The left sidebar has **Experiments**, **Datasets**, **Explore**, **Saved views**, **Compare** and **Search**. Use
the moon button for dark mode.

![Home](../artifacts/ui-refresh/home.png)

## Find things
- **Quick search:** press **⌘K** (Ctrl+K on Windows and Linux) anywhere. Type an experiment name, cell line,
  compound, protein or gene, and press Enter to open the hit.
- **Search page:** **Search** lists every hit, with facets (type, program, assay, organism). The facets you choose
  are kept in the address, so you can share the link.

![Search](../artifacts/phase-17/search-page.png)

## Register an experiment
1. **Start:** in **Experiments**, choose **New experiment**.
2. **Details:** pick the program and assay type, give the experiment a name and description, and fill in the
   custom fields your program's template asks for. Required fields are marked; **Next** waits until they are valid.
3. **Create:** the new experiment opens as **version 1, draft**.

![New experiment](../artifacts/phase-5/wizard-details.png)

The experiment page has these tabs:
- **Samples**
- **Contrasts**
- **Files**
- **Runs**
- **Versions**
- **Results** (once data exists)

## Samples (the manifest)
The **Samples** tab is a spreadsheet of one row per sample.
- **Typing:** type into cells. Dose and time take a number and a unit (`10 µM`, `24 h`). Tributary stores them in
  SI units and shows them as you typed them.
- **Pasting:** **Paste TSV block** maps the columns of a block copied from Excel or a plate reader file to manifest
  columns. Save the mapping as a preset for the next time.
- **Errors:** every error shows on its cell (an unknown species, a dose without a unit, a duplicate sample key, a
  bad well). **Only rows with problems** filters to them.
- **Plate layout:** colours wells by any factor. Click a well to select its sample.
- **Contrasts:** say which groups to compare. A contrast reads "numerator vs denominator", and log2 fold change
  = log2(numerator / denominator).
- **SDRF:** export and import the manifest in the proteomics SDRF format (validated on the way in and out).
- **Ontology suggestions:** when your admin has switched them on, suggested terms appear for organism, cell line,
  tissue and disease. Only the ones you accept are applied.

![Manifest problems](../artifacts/phase-6/problems.png)
![Plate layout](../artifacts/phase-6/plate.png)

## Publish a version
- **Publishing:** **Publish version** freezes the version: its details, samples and contrasts can never change.
  Every publish asks for a **Reason**. If you signed in a while ago, you are asked to confirm your identity first.
- **Changing it later:** **Versions → New version** copies the published version into a new draft. The
  **Versions** tab shows exactly what changed between any two versions.

![Publish](../artifacts/phase-5/publish-dialog.png)
![Diff](../artifacts/phase-5/diff.png)

## Upload files
1. **Choose files:** in **Files**, use **Choose files** and give each one a role (raw, processed, …). Then choose
   **Upload**. Large files go straight to storage in parts; an interrupted upload can resume.
2. **QC:** each file is checked when it arrives: checksum, format, and compression integrity. Its status changes from
   uploading → QC passed, or **QC failed** with the reason.
3. **Override:** an approver can **Override QC** with a reason; the override is recorded.

![Files](../artifacts/phase-7/files-qc-failed.png)

## Run a pipeline
1. **Launch:** from the experiment, choose **Launch pipeline**, pick the pipeline and its revision, and fill in the
   parameter form. The form comes from the pipeline's own schema, so invalid values are caught before launch.
2. **The QC gate:** launch stays disabled, with the reason shown, while an input file has failed QC.
3. **Watch the run:** the run page updates by itself. It shows status, a timeline, recent log lines and outputs.
   You can **Cancel run**, or re-run with edited parameters.
4. **Notifications:** finished runs appear under **Runs** in the top bar.

![Launch](../artifacts/phase-11/launch-dialog.png)
![Run page](../artifacts/phase-11/run-page.png)

## Import results into a dataset
Results become **datasets** with numbered, immutable **releases**.
1. **Import:** in **Files**, on a processed file, choose **Import…** and pick the importer for the tool that made
   it. Importers cover DIA-NN, MaxQuant, FragPipe, Spectronaut, limma-style tables, CurveCurator and more.
2. **Check:** the new release is **staged**. Check the column statistics, the quality rules and the first rows.
3. **Publish:** **Publish release** with a reason. Only published releases count as the latest data.

Nothing is imputed, filtered or normalised silently. Every transformation is listed on the release.

![Catalog](../artifacts/phase-8/catalog.png)

## Explore data
**Explore** queries any dataset kind, across experiments, without writing SQL.
1. **Choose data:** pick a **Dataset kind** and a **Release**, or all releases in your programs. Tick **Latest
   published versions only** for current data.
2. **Filter:** add **+ Rule** and **+ Group** in **Filters**. For example, `adj_p_value < 0.05` AND
   `gene_names contains EGFR`.
3. **Join:** **Add join** brings in sample metadata or reference tables (annotations, compounds).
4. **Run:** **Run query**, then sort by clicking a column, page with **Previous page** and **Next page**, and pick
   columns with **Columns**.
5. **Use the result:**
   - **Export:** CSV, TSV or Parquet (recorded in the audit log).
   - **Save view:** saves the query for yourself or your program. The address always holds the query, so you can
     share it.
   - **Copy as code:** Python, R, or the QuerySpec JSON.

![Explorer](../artifacts/phase-13/page-3.png)
![Join](../artifacts/phase-13/join.png)

## Charts
Below the results, the **Chart** panel plots the current query.
1. **Chart type:** volcano, MA, heatmap (with clustering and dendrograms), PCA, dose-response, QC panel, line, bar,
   scatter 2D/3D, box/violin, histogram/KDE, lollipop, bubble or pie/donut.
2. **Map columns** to X, Y, colour, label and so on. Only suitable columns are offered.
3. **Options:** thresholds, labels, clustering method, palette (including a colour-blind palette). Errors appear
   next to the option, and **Apply** waits until the chart is valid.
4. **Look closer:**
   - Hover for values.
   - In a volcano, lasso points to list them under **Selected points**.
   - Every chart has a **Chart data** table.
   - **Provenance** says which releases, which query, which transformations and which compute versions made it.
   - Export the chart as PNG or SVG.

![Volcano](../artifacts/phase-14/volcano.png)
![Heatmap](../artifacts/phase-14/heatmap-clustered.png)

## Results pages
- **Experiment → Results:** QC, a volcano per contrast, top hits, the dose-response viewer (fitted curves as small
  multiples, filtered by regulation and FDR), the files, and a methods paragraph you can paste into a report.
- **Protein pages** (`/proteins/<accession>`): annotations and every experiment and contrast the protein was
  measured in.
- **Compound pages** (`/compounds/<id>`): contrasts, ADME rows, targets, and a known-target overlay on its volcano.
- **Compare:** two contrasts side by side, with a log2 fold-change scatter, an overlap table and intersection bars.

![Results](../artifacts/phase-16/results-page.png)
![Compare](../artifacts/phase-16/compare.png)

## Lineage and audit
- **Lineage:** shows where a release or chart came from: raw file → pipeline run (with its revision) → release →
  saved chart.
- **Release history:** shows each publish, with its reason and approver.

![Lineage](../artifacts/phase-18/lineage.png)

## The assistant
The **Assistant** button opens a side panel, when your organisation has switched it on. Ask in plain language,
for example "Find experiments with HEK293" or "Show the significant hits of contrast X".
- **Visible tool calls:** the assistant answers through the same tools and permissions as you, and shows each
  call it made.
- **Open in Explorer:** a data question becomes a validated query you can open there.
- **Changes need approval:** the assistant never changes data by itself. A proposed change waits for you to
  **Approve**, then runs as you and is audited.

![Assistant](../artifacts/phase-19/assistant-query.png)

## Python, R and other tools
- **Personal access tokens:** while signed in, create one with `POST /api/v1/auth/tokens` (name, scopes `read` or
  `read` + `write`, and an expiry). Each token is shown once; send it as `Authorization: Bearer trb_…`. There is no
  token page in the web app yet. Locally, `pnpm dev:token` prints one.
- **Python SDK and MCP:** the Python SDK and the MCP endpoint (for AI tools such as Claude Desktop) use the same
  API and permissions. See the README.
- **Copy as code:** in Explore, gives a ready-made snippet.

## Roles
Roles are given per program:

| Role | Can |
|---|---|
| Viewer | Read experiments, datasets, charts and results |
| Contributor | Also create and edit drafts, upload files, launch pipelines, import, save views |
| Approver | Also publish versions and releases, and override QC |
| Admin | Also manage the program's members and settings |
| System admin | Everything, across all programs: templates, pipelines, lists, access, health, audit |

## Glossary
| Term | Meaning |
|---|---|
| Version | A snapshot of an experiment's design and samples; published versions never change |
| Contrast | A comparison "numerator vs denominator" |
| Dataset / release | Tabular results of one kind; each release is immutable and numbered |
| Staged | A release waiting for review before publishing |
| QuerySpec | The structured query the Explorer builds (no SQL) |
| Provenance | What a chart or release was made from, and how |
