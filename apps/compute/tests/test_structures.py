"""STRUC-02: synthetic 3D models (ModelCIF with per-residue pLDDT) for the demo and the viewer's tests."""

import re
from pathlib import Path

from tributary_compute.synth import DEFAULT_SEED, generate
from tributary_compute.synth.structures import MODEL_ACCESSIONS


def _loop(text: str, category: str) -> list[list[str]]:
    """Rows of one mmCIF loop (whitespace-separated values; the generator writes no quoted values)."""
    for block in text.split("loop_\n")[1:]:
        lines = [line for line in block.split("\n") if line]
        if not lines[0].startswith(f"_{category}."):
            continue
        rows: list[list[str]] = []
        for line in lines:
            if line.startswith("_"):
                continue
            if line.startswith("#"):
                break
            rows.append(line.split())
        return rows
    raise AssertionError(f"no loop _{category}")


def test_STRUC_02_models_are_written_for_the_demo_accessions(tmp_path: Path) -> None:
    generate(tmp_path, seed=DEFAULT_SEED)
    assert "SYNP0053" in MODEL_ACCESSIONS
    for accession in MODEL_ACCESSIONS:
        text = (tmp_path / "structures" / f"{accession}.cif").read_text(encoding="utf-8")
        assert text.startswith(f"data_{accession}\n")
        atoms = _loop(text, "atom_site")
        residues = {int(a[8]) for a in atoms}
        assert len(residues) >= 40
        # Backbone atoms per residue, coordinates finite.
        assert {a[3] for a in atoms} == {"N", "CA", "C", "O"}
        assert all(re.fullmatch(r"-?\d+\.\d{3}", a[10]) for a in atoms)


def test_STRUC_02_plddt_is_per_residue_in_0_to_100_and_matches_b_factors(tmp_path: Path) -> None:
    generate(tmp_path, seed=DEFAULT_SEED)
    text = (tmp_path / "structures" / "SYNP0053.cif").read_text(encoding="utf-8")
    assert "_ma_qa_metric.mode" in text
    metric = _loop(text, "ma_qa_metric")
    assert metric == [["1", "pLDDT", "local", "pLDDT"]]
    local = _loop(text, "ma_qa_metric_local")
    plddt = {int(r[2]): float(r[4]) for r in local}
    assert all(0 <= v <= 100 for v in plddt.values())
    atoms = _loop(text, "atom_site")
    assert {int(a[8]) for a in atoms} == set(plddt)
    for a in atoms:
        assert float(a[14]) == plddt[int(a[8])]  # B_iso_or_equiv carries the residue's pLDDT
    assert "synthetic" in text.lower()
