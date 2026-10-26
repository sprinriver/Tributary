# Reference v1 — what the earlier app did (clean-room feature inventory)

This file describes, in functional terms only, an experiment data application we built
earlier for a biotech client. It exists so v2 reaches feature parity and avoids v1's
known defects. It contains no client names, data, code, schemas, column names, identifier
formats, picklists, URLs, program names, people or data-estate sizes. Do not add any.
Example values below are generic.

---

## 1. Navigation and session

- Top bar: **Experiments** | **Data Explorer**; signed-in user's name and email; sign-out icon.
- Single sign-on (OIDC).

## 2. Experiments list page

**Filters (one row above the table)**
- Experiment type dropdown: Proteomics | Genomics (drives which records are listed).
- Free-text box "What are you looking for?" — searches every field flagged *searchable*
  (experiment name, scientific program, spectral library, any custom key marked searchable).
- Experiment date (typed or calendar picker).
- Experiment name dropdown.
- Search button.

**Table columns**
experiment id (UUID) · name · version number · URN (a stable identifier combining the version,
experiment and experiment-type UUIDs) · scientific program · spectral library (species) · time point ·
created at · results-available flag · latest flag · parent version · sub-version flag · pipeline log
link · job status · actions.

- Click a header to sort ascending/descending; pagination with rows-per-page.
- Row actions: **Trigger pipeline** (shown only when not yet triggered) and **Create version**.

## 3. Create experiment

Two panels, each with two tabs.

**Left panel — "Experiment" tab**
- Experiment type (Proteomics/Genomics), experiment date, experiment name.
- Spectral library (species): a short admin-managed picklist of model species.
- Time point (admin-managed picklist of treatment durations).
- Scientific program (picklist managed by admins).

**Left panel — "+Metadata" tab (experiment-level custom fields)**
- Key text box + "Is searchable" checkbox + add button → the key appears with a value input.
- Remove icon per key.

**Right panel — "Sample metadata" tab**
- Choose file: CSV or TSV sample manifest → rendered as an editable table.
- First row is an empty "new row" with save and cancel icons (add a sample).
- Every row has edit (cells become inputs, then save) and delete icons.

**Right panel — "+Metadata" tab (sample-level custom columns)**
- Key + "Is searchable" checkbox + add → shown as removable chips; the new column appears in
  the sample table so values can be entered per row.

**Footer**: Save · Reset · Back. Save returns to the list with the new experiment shown.

Typical manifest content (described, not the original column names): raw-file location in object
storage · sample identifiers · plate well · treatment (compound or vehicle) · dose · combined
treatment-and-dose label · replicate group.

## 4. Create a new version of an experiment

- From a row's Create version action: the same form opens pre-filled from the selected version
  (type and date locked; name, species library, time point, program, samples and custom keys editable).
- Save creates a new immutable version linked to its parent; the "latest" flag moves to it.

## 5. Pipeline trigger and status

- Per experiment version: Trigger submits the processing workflow (Nextflow on a batch backend).
- Job status shows RUNNING, then a terminal state; a link opens the run's log stream.
- A flag records when processed outputs (and charts) are available.

## 6. Data Explorer

Tabs: **Primary dataset** | **Join & Filter** | **Visualization**.

**Dataset picker** listed three kinds of table:
- processed outputs — dose-response, transformed intensities, differential abundance,
  protein-group matrices;
- metadata — experiments, experiment versions, experiment types, sample manifests,
  pipeline execution logs, file details;
- reference/chemistry — compound registry, compound properties (ADME), and target-annotation tables.

**Filter builder**
- Group operator AND / OR; "Add condition" adds `[column] [operator] [value]`.
- Operators: `=  !=  >  >=  <  <=  startswith`.
- Remove icon per condition; Apply.

**Tabular view**
- Total record count; sortable columns; pagination (25 rows per page default); CSV download of
  the current result.

**Join & Filter**
- "+ Add table" opens a list of joinable tables.
- Each join block: join type (inner / left / right) · join condition rows
  `[primary column] [= != > < startswith] [joined-table column]` · add/remove conditions ·
  its own filter section.
- Several join blocks side by side for multi-table joins; Apply; table; CSV download.
- Typical join: differential-abundance results joined to the compound registry on a compound key.

**Typical differential-abundance content (limma-style)**
protein · condition/dose · comparison · missingness class · log fold change with 95% confidence
interval · mean abundance · moderated t-statistic · p-value and adjusted p-value · B-statistic ·
observation count · compound · experiment name and date.

## 7. Visualization

**Controls**: chart title · chart type · required fields for that type · axis titles ·
Advanced options · Layout options (colour palette, gridlines X/Y, shared X/Y axes, shared legend,
subplot legend) · Apply → "Graphical view" panel.
Interactive toolbar: download PNG, zoom, pan, box select, lasso select, zoom in/out, autoscale,
reset axes.

**Chart types and required columns**

| Chart | Required | Optional columns |
|---|---|---|
| Line | X, Y (numeric) | colour, shape, opacity, hover, panel |
| Bar | X (categorical), Y (numeric) | colour, hover, panel |
| Scatter 2D | X (numeric or categorical), Y (numeric) | colour, shape, opacity, hover, panel |
| Scatter 3D | X, Y, Z (numeric) | colour, shape, opacity, hover, panel |
| Box / violin | X (categorical), Y (numeric) | colour, shape, opacity, hover, panel |
| Histogram / KDE | X (numeric) | colour, panel |
| Lollipop | row label (categorical), stem length (numeric) | colour, size, hover, panel |
| Volcano | X (numeric, e.g. log FC), Y (numeric, e.g. p) | colour, opacity, hover, panel |
| Bubble | X, Y, size (numeric) | colour, hover, panel |
| Heatmap | numeric columns, row label | hover |
| Dendrogram | row label (categorical), clustering columns (numeric) | hover |
| Pie / donut | categories (categorical), values (numeric) | colour, hover, panel |

**Transformations and options**

| Chart | Options |
|---|---|
| Line | point label, pseudolog X/Y, smoothing, standardization |
| Bar | orientation, point label, pseudolog X/Y, standardization, p-value calculation, error bars |
| Scatter 2D | point label, pseudolog X/Y, standardization |
| Scatter 3D | pseudolog X/Y/Z, standardization |
| Box / violin | box / violin / both, orientation, point label, p-value calculation |
| Histogram | histogram / KDE / both, stats calculation, p-value calculation |
| Lollipop | orientation, pseudolog X/Y, standardization |
| Volcano | point label, pseudolog X/Y, standardization |
| Bubble | pseudolog X/Y, min/max bubble size, standardization |
| Heatmap | min/max value scaling, standardization, centred colormap, optional dendrograms |
| Dendrogram | interpolation, leaf ordering, orientation, row/column/both, standardization, attach heatmap, clustering method (average, single, complete, weighted, centroid, median, ward.D2), distance (euclidean, manhattan, maximum, canberra, cosine, correlation), colour scheme (single, gradient, cluster), colour threshold, bootstrap analysis with N iterations |
| Pie / donut | pseudolog, text info/position/orientation, start angle, direction, donut, exploded view, sorting, expanded pie |

## 8. Known v1 defects → v2 design rules

| v1 symptom | Root cause | v2 rule |
|---|---|---|
| Histogram failed with "dataset should have multiple elements" after filtering | no minimum-row check | validate row counts per group before plotting; explain in UI |
| Histogram failed with "vertical spacing" error (100 panels) | panel column with too many distinct values | cap facet cardinality (e.g. ≤ 24) and show the count before plotting |
| p-value calculation failed when no group column chosen | missing dependent-field validation | schema-level "requires" rules per option |
| "x_col / y_col is required" errors | form allowed Apply with empty required fields | disable Apply until the chart schema validates |
| Lollipop failed with "can only concatenate str to int" | non-numeric column accepted as size | type-aware column pickers (only numeric columns offered for numeric slots) |
| Lollipop "NULL values in dataframe" | nulls in required columns | null policy per chart (drop with count shown, or block) |
| Pseudolog errors / blank pie charts | free-text numeric input, range 2–10 not enforced | typed numeric inputs with min/max; server re-validates |
| Bubble pseudolog always failed | transformation not implemented for that chart | only render options a chart actually supports (single source of truth per chart) |
| Heatmap + dendrogram failed unless both row and column clustering | unhandled branch | test every option combination in the chart schema |
| Lollipop "Query" option had no effect | dead option | no option ships without a test proving it changes the output |

General rule: **every chart type is defined by one schema** (required fields with types, optional
fields, options with types, ranges and dependencies). The UI form, the server validation and the
tests are all generated from it.

## 9. v1 architecture (for reference only)

React frontend · Python FastAPI microservices (auth, admin, metadata-access, data-access) ·
RabbitMQ · S3 · Postgres (app data and lakeFS metadata) · OpenSearch (metadata, manifests,
semantic search) · Neptune (file lineage) · Redshift (gold-layer warehouse) · Glue crawler and
catalog · Lambda crons · lakeFS (data versioning) · data contracts (ingest validation) ·
Kubernetes (EKS) · Terraform · CloudWatch · single-vendor OIDC SSO.

## 10. Original programme scope (beyond the app)

- A versioned database/warehouse for NGS (FASTQ, BAM, VCF, CNV), proteomics (TSV matrices,
  dose-response TSV, differential-abundance CSV) and other tabular data — with rollback,
  auditable history and dev/stage/prod environments.
- Aggregation from an existing relational database (with periodic public-data refresh), object
  storage, pipeline outputs, analysts' ad-hoc results, another cloud and on-prem disks — hundreds of TB
  in total.
- Automated ingest: upload → data-type detection → QC → processing workflow → monitoring
  dashboard → warehouse.
- Data lifecycle management policies.
