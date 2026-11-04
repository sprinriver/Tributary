"""Deterministic synthetic demo corpus (`pnpm synth`, SPEC Phase 2b / SYN-01).

`generate(out_dir, seed)` writes every fixture and returns {relative path: sha256}. Same seed → same bytes:
one numpy PCG64 generator per output, derived from the seed and the output's name, fixed float formatting.
"""

import hashlib
import shutil
import zlib
from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import EXPERIMENTS, PROGRAMS, all_proteins
from tributary_compute.synth.gene_sets import write_gene_sets
from tributary_compute.synth.genomics import mageck_gene_summary, rnaseq_counts
from tributary_compute.synth.io import write_json, write_tsv
from tributary_compute.synth.manifests import COLUMNS, build_samples, contrasts
from tributary_compute.synth.proteomics import dia_contrast, dose_series, tmt_contrast
from tributary_compute.synth.readme import README
from tributary_compute.synth.reference import write_reference
from tributary_compute.synth.structures import write_structures
from tributary_compute.synth.tools import write_tools

DEFAULT_SEED = 20261026


def _rng(seed: int, name: str) -> np.random.Generator:
    """Independent stream per output, so adding one output never changes the others."""
    return np.random.default_rng([seed, zlib.crc32(name.encode())])


def generate(out_dir: Path, seed: int = DEFAULT_SEED) -> dict[str, str]:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    proteins = all_proteins()
    genes = [g for p in proteins for g in p.genes]

    experiments: list[dict[str, object]] = []
    for plan in EXPERIMENTS:
        exp_dir = out_dir / "experiments" / plan.key
        samples = build_samples(plan)
        write_tsv(exp_dir / "samples.tsv", COLUMNS, ([s.cells[c] for c in COLUMNS] for s in samples))
        rng = _rng(seed, plan.key)
        if plan.design == "dose_series":
            outputs = dose_series(exp_dir, proteins, samples, rng, plan.key)
        elif plan.assay_type == "proteomics_dia":
            outputs = dia_contrast(exp_dir, proteins, samples, rng, plan.key)
        elif plan.assay_type == "proteomics_tmt":
            outputs = tmt_contrast(exp_dir, proteins, rng)
        elif plan.assay_type == "rnaseq":
            outputs = rnaseq_counts(exp_dir, genes, samples, rng)
        else:
            outputs = mageck_gene_summary(exp_dir, genes, rng)
        experiments.append(
            {
                "key": plan.key,
                "program_code": plan.program_code,
                "assay_type": plan.assay_type,
                "design": plan.design,
                "name": f"{plan.key}: {plan.design.replace('_', ' ')} in {plan.cell_line}",
                "description": f"Synthetic {plan.assay_type} {plan.design.replace('_', ' ')} "
                + (f"with {plan.compound} " if plan.compound else "")
                + f"in {plan.cell_line} cells.",
                "experiment_date": plan.experiment_date,
                "species": {"id": "NCBITaxon:9606", "label": "Homo sapiens"},
                "template_version": "1.0.0",
                "manifest": "samples.tsv",
                "outputs": outputs,
                "contrasts": contrasts(plan),
            }
        )

    write_json(out_dir / "programs.json", list(PROGRAMS))
    write_json(out_dir / "experiments.json", experiments)
    write_reference(out_dir / "reference", _rng(seed, "reference"))
    write_gene_sets(out_dir / "reference", proteins, _rng(seed, "gene_sets"))
    write_tools(out_dir / "tools", proteins, lambda name: _rng(seed, name))
    write_structures(out_dir / "structures", _rng(seed, "structures"))
    (out_dir / "README.md").write_text(README.format(seed=seed), encoding="utf-8")

    return {
        path.relative_to(out_dir).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(out_dir.rglob("*"))
        if path.is_file()
    }
