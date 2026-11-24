# 0029 — Protein 3D models served by the API, viewed with Mol*
Date: 2026-11-04 · Status: accepted
## Context
- **The need:** scientists want to see where a hit sits in a protein and how confident the model is. Today they open
  AlphaFold DB or UniProt in another tab.
- **Constraints:**
  - The platform runs in customers' accounts, often with restricted egress and a strict CSP.
  - Predicted models must never pass for experimental structures.
  - No GPL viewers.
## Decision
- **Viewer:** Mol* (`molstar` 5.11.0, MIT, approved 2026-11-04) in apps/web. It is loaded with a dynamic import
  only when "Show 3D model" is pressed: a separate chunk of about 1.4 MB gzipped.
- **Model files:** the API serves them, and the browser only talks to its own origin.
  - **Lookup order:** first `PROTEIN_MODELS_DIR/<accession>.cif` (in-house models, a mirror, or the synthetic demo
    models in development).
  - **Then AlphaFold DB** (`ALPHAFOLD_URL`, which can be set to empty to turn it off). It uses the prediction API's
    `cifUrl`, the same field Mol*'s own AlphaFold loader reads.
  - **Safety:**
    - Only UniProt-format accessions are sent out.
    - A file URL on another host, or any redirect, is refused.
    - Files are capped at 50 MB and cached in memory (32 files).
- **Labelling:**
  - AlphaFold DB and ModelCIF files with quality metrics are labelled "predicted".
  - pLDDT colouring uses Mol*'s ModelCIF quality-assessment preset, with a key for AlphaFold DB's four bands.
  - The source, entry ID and licence (AlphaFold DB: CC BY 4.0) are shown next to the viewer.
## Consequences
- Installs without internet access still show in-house or mirrored models. Without them the page says that no model
  is available.
- The PAE (predicted aligned error) and experimental PDB structures are not shown yet.
- Hits are not yet mapped onto residues.
## Revisit when
Scientists need peptide or site mapping on the structure, PDB structures, or PAE.
