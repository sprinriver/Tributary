"""Demo gene-set collection (GMT) for pathway enrichment (Phase 24): invented modules, not real pathways."""

from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import Protein

N_MODULES = 20


def write_gene_sets(out: Path, proteins: list[Protein], rng: np.random.Generator) -> list[str]:
    """Random modules of 12-30 genes from the corpus: an ORA demo, with no biological meaning."""
    genes = sorted({g for p in proteins for g in p.genes})
    lines: list[str] = []
    for i in range(1, N_MODULES + 1):
        size = int(rng.integers(12, 31))
        members = sorted(str(g) for g in rng.choice(genes, size=size, replace=False))
        lines.append("\t".join([f"DEMO:M{i:02d}", f"Synthetic module {i} (demo)", *members]))
    out.mkdir(parents=True, exist_ok=True)
    (out / "gene_sets.gmt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ["reference/gene_sets.gmt"]
