"""MAN-06: SDRF-Proteomics export validates with sdrf-pipelines; import maps back to manifest rows."""

import asyncio
import io

import httpx
from sdrf_pipelines.sdrf.sdrf import read_sdrf

from tributary_compute.main import app
from tributary_compute.sdrf import export_sdrf, import_sdrf

INSTRUMENT = "NT=Orbitrap Exploris 480;AC=MS:1003028"


def _rows() -> list[dict[str, str]]:
    return [
        {
            "sample_key": f"S{i}",
            "source_name": f"HeLa culture {i}",
            "organism": "Homo sapiens",
            "cell_line": "HeLa",
            "compound_id": "CPD-000001" if i > 1 else "vehicle",
            "dose": "1 µM" if i > 1 else "not applicable",
            "time": "24 h",
            "biological_replicate": str(i),
            "well": f"A0{i}",
            "raw_file": f"run{i}.raw",
        }
        for i in (1, 2, 3)
    ]


def _validate(text: str) -> list[str]:
    errors = read_sdrf(io.StringIO(text)).validate_sdrf("ms-proteomics", skip_ontology=True)
    return [str(e) for e in errors]


def test_MAN_06_export_passes_sdrf_pipelines_validation() -> None:
    result = export_sdrf("proteomics_dia", _rows(), INSTRUMENT)
    assert result.errors == []
    assert _validate(result.sdrf) == []
    header = result.sdrf.splitlines()[0].split("\t")
    assert header[0] == "source name"
    assert "comment[data file]" in header
    assert "factor value[compound]" in header


def test_MAN_06_export_reports_missing_data_files() -> None:
    rows = _rows()
    rows[1]["raw_file"] = ""
    result = export_sdrf("proteomics_dia", rows, INSTRUMENT)
    assert [(e.code, e.field) for e in result.errors] == [("required", "rows.1.raw_file")]


def test_MAN_06_export_requires_an_instrument() -> None:
    result = export_sdrf("proteomics_dia", _rows())
    assert [(e.code, e.field) for e in result.errors] == [("required", "instrument")]


def test_MAN_06_tmt_labels_and_dda_method() -> None:
    rows = _rows()
    for row, channel in zip(rows, ("TMT126", "TMT127N", "TMT127C"), strict=True):
        row["label_channel"] = channel
    result = export_sdrf("proteomics_tmt", rows, INSTRUMENT)
    assert _validate(result.sdrf) == []
    lines = [line.split("\t") for line in result.sdrf.splitlines()]
    label = lines[0].index("comment[label]")
    assert [line[label] for line in lines[1:]] == ["TMT126", "TMT127N", "TMT127C"]


def test_MAN_06_import_round_trips_the_mapped_columns() -> None:
    exported = export_sdrf("proteomics_dia", _rows(), INSTRUMENT)
    imported = import_sdrf(exported.sdrf)
    assert imported.errors == []
    for original, back in zip(_rows(), imported.rows, strict=True):
        for column in (
            "sample_key",
            "source_name",
            "cell_line",
            "compound_id",
            "dose",
            "biological_replicate",
            "raw_file",
        ):
            assert back[column] == original[column], column
        assert back["organism"].lower() == "homo sapiens"


def test_MAN_06_import_rejects_a_file_without_sdrf_columns() -> None:
    result = import_sdrf("name\tvalue\nx\t1\n")
    assert result.rows == []
    assert result.errors[0].code == "not_sdrf"


async def _post(path: str, body: object) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
        return await client.post(path, json=body)


def test_MAN_06_http_endpoints() -> None:
    exported = asyncio.run(
        _post("/sdrf/export", {"assay_type": "proteomics_dia", "rows": _rows(), "instrument": INSTRUMENT})
    )
    assert exported.status_code == 200
    body = exported.json()
    assert body["errors"] == []
    imported = asyncio.run(_post("/sdrf/import", {"sdrf": body["sdrf"]}))
    assert imported.status_code == 200
    assert [r["sample_key"] for r in imported.json()["rows"]] == ["S1", "S2", "S3"]
