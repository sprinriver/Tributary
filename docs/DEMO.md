# Demo script (about 20 minutes)

A walkthrough for showing Tributary to a drug-discovery team. Everything uses the **synthetic demo corpus**
(`pnpm synth`, loaded by `pnpm db:seed`), so no real data is involved:
- programs ONC and IMM
- DIA, TMT, RNA-seq and CRISPR experiments such as ONC-DIA-01 and IMM-DIA-04
- compounds CPD-…, ADME rows and target annotations

## Before the demo
- **Stack:** run it locally (`docker compose up -d`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`) or use the
  public demo Space ([`DEPLOY_HUGGINGFACE.md`](DEPLOY_HUGGINGFACE.md)).
- **Sign-ins:** have **two browser profiles** ready, `scientist` (contributor) and `admin`. Locally the password
  equals the user name.
- **Assistant (optional):** set `AI_PROVIDER` (or `stub` for scripted answers) to show it.
- **Files:** keep `fixtures/experiments/ONC-DIA-01/report.pg_matrix.tsv` (a DIA-NN matrix) and its manifest
  `samples.tsv` at hand.

## 1. Find (2 min)
1. Press **⌘K** and type `HEK293`, then open **IMM-DIA-04**.
   - **Say:** everything about an experiment is in one place: design, samples, files, runs, results.
2. Open **Search** with `kinase`, then narrow it with a facet.
   - **Say:** the address keeps the facets, so the link can be shared.

## 2. Register and describe an experiment (5 min)
1. **Create:** **Experiments → New experiment**, program ONC, assay DIA proteomics.
   - **Say:** required custom fields come from the program's template.
2. **Paste samples:** on the **Samples** tab, **Paste TSV block**: paste `samples.tsv`, map the columns,
   apply.
3. **Fix errors:** the cells with errors light up (a dose without a unit, an unknown species). Fix two inline, then
   use **Only rows with problems**.
4. **Plate layout:** colour by compound and click a well.
5. **Contrasts:** add `CPD-000005 10 µM vs DMSO`.
   - **Say:** log2 fold change is always numerator over denominator.
6. **Publish:** **Publish version** with a reason.
   - **Say:** this version is now immutable. A change means version 2, and the diff shows exactly what changed.

## 3. Data in (4 min)
1. **Upload:** on the **Files** tab, upload the DIA-NN matrix as *processed*. QC runs on arrival.
2. **Import:** **Import…** with the DIA-NN importer gives a **staged** release. Show the column statistics, the
   quality rules and the first rows.
   - **Say:** nothing is imputed, filtered or normalised silently.
3. **Publish release** with a reason.
4. **Optional, pipelines:** open **Launch pipeline** and show the form generated from the pipeline schema and the
   QC gate.
   - **Say:** on AWS this runs on Batch or HealthOmics; the run page updates live.

## 4. Explore and chart (5 min)
1. **Query:** in **Explore**, set Dataset kind *differential abundance* and *latest published versions only*. Filter
   `adj_p_value < 0.05`, sort by `log2_fc`, then **Run query**.
   - **Say:** this queries every experiment the user may see, without SQL.
2. **Join:** **Add join** to target annotations.
   - **Say:** the protein groups are split so a multi-protein group matches each of its proteins.
3. **Volcano:** in **Chart**, choose volcano with thresholds 1 / 0.05 and label the top 10. Lasso a cluster to see
   **Selected points**.
4. **Heatmap:** switch to a heatmap with row and column clustering and show the dendrograms.
5. **Provenance:** open it and point at the releases, the query hash, the transformations and the compute versions.
6. **Share:** **Save view** and **Copy as code** (Python).

## 5. Results and comparison (2 min)
1. **Results page:** **ONC-DIA-01 → Results** shows QC, a volcano per contrast, top hits, the dose-response
   viewer and the methods paragraph.
2. **Protein and compound pages:** `/proteins/P31749`, then `/compounds/CPD-000005`, which has the known-target
   overlay.
3. **Compare:** two contrasts side by side.

## 6. Trust (2 min)
1. **Lineage** of a release: raw file → run → release → chart.
2. **As admin:**
   - **Audit:** filter by the publish you made, then export it as CSV.
   - **Health:** every dependency is green.
   - **Templates:** the template editor's live preview.

## 7. Assistant (optional, 2 min)
1. Ask "Find experiments with HEK293", then "Show significant hits of the first contrast of IMM-DIA-04".
2. Open the built query in the Explorer.
3. Ask it to fix a sample's organism.
   - **Say:** the change waits for **Approve**, then runs as the user and is audited.

## Questions people ask
| Question | Answer |
|---|---|
| Where does the data live? | In the customer's own AWS account and region (S3, S3 Tables, RDS), encrypted with the customer's KMS key |
| Can we bring our pipelines? | Yes: any Nextflow pipeline with an nf-schema (for example bigbio/quantms and bigbio/quantmsdiann), registered under Admin → Pipelines |
| Validated (GxP)? | Part 11-ready controls (immutability, reasons, re-auth, audit), not validated |
| Old data? | Bulk onboarding of legacy folders and databases (Phase 23) |
