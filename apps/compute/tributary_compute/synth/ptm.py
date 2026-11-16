"""Demo MaxQuant site table (Phase 47): the layout of `Phospho (STY)Sites.txt`, invented values.

Column names: packages/importers/src/maxquant_sites/SOURCE.md (MaxQuant documentation, "Output Tables" →
"Site Table"). Sites, positions, probabilities and intensities are invented: the file exercises the importer
and the views, not any biology. Sample names are the ONC-DIA-05 manifest's sample keys.
"""

from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import Protein
from tributary_compute.synth.io import Cell, fmt

MOD = "Phospho (STY)"
SAMPLES = [f"ONC-DIA-05-S0{i}" for i in range(1, 7)]
AMINO = "ACDEFGHIKLMNPQRSTVWY"
N_PROTEINS = 14
SITES_PER_PROTEIN = (1, 4)  # inclusive range
# Canonical sequence lengths (UniProt) of the real proteins used: invented sites fall inside the protein.
# Residues are invented and not checked against the sequence. Synthetic proteins use 600.
LENGTHS = {
    "TP53": 393,
    "EGFR": 1210,
    "AKT1": 480,
    "KRAS": 189,
    "BRAF": 766,
    "PTEN": 403,
    "CDK1": 297,
    "CDK2": 298,
    "CDK4": 303,
    "CDK6": 326,
    "ERBB2": 1255,
    "ABL1": 1130,
    "SRC": 536,
    "MAPK1": 360,
}
# A site on two proteins: AKT1 S473 is the conserved site AKT2 S474 (P31751), as on a shared peptide.
SHARED = ("P31751", 474)


def _window(rng: np.random.Generator, residue: str) -> str:
    """31 residues with the modified one in the middle (position 16)."""
    left = "".join(rng.choice(list(AMINO), size=15))
    right = "".join(rng.choice(list(AMINO), size=15))
    return left + residue + right


def write_ptm_sites(out: Path, proteins: list[Protein], rng: np.random.Generator) -> list[str]:
    header = [
        "Proteins",
        "Positions within proteins",
        "Leading proteins",
        "Protein",
        "Protein names",
        "Gene names",
        "Fasta headers",
        "Localization prob",
        "Score diff",
        "PEP",
        "Score",
        "Delta score",
        "Score for localization",
    ]
    header += [f"Localization prob {s}" for s in SAMPLES]
    header += [
        f"Number of {MOD}",
        "Amino acid",
        "Sequence window",
        "Modification window",
        "Peptide window coverage",
        f"{MOD} Probabilities",
        f"{MOD} Score diffs",
        "Position in peptide",
        "Charge",
        "Mass error [ppm]",
    ]
    header += [f"Identification type {s}" for s in SAMPLES]
    header += ["Reverse", "Potential contaminant", "id", "Protein group IDs", "Positions", "Position"]
    header += [
        "Peptide IDs",
        "Mod. peptide IDs",
        "Evidence IDs",
        "MS/MS IDs",
        "Best localization evidence ID",
    ]
    header += ["Intensity", "Intensity___1", "Intensity___2", "Intensity___3"]
    header += [f"Intensity {s}" for s in SAMPLES]
    header += [f"Intensity {s}___{j}" for s in SAMPLES for j in (1, 2, 3)]
    header += [f"Occupancy {s}" for s in SAMPLES]

    rows: list[list[Cell]] = []
    sites: list[tuple[Protein | None, str, int, str]] = []  # protein, residue, position, flag
    for p in proteins[:N_PROTEINS]:
        n = int(rng.integers(SITES_PER_PROTEIN[0], SITES_PER_PROTEIN[1] + 1))
        length = LENGTHS.get(p.genes[0], 600)
        positions = sorted({int(x) for x in rng.integers(2, length + 1, size=n)} - {473})
        for pos in positions:
            residue = str(rng.choice(["S", "S", "S", "T", "T", "Y"]))
            sites.append((p, residue, pos, ""))
        if p.genes[0] == "AKT1":
            sites.append((p, "S", 473, ""))  # a fixed position for tests and demos
    sites.append((None, "S", 210, "reverse"))
    sites.append((None, "T", 55, "contaminant"))

    for k, (p, residue, pos, flag) in enumerate(sites):
        if flag == "reverse":
            accs, genes, names = "REV__SYNP0099", "", ""
        elif flag == "contaminant":
            accs, genes, names = "CON__P02768", "ALB", "Serum albumin"
        elif p is not None:
            accs, genes, names = p.accessions[0], p.genes[0], p.names[0]
        else:
            raise ValueError("a site without a protein must be a reverse or contaminant row")
        protein_ids, positions = accs, str(pos)
        if p is not None and p.genes[0] == "AKT1" and pos == 473:
            protein_ids, positions = f"{accs};{SHARED[0]}", f"{pos};{SHARED[1]}"
        # Localisation spread: most sites above 0.75, some below; one exactly at 0.75.
        loc = (
            0.75
            if k == 3
            else float(rng.choice([rng.uniform(0.9, 1.0), rng.uniform(0.76, 0.9), rng.uniform(0.3, 0.75)]))
        )
        window = _window(rng, residue)
        per_loc: list[Cell] = []
        per_int: list[list[float]] = []
        for s_i in range(len(SAMPLES)):
            measured = not (k % 5 == 2 and s_i in (4, 5))  # some sites missing in two samples
            m1 = float(rng.lognormal(18.0, 1.0)) if measured else 0.0
            m2 = float(rng.lognormal(16.0, 1.0)) if measured and k % 3 == 0 else 0.0
            per_int.append([m1, m2, 0.0])
            # Per sample at most the table-wide value (MaxQuant's Localization prob is the best over samples).
            per_loc.append(max(0.0, loc - float(rng.uniform(0.0, 0.05))) if measured else None)
        if k == 4:
            per_loc[2] = float("nan")  # MaxQuant writes NaN in some cells
        totals = [sum(x) for x in per_int]
        row: list[Cell] = [
            protein_ids,
            positions,
            accs,
            accs,
            names,
            genes,
            f">{accs} {names}" if names else f">{accs}",
            loc,
            float(rng.uniform(5.0, 60.0)),
            float(10 ** -rng.uniform(2.0, 8.0)),
            float(rng.uniform(60.0, 200.0)),
            float(rng.uniform(20.0, 150.0)),
            float(rng.uniform(60.0, 200.0)),
        ]
        row += [("NaN" if isinstance(v, float) and v != v else v) for v in per_loc]
        row += [
            "1;2" if k % 3 == 0 else "1",
            residue,
            window,
            "X" * 15 + "Y" + "X" * 15,
            "1",
            window[10:16] + f"{residue}({fmt(loc, 3)})" + window[16:21],
            window[10:16] + f"{residue}({fmt(float(rng.uniform(5, 60)), 3)})" + window[16:21],
            6,
            2,
            float(rng.normal(0.0, 1.0)),
        ]
        row += ["By MS/MS" if v is not None else "" for v in per_loc]
        row += ["+" if flag == "reverse" else "", "+" if flag == "contaminant" else "", k, k, positions, pos]
        row += [k, k, k, k, k]
        row += [sum(totals), sum(x[0] for x in per_int), sum(x[1] for x in per_int), 0.0]
        row += totals
        row += [v for x in per_int for v in x]
        row += [None] * len(SAMPLES)
        rows.append(row)

    path = out / "maxquant" / "Phospho_STY_Sites.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header)]
    lines += ["\t".join(c if isinstance(c, str) else fmt(c) for c in row) for row in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ["maxquant/Phospho_STY_Sites.txt"]
