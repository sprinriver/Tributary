"""SYN-01: the synthetic corpus is deterministic and covers DIA, TMT, RNA-seq, CRISPR, compounds, ADME."""

import csv
import hashlib
import json
from pathlib import Path

from tributary_compute.synth import DEFAULT_SEED, generate

REPO_FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def _header(path: Path) -> list[str]:
    with path.open() as handle:
        return handle.readline().rstrip("\n").split("\t")


def test_SYN_01_same_seed_gives_identical_files(tmp_path: Path) -> None:
    first = generate(tmp_path / "a", seed=7)
    second = generate(tmp_path / "b", seed=7)
    assert len(first) > 20
    assert first == second


def test_SYN_01_different_seed_changes_the_data(tmp_path: Path) -> None:
    first = generate(tmp_path / "a", seed=7)
    second = generate(tmp_path / "b", seed=8)
    assert first.keys() == second.keys()
    assert first != second


def test_SYN_01_committed_fixtures_match_the_default_seed(tmp_path: Path) -> None:
    generated = generate(tmp_path / "fixtures", seed=DEFAULT_SEED)
    for relative, digest in generated.items():
        committed = REPO_FIXTURES / relative
        assert committed.is_file(), f"{relative} missing: run `pnpm synth`"
        assert hashlib.sha256(committed.read_bytes()).hexdigest() == digest, (
            f"{relative} is stale: run `pnpm synth`"
        )
    committed_files = {
        p.relative_to(REPO_FIXTURES).as_posix() for p in REPO_FIXTURES.rglob("*") if p.is_file()
    }
    assert committed_files == set(generated), "fixtures/ differs from `pnpm synth` output"


def test_SYN_01_corpus_covers_programs_experiments_and_assays(tmp_path: Path) -> None:
    generate(tmp_path, seed=DEFAULT_SEED)
    programs = json.loads((tmp_path / "programs.json").read_text())
    experiments = json.loads((tmp_path / "experiments.json").read_text())
    assert len(programs) == 2
    assert len(experiments) == 12
    assays = {e["assay_type"] for e in experiments}
    assert {"proteomics_dia", "proteomics_tmt", "rnaseq", "crispr_screen"} <= assays
    assert {e["program_code"] for e in experiments} == {p["code"] for p in programs}
    for experiment in experiments:
        for name in [experiment["manifest"], *experiment["outputs"]]:
            assert (tmp_path / "experiments" / experiment["key"] / name).is_file()


def test_SYN_01_compounds_and_adme(tmp_path: Path) -> None:
    generate(tmp_path, seed=DEFAULT_SEED)
    compounds = _rows(tmp_path / "reference" / "compounds.tsv")
    assert [c["compound_id"] for c in compounds[:2]] == ["CPD-000001", "CPD-000002"]
    properties = _rows(tmp_path / "reference" / "compound_properties.tsv")
    assert {p["assay_category"] for p in properties} >= {"ADME", "physchem"}
    assert {p["compound_id"] for p in properties} <= {c["compound_id"] for c in compounds}
    targets = _rows(tmp_path / "reference" / "target_annotations.tsv")
    assert any(t["uniprot_accession"] == "P04637" and t["gene_symbol"] == "TP53" for t in targets)


def test_SYN_01_tool_output_formats(tmp_path: Path) -> None:
    generate(tmp_path, seed=DEFAULT_SEED)
    experiments = json.loads((tmp_path / "experiments.json").read_text())
    by_assay: dict[str, list[Path]] = {}
    for e in experiments:
        for name in e["outputs"]:
            by_assay.setdefault(name, []).append(tmp_path / "experiments" / e["key"] / name)

    pg_matrix = by_assay["report.pg_matrix.tsv"][0]
    assert _header(pg_matrix)[:4] == ["Protein.Group", "Protein.Names", "Genes", "First.Protein.Description"]
    assert any(";" in row["Protein.Group"] for row in _rows(pg_matrix)), "needs multi-protein groups"

    top = _rows(by_assay["toptable.tsv"][0])
    assert {"logFC", "AveExpr", "t", "P.Value", "adj.P.Val"} <= set(top[0])
    for row in top:
        p, adj = float(row["P.Value"]), float(row["adj.P.Val"])
        assert 0 < p <= 1
        assert p <= adj <= 1

    curves = _rows(by_assay["curves.txt"][0])
    assert {"Name", "pEC50", "Curve Slope", "Curve Fold Change", "Curve P_Value", "Curve Regulation"} <= set(
        curves[0]
    )
    assert {r["Curve Regulation"] for r in curves} <= {"up", "down", "not", ""}

    mageck = by_assay["gene_summary.txt"][0]
    assert _header(mageck)[:4] == ["id", "num", "neg|score", "neg|p-value"]

    counts = by_assay["salmon.merged.gene_counts.tsv"][0]
    assert _header(counts)[:2] == ["gene_id", "gene_name"]


def test_SYN_01_dose_series_manifest_uses_units(tmp_path: Path) -> None:
    generate(tmp_path, seed=DEFAULT_SEED)
    experiments = json.loads((tmp_path / "experiments.json").read_text())
    dose_series = next(e for e in experiments if e["design"] == "dose_series")
    rows = _rows(tmp_path / "experiments" / dose_series["key"] / dose_series["manifest"])
    doses = {r["dose"] for r in rows}
    assert "not applicable" in doses
    assert {"1 nM", "10 µM"} <= doses
    assert all(r["organism"] == "Homo sapiens" for r in rows)
