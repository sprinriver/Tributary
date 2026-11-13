"""Synthetic 3D models (Phase 29): idealised helix-turn-helix backbones as ModelCIF with per-residue pLDDT.

Invented geometry for the demo and tests; not a prediction and not a real structure of any protein.
"""

import math
from pathlib import Path

import numpy as np

MODEL_ACCESSIONS = ("SYNP0053", "SYNP0001", "SYNP0002")
RESIDUES = ("ALA", "LEU", "GLU", "LYS", "ARG", "SER", "ILE", "GLN", "VAL", "ASP")
HELIX = 24  # residues per helix
LOOP = 6

# Idealised alpha-helix backbone: (radius Å, phase offset °, rise offset Å) per atom.
# 100° and 1.5 Å per residue.
_BACKBONE = (("N", 1.55, -28.0, -0.9), ("CA", 2.3, 0.0, 0.0), ("C", 1.6, 28.0, 0.9), ("O", 1.9, 40.0, 2.0))


def _helix(n: int, start: tuple[float, float, float], up: bool) -> list[tuple[str, float, float, float]]:
    atoms: list[tuple[str, float, float, float]] = []
    for i in range(n):
        for name, radius, phase, rise in _BACKBONE:
            angle = math.radians(100.0 * i + phase)
            z = (1.5 * i + rise) * (1 if up else -1)
            atoms.append(
                (name, start[0] + radius * math.cos(angle), start[1] + radius * math.sin(angle), start[2] + z)
            )
    return atoms


def _loop_atoms(n: int, a: tuple[float, float, float], b: tuple[float, float, float]):
    atoms: list[tuple[str, float, float, float]] = []
    for i in range(n):
        t = (i + 1) / (n + 1)
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        z = a[2] + (b[2] - a[2]) * t + 3.0 * math.sin(math.pi * t)
        for name, dx in (("N", -0.6), ("CA", 0.0), ("C", 0.6), ("O", 1.2)):
            atoms.append((name, x + dx, y, z))
    return atoms


def _model(
    rng: np.random.Generator,
) -> tuple[list[str], list[list[tuple[str, float, float, float]]], list[float]]:
    first = _helix(HELIX, (0.0, 0.0, 0.0), up=True)
    top = (0.0, 0.0, 1.5 * (HELIX - 1))
    second = _helix(HELIX, (10.0, 0.0, top[2]), up=False)
    loop = _loop_atoms(LOOP, top, (10.0, 0.0, top[2]))
    flat = first + loop + second
    per_residue = [flat[i : i + 4] for i in range(0, len(flat), 4)]
    n = len(per_residue)
    sequence = [str(rng.choice(RESIDUES)) for _ in range(n)]
    # Confident helices, a less confident loop and termini (as predicted models often look).
    plddt: list[float] = []
    for i in range(n):
        in_loop = HELIX <= i < HELIX + LOOP
        terminal = i < 3 or i >= n - 3
        low, high = (35.0, 60.0) if in_loop or terminal else (82.0, 96.0)
        plddt.append(round(float(rng.uniform(low, high)), 2))
    return sequence, per_residue, plddt


def _cif(
    accession: str,
    sequence: list[str],
    residues: list[list[tuple[str, float, float, float]]],
    plddt: list[float],
) -> str:
    lines = [
        f"data_{accession}",
        "#",
        f"_entry.id {accession}",
        "_struct.title 'Synthetic demo model (invented geometry, not a prediction)'",
        "#",
        "loop_",
        "_struct_conf.conf_type_id",
        "_struct_conf.id",
        "_struct_conf.beg_label_asym_id",
        "_struct_conf.beg_label_seq_id",
        "_struct_conf.end_label_asym_id",
        "_struct_conf.end_label_seq_id",
        f"HELX_P HELX1 A 1 A {HELIX}",
        f"HELX_P HELX2 A {HELIX + LOOP + 1} A {len(sequence)}",
        "#",
        "loop_",
        "_ma_qa_metric.id",
        "_ma_qa_metric.name",
        "_ma_qa_metric.mode",
        "_ma_qa_metric.type",
        "1 pLDDT local pLDDT",
        "#",
        "loop_",
        "_ma_qa_metric_local.label_asym_id",
        "_ma_qa_metric_local.label_comp_id",
        "_ma_qa_metric_local.label_seq_id",
        "_ma_qa_metric_local.metric_id",
        "_ma_qa_metric_local.metric_value",
        "_ma_qa_metric_local.model_id",
        "_ma_qa_metric_local.ordinal_id",
    ]
    for i, (comp, value) in enumerate(zip(sequence, plddt, strict=True), start=1):
        lines.append(f"A {comp} {i} 1 {value:.2f} 1 {i}")
    lines += ["#", "loop_"]
    lines += [
        f"_atom_site.{c}"
        for c in [
            "group_PDB",
            "id",
            "type_symbol",
            "label_atom_id",
            "label_alt_id",
            "label_comp_id",
            "label_asym_id",
            "label_entity_id",
            "label_seq_id",
            "pdbx_PDB_ins_code",
            "Cartn_x",
            "Cartn_y",
            "Cartn_z",
            "occupancy",
            "B_iso_or_equiv",
            "auth_seq_id",
            "auth_asym_id",
            "pdbx_PDB_model_num",
        ]
    ]
    serial = 0
    for i, atoms in enumerate(residues, start=1):
        for name, x, y, z in atoms:
            serial += 1
            lines.append(
                f"ATOM {serial} {name[0]} {name} . {sequence[i - 1]} A 1 {i} ? "
                f"{x:.3f} {y:.3f} {z:.3f} 1.00 {plddt[i - 1]:.2f} {i} A 1"
            )
    lines.append("#")
    return "\n".join(lines) + "\n"


def write_structures(out: Path, rng: np.random.Generator) -> list[str]:
    out.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for accession in MODEL_ACCESSIONS:
        sequence, residues, plddt = _model(rng)
        (out / f"{accession}.cif").write_text(_cif(accession, sequence, residues, plddt), encoding="utf-8")
        written.append(f"structures/{accession}.cif")
    return written
