"""Simulated RNA-seq and CRISPR-screen outputs."""

from pathlib import Path

import numpy as np

from tributary_compute.synth.io import write_tsv
from tributary_compute.synth.manifests import Sample
from tributary_compute.synth.stats import benjamini_hochberg


def rnaseq_counts(
    path_dir: Path, genes: list[str], samples: list[Sample], rng: np.random.Generator
) -> list[str]:
    """nf-core/rnaseq-like `salmon.merged.gene_counts.tsv`: gene_id, gene_name, one column per sample
    (nf-core/rnaseq 3.x output docs). Counts are negative-binomial (dispersion 0.1). gene_id values are
    synthetic (`SYNG*`), not Ensembl IDs."""
    n = len(genes)
    mean = 2.0 ** rng.normal(8.0, 2.0, n)
    fold = np.where(rng.random(n) < 0.1, 2.0 ** rng.uniform(-2.5, 2.5, n), 1.0)
    dispersion = 0.1
    header = ["gene_id", "gene_name", *(s.key for s in samples)]
    rows: list[list[str | int]] = []
    for i, gene in enumerate(genes):
        counts: list[int] = []
        for s in samples:
            mu = mean[i] * (fold[i] if s.dose_molar is not None else 1.0)
            size = 1.0 / dispersion
            counts.append(int(rng.negative_binomial(size, size / (size + mu))))
        rows.append([f"SYNG{i + 1:06d}", gene, *counts])
    write_tsv(path_dir / "salmon.merged.gene_counts.tsv", header, rows)
    return ["salmon.merged.gene_counts.tsv"]


def mageck_gene_summary(path_dir: Path, genes: list[str], rng: np.random.Generator) -> list[str]:
    """MAGeCK-like `gene_summary.txt` (MAGeCK 0.5.9 test output columns: id, num, neg|score, neg|p-value,
    neg|fdr, neg|rank, neg|goodsgrna, neg|lfc, then the same for pos). Four guides per gene; ~8% of genes are
    depleted (essential-like), ~3% enriched. Sorted by neg|rank, as MAGeCK writes it."""
    n = len(genes)
    depleted = rng.random(n) < 0.08
    enriched = ~depleted & (rng.random(n) < 0.03)
    lfc = np.where(
        depleted,
        rng.uniform(-3.0, -1.0, n),
        np.where(enriched, rng.uniform(1.0, 2.5, n), rng.normal(0, 0.2, n)),
    )
    neg_p = np.where(depleted, 10.0 ** -rng.uniform(3, 7, n), rng.uniform(0.05, 1.0, n))
    pos_p = np.where(enriched, 10.0 ** -rng.uniform(2, 5, n), rng.uniform(0.05, 1.0, n))
    neg_fdr, pos_fdr = benjamini_hochberg(neg_p), benjamini_hochberg(pos_p)
    # RRA scores are not simulated; the p-value is used as the score so ranks stay consistent.
    neg_rank = np.empty(n, dtype=int)
    neg_rank[np.argsort(neg_p, kind="stable")] = np.arange(1, n + 1)
    pos_rank = np.empty(n, dtype=int)
    pos_rank[np.argsort(pos_p, kind="stable")] = np.arange(1, n + 1)
    good_neg = np.where(depleted, rng.integers(3, 5, n), rng.integers(0, 3, n))
    good_pos = np.where(enriched, rng.integers(3, 5, n), rng.integers(0, 3, n))
    header = [
        "id",
        "num",
        "neg|score",
        "neg|p-value",
        "neg|fdr",
        "neg|rank",
        "neg|goodsgrna",
        "neg|lfc",
        "pos|score",
        "pos|p-value",
        "pos|fdr",
        "pos|rank",
        "pos|goodsgrna",
        "pos|lfc",
    ]
    rows = [
        [
            genes[i],
            4,
            float(neg_p[i]),
            float(neg_p[i]),
            float(neg_fdr[i]),
            int(neg_rank[i]),
            int(good_neg[i]),
            float(lfc[i]),
            float(pos_p[i]),
            float(pos_p[i]),
            float(pos_fdr[i]),
            int(pos_rank[i]),
            int(good_pos[i]),
            float(lfc[i]),
        ]
        for i in np.argsort(neg_rank, kind="stable")
    ]
    write_tsv(path_dir / "gene_summary.txt", header, rows)
    return ["gene_summary.txt"]
