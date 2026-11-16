# 0028 — Compound structures and structure search with RDKit in the API
Date: 2026-11-04 · Status: accepted
## Context
- **The need:** chemists see SMILES strings but no structures, and cannot find compounds by substructure or
  similarity next to the biology.
- **What others do:** ChEMBL, PubChem and CDD Vault offer structure search. We take the ideas only.
- **Constraints:**
  - no GPL dependencies;
  - nothing is repaired silently;
  - registry data is scoped by program;
  - the browser must not render untrusted markup.
## Decision
- **Library:** RDKit JS, `@rdkit/rdkit` 2025.3.4-1.0.0 (BSD-3-Clause, WASM), approved 2026-11-04. It runs only in
  apps/api.
  - The browser receives RDKit's SVG and shows it as an `<img>` data URI, which never runs scripts. The SPA ships no
    WASM.
  - Python RDKit in apps/compute was not chosen: the search is a registry lookup next to the compound data, not a
    statistic.
- **Structure:**
  - Each batch has its own structure. Batches are sorted in numeric-aware order, and batches that register different
    structures are flagged.
  - A compound ID is unique within a program only, so an ambiguous ID is a 422 asking for the program.
  - Descriptors cover the whole registered structure, and the component count flags salts. No standardisation is
    applied.
  - Lipinski counts (NH+OH, N+O) are reported apart from RDKit's SMARTS-based HBD/HBA. The labels name each
    definition: Crippen logP, TPSA from N and O.
- **Substructure search:**
  - The user chooses whether the query is SMARTS (atoms as written) or SMILES (read and aromatised as a molecule).
  - Every distinct registered structure is searched, and the first match is highlighted.
- **Similarity search:** Tanimoto on Morgan fingerprints (radius 2, 2048 bits), ranked above a threshold.
- **Stated in provenance:** both searches ignore stereochemistry.
- **Unreadable structures:** registered SMILES that RDKit cannot read, or that contain text after a space, are
  listed with program, compound and batch, never fixed.
- **Limits:** up to 50,000 compound batches per search (otherwise the user chooses a program). Fingerprints are
  cached in memory by SMILES.
## Consequences
- Search cost is linear in the number of compounds. Beyond about 50k, a substructure index (RDKit SubstructLibrary)
  or Postgres cartridge-free fingerprint columns would be the next step.
- Parent-structure standardisation (salt stripping, uncharging) is not done. If added, it will be a recorded,
  labelled transformation.
## Revisit when
Registries pass about 50k compounds, or chemists need parent structures or stereo-aware search.
