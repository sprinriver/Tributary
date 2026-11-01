"""Small fixtures in each Phase 9 tool's output format (`fixtures/tools/<tool>/`), for importer golden tests.

Column spellings follow the sources cited in each importer's SOURCE.md (packages/importers/src/<key>/).
Values are
simulated: intensities log-normal, statistics around known effects. Four runs `TOOLS_run01..04`
(two DMSO, two treated) and the first 20 catalogue proteins; the manifest is `fixtures/tools/samples.tsv`.
"""

from collections.abc import Callable
from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import Protein
from tributary_compute.synth.io import Cell, write_json, write_tsv
from tributary_compute.synth.stats import benjamini_hochberg, two_sided_normal_p

RUNS = [f"TOOLS_run{i:02d}" for i in range(1, 5)]
SAMPLES = [f"TOOLS-S{i:02d}" for i in range(1, 5)]
CONDITIONS = ["DMSO", "DMSO", "CPD-000001@1 µM", "CPD-000001@1 µM"]
CONTRAST = "CPD-000001@1 µM vs DMSO"


def _intensities(rng: np.random.Generator, n: int) -> np.ndarray:
    """Linear intensities (log2 ~ N(22, 2)) for n proteins x 4 runs; ~10% missing (NaN)."""
    log2 = rng.normal(22.0, 2.0, (n, 1)) + rng.normal(0, 0.3, (n, len(RUNS)))
    values = np.round(2.0**log2, 1)
    values[rng.random(values.shape) < 0.1] = np.nan
    return values


def _cell(value: float) -> Cell:
    return None if np.isnan(value) else float(value)


def _stats(rng: np.random.Generator, n: int, se: float = 0.25) -> tuple[np.ndarray, ...]:
    fc = np.where(rng.random(n) < 0.2, rng.choice([-1.5, 1.5], n), 0.0) + rng.normal(0, se, n)
    t = fc / se
    p = two_sided_normal_p(t)
    return fc, t, p, benjamini_hochberg(p)


def write_tools(
    out: Path, proteins: list[Protein], rng_for: Callable[[str], np.random.Generator]
) -> list[str]:
    ps = proteins[:20]
    n = len(ps)
    acc = [";".join(p.accessions) for p in ps]
    genes = [";".join(p.genes) for p in ps]
    names = [";".join(p.names) for p in ps]
    written: list[str] = []

    def r_csv_cell(c: Cell) -> str:
        """R write.csv style: strings quoted, missing as NA, numbers with 6 significant digits."""
        if c is None:
            return "NA"
        if isinstance(c, float):
            return f"{c:.6g}"
        if isinstance(c, int):
            return str(c)
        return '"' + c.replace('"', '""') + '"' if c not in ("Inf", "-Inf") else c

    def tsv(rel: str, header: list[str], rows: list[list[Cell]], sep_comma: bool = False) -> None:
        path = out / rel
        if sep_comma:
            path.parent.mkdir(parents=True, exist_ok=True)
            lines = [",".join(f'"{h}"' for h in header)] + [",".join(r_csv_cell(c) for c in r) for r in rows]
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        else:
            write_tsv(path, header, rows)
        written.append(rel)

    tsv(
        "samples.tsv",
        ["sample_key", "condition", "instrument_run", "raw_file"],
        [[s, c, r, f"s3://raw/tools/{r}.raw"] for s, c, r in zip(SAMPLES, CONDITIONS, RUNS, strict=True)],
    )

    # DIA-NN main report (README "Main output reference"); written as TSV, converted to Parquet in tests.
    rng = rng_for("tools/diann")
    pg = _intensities(rng, n)
    rows: list[list[Cell]] = []
    for i, p in enumerate(ps):
        seq = f"PEPTIDE{p.genes[0][:3].upper()}K"
        for j, run in enumerate(RUNS):
            if np.isnan(pg[i, j]):
                continue
            q = float(rng.uniform(1e-5, 0.009))
            rows.append(
                [
                    run,
                    f"{seq}2",
                    seq,
                    seq,
                    2,
                    acc[i],
                    names[i],
                    genes[i],
                    float(pg[i, j] * 1.05),
                    float(pg[i, j]),
                    float(pg[i, j]),
                    q,
                    q / 2,
                    q / 3,
                    q / 4,
                    float(rng.uniform(5, 60)),
                    float(rng.uniform(0.7, 1.3)),
                ]
            )
    tsv(
        "diann/report.tsv",
        [
            "Run",
            "Precursor.Id",
            "Modified.Sequence",
            "Stripped.Sequence",
            "Precursor.Charge",
            "Protein.Group",
            "Protein.Names",
            "Genes",
            "Precursor.Quantity",
            "Precursor.Normalised",
            "PG.MaxLFQ",
            "Q.Value",
            "Global.Q.Value",
            "PG.Q.Value",
            "Global.PG.Q.Value",
            "RT",
            "IM",
        ],
        rows,
    )

    # AlphaDIA precursors table and pg matrix (alphadia/constants/keys.py, 2.3.2-dev0).
    rng = rng_for("tools/alphadia")
    pg = _intensities(rng, n)
    rows = []
    for i, p in enumerate(ps):
        seq = f"PEPTIDE{p.genes[0][:3].upper()}R"
        for j, run in enumerate(RUNS):
            if np.isnan(pg[i, j]):
                continue
            rows.append(
                [
                    run,
                    seq,
                    "",
                    "",
                    2,
                    f"{seq}_2",
                    float(pg[i, j]),
                    float(rng.uniform(1e-5, 0.009)),
                    acc[i],
                    genes[i],
                    float(rng.uniform(1e-5, 0.009)),
                    float(rng.uniform(300, 3600)),
                    float(rng.uniform(0.7, 1.3)),
                ]
            )
    tsv(
        "alphadia/precursors.tsv",
        [
            "raw.name",
            "precursor.sequence",
            "precursor.mods",
            "precursor.mod_sites",
            "precursor.charge",
            "precursor.mod_seq_charge_hash",
            "precursor.intensity",
            "precursor.qval",
            "pg.name",
            "pg.genes",
            "pg.qval",
            "precursor.rt.observed",
            "precursor.mobility.observed",
        ],
        rows,
    )
    tsv("alphadia/pg.matrix.tsv", ["pg", *RUNS], [[acc[i], *(_cell(v) for v in pg[i])] for i in range(n)])

    # mzQC 1.0.0 (HUPO-PSI mzQC schema): one runQuality per run with numeric and one table-valued metric.
    rng = rng_for("tools/mzqc")
    run_qualities: list[dict[str, object]] = []
    for run in RUNS:
        run_qualities.append(
            {
                "metadata": {
                    "inputFiles": [
                        {
                            "name": f"{run}.raw",
                            "location": f"file:///data/{run}.raw",
                            "fileFormat": {"accession": "MS:1000563", "name": "Thermo RAW format"},
                        }
                    ],
                    "analysisSoftware": [
                        {"accession": "MS:1000799", "name": "custom unreleased software tool", "version": "0"}
                    ],
                },
                "qualityMetrics": [
                    {
                        "accession": "MS:4000059",
                        "name": "number of MS1 spectra",
                        "value": int(rng.integers(4000, 6000)),
                    },
                    {
                        "accession": "MS:4000060",
                        "name": "number of MS2 spectra",
                        "value": int(rng.integers(40000, 60000)),
                    },
                    {
                        "accession": "MS:4000053",
                        "name": "chromatography duration",
                        "value": float(np.round(rng.uniform(55, 65), 2)),
                        "unit": {"accession": "UO:0000031", "name": "minute"},
                    },
                    {
                        "accession": "MS:4000999",
                        "name": "synthetic table metric",
                        "value": {"x": [1, 2], "y": [3, 4]},
                    },
                ],
            }
        )
    write_json(
        out / "mzqc/runs.mzqc.json",
        {
            "mzQC": {
                "version": "1.0.0",
                "creationDate": "2026-03-02T00:00:00Z",
                "runQualities": run_qualities,
                "controlledVocabularies": [
                    {
                        "name": "Proteomics Standards Initiative Mass Spectrometry Ontology",
                        "uri": "https://github.com/HUPO-PSI/psi-ms-CV/releases/download/v4.1.130/psi-ms.obo",
                        "version": "4.1.130",
                    }
                ],
            }
        },
    )
    written.append("mzqc/runs.mzqc.json")

    # Spectronaut report (long; one row per fragment) — PG.* columns repeat per protein group and run.
    rng = rng_for("tools/spectronaut")
    pg = _intensities(rng, n)
    rows = []
    for j, run in enumerate(RUNS):
        for i, p in enumerate(ps):
            if np.isnan(pg[i, j]):
                continue
            q = float(rng.uniform(1e-5, 0.009))
            for frag in range(2):
                rows.append(
                    [
                        f"{run}.raw",
                        CONDITIONS[j],
                        1 + j % 2,
                        acc[i],
                        genes[i],
                        float(pg[i, j]),
                        q,
                        f"_PEPTIDE{p.genes[0][:3].upper()}K_",
                        2,
                        round(float(pg[i, j]) / (3 + frag), 1),
                    ]
                )
    tsv(
        "spectronaut/report.tsv",
        [
            "R.FileName",
            "R.Condition",
            "R.Replicate",
            "PG.ProteinGroups",
            "PG.Genes",
            "PG.Quantity",
            "PG.Qvalue",
            "EG.ModifiedSequence",
            "FG.Charge",
            "F.PeakArea",
        ],
        rows,
    )

    # MaxQuant proteinGroups.txt with one reverse and one contaminant row (flag "+"); zeros = not quantified.
    rng = rng_for("tools/maxquant")
    pg = np.nan_to_num(_intensities(rng, n), nan=0.0)
    header = [
        "Protein IDs",
        "Majority protein IDs",
        "Gene names",
        "Q-value",
        "Razor + unique peptides",
        *[f"Intensity {s}" for s in SAMPLES],
        *[f"LFQ intensity {s}" for s in SAMPLES],
        "Only identified by site",
        "Reverse",
        "Potential contaminant",
        "id",
    ]
    rows = []
    for i in range(n):
        rows.append(
            [
                acc[i],
                acc[i],
                genes[i],
                0.0,
                int(rng.integers(2, 30)),
                *[float(v) for v in pg[i]],
                *[float(v) for v in pg[i]],
                "",
                "",
                "",
                i,
            ]
        )
    rows.append(["REV__P99999", "REV__P99999", "", 0.01, 1, *[1000.0] * 4, *[0.0] * 4, "", "+", "", n])
    rows.append(["CON__P02769", "CON__P02769", "ALB", 0.0, 5, *[5e6] * 4, *[5e6] * 4, "", "", "+", n + 1])
    tsv("maxquant/proteinGroups.txt", header, rows)

    # FragPipe combined_protein.tsv (FragPipe docs, tutorial_fragpipe_outputs), experiments = sample keys.
    rng = rng_for("tools/fragpipe")
    pg = _intensities(rng, n)
    header = [
        "Protein",
        "Protein ID",
        "Entry Name",
        "Gene",
        "Protein Length",
        "Coverage",
        "Organism",
        "Protein Existence",
        "Description",
        "Protein Probability",
        "Top Peptide Probability",
        "Combined Total Peptides",
        "Combined Spectral Count",
        "Combined Unique Spectral Count",
        "Combined Total Spectral Count",
        *[f"{s} {k}" for s in SAMPLES for k in ("Spectral Count", "Intensity", "MaxLFQ Intensity")],
        "Indistinguishable Proteins",
    ]
    rows = []
    for i, p in enumerate(ps):
        per: list[Cell] = []
        for j in range(len(SAMPLES)):
            v = pg[i, j]
            per += [
                0 if np.isnan(v) else int(rng.integers(1, 40)),
                0.0 if np.isnan(v) else float(v),
                0.0 if np.isnan(v) else float(v * 0.98),
            ]
        rows.append(
            [
                f"sp|{p.accessions[0]}|{p.names[0]}",
                p.accessions[0],
                p.names[0],
                p.genes[0],
                int(rng.integers(200, 1500)),
                float(np.round(rng.uniform(5, 60), 1)),
                "Homo sapiens",
                "1:Experimental evidence at protein level",
                p.description,
                1.0,
                0.99,
                int(rng.integers(2, 30)),
                int(rng.integers(5, 90)),
                int(rng.integers(5, 80)),
                int(rng.integers(5, 95)),
                *per,
                "",
            ]
        )
    tsv("fragpipe/combined_protein.tsv", header, rows)

    # quantms QPX pg (bigbio/qpx core/data/schemas/pg.yaml): list columns ';'-joined here, lists in Parquet.
    rng = rng_for("tools/qpx")
    pg = _intensities(rng, n)
    rows = []
    for i in range(n):
        for j, run in enumerate(RUNS):
            rows.append(
                [
                    i * 10 + j,
                    acc[i],
                    genes[i],
                    acc[i].split(";")[0],
                    f"{run}.raw",
                    float(rng.uniform(1e-5, 0.009)),
                    float(rng.uniform(1e-5, 0.009)),
                    "LFQ",
                    _cell(pg[i, j]),
                    "false",
                    "false",
                ]
            )
    tsv(
        "qpx/pg.tsv",
        [
            "pg_id",
            "pg_accessions",
            "gg_names",
            "anchor_protein",
            "grouped_runs",
            "global_qvalue",
            "pg_qvalue",
            "label",
            "intensity",
            "is_decoy",
            "contaminant",
        ],
        rows,
    )

    # MSstats groupComparison ComparisonResult (MSstats 4.21 man/groupComparison.Rd), written as CSV.
    rng = rng_for("tools/msstats")
    fc, t, p_, adj = _stats(rng, n, se=0.3)
    rows = []
    for i in range(n):
        if i == 3:  # one condition missing: infinite fold change, no statistics
            rows.append(
                [acc[i], CONTRAST, "Inf", None, None, None, None, None, "oneConditionMissing", 0.5, 0.0]
            )
            continue
        rows.append(
            [
                acc[i],
                CONTRAST,
                float(fc[i]),
                0.3,
                float(t[i]),
                6,
                float(p_[i]),
                float(adj[i]),
                None,
                float(np.round(rng.uniform(0, 0.2), 3)),
                0.0,
            ]
        )
    tsv(
        "msstats/comparison.csv",
        [
            "Protein",
            "Label",
            "log2FC",
            "SE",
            "Tvalue",
            "DF",
            "pvalue",
            "adj.pvalue",
            "issue",
            "MissingPercentage",
            "ImputationPercentage",
        ],
        rows,
        sep_comma=True,
    )

    # DEqMS outputResult (DEqMS 1.31 man/outputResult.Rd): limma columns + gene, count, sca.t,
    # sca.P.Value, sca.adj.
    rng = rng_for("tools/deqms")
    fc, t, p_, adj = _stats(rng, n, se=0.2)
    rows = [
        [
            float(fc[i]),
            float(rng.normal(22, 2)),
            float(t[i]),
            float(p_[i]),
            float(adj[i]),
            float(rng.normal(0, 2)),
            acc[i],
            int(rng.integers(2, 40)),
            float(t[i] * 1.05),
            float(p_[i]),
            float(adj[i]),
        ]
        for i in range(n)
    ]
    tsv(
        "deqms/deqms.tsv",
        [
            "logFC",
            "AveExpr",
            "t",
            "P.Value",
            "adj.P.Val",
            "B",
            "gene",
            "count",
            "sca.t",
            "sca.P.Value",
            "sca.adj",
        ],
        rows,
    )

    # DESeq2 results (DESeq2 1.53 man/results.Rd) via write.csv(as.data.frame(res)): first header is empty.
    rng = rng_for("tools/deseq2")
    gene_ids = [f"ENSG{100000 + i:011d}" for i in range(n)]
    fc, t, p_, adj = _stats(rng, n, se=0.4)
    rows = []
    for i in range(n):
        if i == 0:  # all counts zero
            rows.append([gene_ids[i], 0.0, None, None, None, None, None])
        elif i == 1:  # Cook's distance outlier
            rows.append([gene_ids[i], 812.5, float(fc[i]), 0.4, float(t[i]), None, None])
        elif i == 2:  # removed by independent filtering
            rows.append([gene_ids[i], 1.2, float(fc[i]), 0.4, float(t[i]), float(p_[i]), None])
        else:
            rows.append(
                [
                    gene_ids[i],
                    float(np.round(rng.uniform(5, 5000), 2)),
                    float(fc[i]),
                    0.4,
                    float(t[i]),
                    float(p_[i]),
                    float(adj[i]),
                ]
            )
    tsv(
        "deseq2/results.csv",
        ["", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj"],
        rows,
        sep_comma=True,
    )
    return written
