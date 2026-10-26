"""Customer-style reference tables: compound registry export, compound properties (ADME/physchem), targets."""

from collections.abc import Sequence
from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import COMPOUND_SMILES, PROGRAMS, REAL_PROTEINS
from tributary_compute.synth.io import Cell, write_tsv

SOLUBILITY_CAP_UM = 200.0  # kinetic solubility assays report "> top concentration" when nothing precipitates


def compound_ids() -> list[str]:
    return [f"CPD-{i:06d}" for i in range(1, len(COMPOUND_SMILES) + 1)]


def write_reference(out: Path, rng: np.random.Generator) -> list[str]:
    ids = compound_ids()
    programs = [str(p["code"]) for p in PROGRAMS]
    write_tsv(
        out / "compounds.tsv",
        ["compound_id", "batch_id", "program_code", "name", "smiles", "inchikey"],
        [
            [cid, "B01", programs[i % 2], f"Demo compound {i + 1}", smiles, None]
            for i, (cid, smiles) in enumerate(zip(ids, COMPOUND_SMILES, strict=True))
        ],
    )

    rows: list[Sequence[Cell]] = []
    for i, cid in enumerate(ids):
        program = programs[i % 2]
        solubility = float(rng.uniform(5.0, 300.0))
        rows += [
            [
                cid,
                "B01",
                program,
                "logD7.4",
                float(rng.uniform(0.0, 4.5)),
                None,
                "=",
                "physchem",
                "Shake-flask logD, pH 7.4",
            ],
            [
                cid,
                "B01",
                program,
                "kinetic_solubility",
                min(solubility, SOLUBILITY_CAP_UM),
                "µM",
                ">" if solubility >= SOLUBILITY_CAP_UM else "=",
                "ADME",
                "Kinetic solubility, PBS pH 7.4",
            ],
            [
                cid,
                "B01",
                program,
                "Papp_A_B",
                float(rng.uniform(0.5, 30.0)),
                "1e-6 cm/s",
                "=",
                "ADME",
                "Caco-2 permeability, apical to basolateral",
            ],
            [
                cid,
                "B01",
                program,
                "CLint",
                float(rng.uniform(2.0, 150.0)),
                "µL/min/mg",
                "=",
                "ADME",
                "Human liver microsome intrinsic clearance",
            ],
        ]
    write_tsv(
        out / "compound_properties.tsv",
        [
            "compound_id",
            "batch_id",
            "program_code",
            "property",
            "value",
            "unit",
            "qualifier",
            "assay_category",
            "assay_name",
        ],
        rows,
        digits=4,
    )

    write_tsv(
        out / "target_annotations.tsv",
        ["uniprot_accession", "gene_symbol", "family", "key", "value"],
        [
            [acc, gene, p.family, "subcellular_location", p.location]
            for p in REAL_PROTEINS
            for acc, gene in zip(p.accessions, p.genes, strict=True)
        ],
    )
    return [
        "reference/compounds.tsv",
        "reference/compound_properties.tsv",
        "reference/target_annotations.tsv",
    ]
