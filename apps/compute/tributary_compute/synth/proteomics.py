"""Simulated proteomics outputs in the formats of the tools named below (columns from docs/source)."""

import math
from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import Protein
from tributary_compute.synth.io import write_tsv
from tributary_compute.synth.manifests import Sample
from tributary_compute.synth.stats import benjamini_hochberg, four_pl_ratio, two_sided_normal_p

RAW_DIR = "/data/raw"


def _group(p: Protein) -> tuple[str, str, str]:
    return ";".join(p.accessions), ";".join(p.names), ";".join(p.genes)


def _abundance(rng: np.random.Generator, n: int) -> np.ndarray:
    return rng.normal(22.0, 2.0, n)  # log2 linear intensity scale


def write_pg_matrix(
    path: Path,
    proteins: list[Protein],
    samples: list[Sample],
    log2: np.ndarray,
    rng: np.random.Generator,
    experiment_key: str,
) -> None:
    """DIA-NN-like `report.pg_matrix.tsv`: Protein.Group, Protein.Names, Genes,
    First.Protein.Description, then one column per run named by its raw-file path. Linear intensities;
    missing values are empty cells, as DIA-NN omits zero quantities from matrices (DIA-NN README, 2.x).
    Header assumed from DIA-NN 1.8-2.x output; verify in the Phase 8 importer's SOURCE.md.
    Missingness is intensity-dependent (MNAR), below a noisy detection limit."""
    runs = [f"{RAW_DIR}/{experiment_key}/{s.cells['instrument_run']}.raw" for s in samples]
    header = ["Protein.Group", "Protein.Names", "Genes", "First.Protein.Description", *runs]
    rows: list[list[str | float | None]] = []
    for i, protein in enumerate(proteins):
        values: list[str | float | None] = []
        for j in range(len(samples)):
            limit = rng.normal(18.0, 0.5)
            values.append(None if log2[i, j] < limit else round(2.0 ** log2[i, j], 1))
        rows.append([*_group(protein), protein.description, *values])
    write_tsv(path, header, rows, digits=12)


def dose_series(
    path_dir: Path,
    proteins: list[Protein],
    samples: list[Sample],
    rng: np.random.Generator,
    experiment_key: str,
) -> list[str]:
    """Writes `report.pg_matrix.tsv` and CurveCurator-like `curves.txt` for a vehicle + 5-dose series."""
    n = len(proteins)
    base = _abundance(rng, n)
    responder = rng.random(n) < 0.12
    down = rng.random(n) < 0.7
    pec50 = rng.uniform(5.5, 8.5, n)
    slope = rng.uniform(0.8, 1.5, n)
    back = np.where(down, rng.uniform(0.15, 0.5, n), rng.uniform(2.0, 4.0, n))

    def ratio(i: int, dose: float | None) -> float:
        if dose is None or not responder[i]:
            return 1.0
        return four_pl_ratio(math.log10(dose), float(pec50[i]), float(slope[i]), 1.0, float(back[i]))

    log2 = np.array(
        [
            [base[i] + math.log2(ratio(i, s.dose_molar)) + rng.normal(0, 0.15) for s in samples]
            for i in range(n)
        ]
    )
    write_pg_matrix(path_dir / "report.pg_matrix.tsv", proteins, samples, log2, rng, experiment_key)

    # curves.txt: column names from CurveCurator 0.6.0 (github.com/kusterlab/curve_curator, Apache-2.0).
    # Values are simulated around the true parameters, not fitted. Ratio 1 is the vehicle (control) ratio.
    doses = sorted({s.dose_molar for s in samples if s.dose_molar is not None})
    header = [
        "Name",
        *(f"Ratio {k}" for k in range(1, len(doses) + 2)),
        "pEC50",
        "Curve Slope",
        "Curve Front",
        "Curve Back",
        "Curve Fold Change",
        "Curve R2",
        "Curve P_Value",
        "Curve Regulation",
    ]
    rows: list[list[str | float | None]] = []
    for i, protein in enumerate(proteins):
        ratios = [1.0] + [ratio(i, d) * 2.0 ** rng.normal(0, 0.1) for d in doses]
        if responder[i]:
            fold_change = math.log2(ratio(i, doses[-1]) / ratio(i, doses[0]))
            p = 10.0 ** -rng.uniform(3.0, 8.0)
            fit = [float(pec50[i] + rng.normal(0, 0.1)), float(slope[i]), 1.0, float(back[i])]
            regulation = "down" if down[i] else "up"
            r2 = rng.uniform(0.8, 0.99)
        else:
            fold_change = float(rng.normal(0, 0.1))
            p = float(rng.uniform(0.05, 1.0))
            fit = [None, None, None, None]
            regulation = "not" if rng.random() < 0.85 else ""
            r2 = rng.uniform(0.0, 0.4)
        rows.append([";".join(protein.accessions), *ratios, *fit, fold_change, r2, p, regulation])
    write_tsv(path_dir / "curves.txt", header, rows)
    return ["report.pg_matrix.tsv", "curves.txt"]


def write_toptable(path: Path, proteins: list[Protein], rng: np.random.Generator, se: float) -> None:
    """limma-like `topTable(fit, coef, confint=TRUE, sort.by="P", n=Inf)` written with an ID column
    (limma User's Guide, Bioconductor 3.22: logFC, CI.L, CI.R, AveExpr, t, P.Value, adj.P.Val, B).
    B (log-odds) is omitted: it is not simulated. logFC = log2(numerator / denominator). p from a normal
    approximation of t; adj.P.Val is Benjamini-Hochberg."""
    n = len(proteins)
    true_fc = np.where(rng.random(n) < 0.1, rng.choice([-1.0, 1.0], n) * rng.uniform(1.0, 3.0, n), 0.0)
    log_fc = true_fc + rng.normal(0, se, n)
    t = log_fc / se
    p = two_sided_normal_p(t)
    adj = benjamini_hochberg(p)
    ave = _abundance(rng, n)
    order = np.argsort(p, kind="stable")
    header = ["ID", "Genes", "logFC", "CI.L", "CI.R", "AveExpr", "t", "P.Value", "adj.P.Val"]
    rows = [
        [
            ";".join(proteins[i].accessions),
            ";".join(proteins[i].genes),
            float(log_fc[i]),
            float(log_fc[i] - 1.96 * se),
            float(log_fc[i] + 1.96 * se),
            float(ave[i]),
            float(t[i]),
            float(p[i]),
            float(adj[i]),
        ]
        for i in (int(k) for k in order)
    ]
    write_tsv(path, header, rows)


def dia_contrast(
    path_dir: Path,
    proteins: list[Protein],
    samples: list[Sample],
    rng: np.random.Generator,
    experiment_key: str,
) -> list[str]:
    base = _abundance(rng, len(proteins))
    log2 = base[:, None] + rng.normal(0, 0.2, (len(proteins), len(samples)))
    write_pg_matrix(path_dir / "report.pg_matrix.tsv", proteins, samples, log2, rng, experiment_key)
    write_toptable(path_dir / "toptable.tsv", proteins, rng, se=0.25)
    return ["report.pg_matrix.tsv", "toptable.tsv"]


def tmt_contrast(path_dir: Path, proteins: list[Protein], rng: np.random.Generator) -> list[str]:
    write_toptable(path_dir / "toptable.tsv", proteins, rng, se=0.15)
    return ["toptable.tsv"]
