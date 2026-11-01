"""SDRF-Proteomics export and import (SPEC M2, §6.1).

Column names follow the SDRF-Proteomics specification as validated by sdrf-pipelines 0.1.6
(Apache-2.0, https://github.com/bigbio/sdrf-pipelines), template `ms-proteomics` 1.1.0. Exports are
validated with that library with ontology lookups switched off (offline); ontology terms are checked by the
manifest editor.
"""

import csv
import io
from collections.abc import Sequence

from pydantic import BaseModel
from sdrf_pipelines.sdrf.sdrf import read_sdrf

NA = "not available"
NOT_APPLICABLE = "not applicable"
SDRF_TEMPLATE = "ms-proteomics"

# Controlled values used when the manifest has no column for them (PSI-MS / NCIT accessions).
ACQUISITION = {
    "proteomics_dia": "NT=Data-Independent Acquisition;AC=NCIT:C161786",
    "proteomics_dda": "NT=Data-Dependent Acquisition;AC=NCIT:C161785",
    "proteomics_tmt": "NT=Data-Dependent Acquisition;AC=NCIT:C161785",
}
LABEL_FREE = "AC=MS:1002038;NT=label free sample"
TRYPSIN = "NT=Trypsin;AC=MS:1001251"
TECHNOLOGY = "proteomic profiling by mass spectrometry"

# SDRF column ← manifest column (or a fixed default when the manifest cell is empty).
COLUMNS: Sequence[tuple[str, str | None, str]] = (
    ("source name", "source_name", ""),
    ("characteristics[organism]", "organism", NA),
    ("characteristics[organism part]", "tissue", NA),
    ("characteristics[disease]", "disease", NA),
    ("characteristics[cell type]", "cell_type", NA),
    ("characteristics[cell line]", "cell_line", NOT_APPLICABLE),
    ("characteristics[biological replicate]", "biological_replicate", "1"),
    ("assay name", "sample_key", ""),
    ("technology type", None, TECHNOLOGY),
    ("comment[technical replicate]", "technical_replicate", "1"),
    ("comment[data file]", "raw_file", ""),
    ("comment[fraction identifier]", "fraction", "1"),
    ("comment[label]", "label_channel", LABEL_FREE),
    ("comment[instrument]", None, ""),
    ("comment[cleavage agent details]", None, TRYPSIN),
    ("comment[proteomics data acquisition method]", None, ""),
    ("factor value[compound]", "compound_id", NOT_APPLICABLE),
    ("factor value[dose]", "dose", NOT_APPLICABLE),
    ("factor value[time]", "time", NOT_APPLICABLE),
)
REQUIRED = ("source_name", "sample_key", "raw_file")
INSTRUMENT_HINT = "Set the experiment's instrument (e.g. NT=Orbitrap Exploris 480;AC=MS:1003028)."


class SdrfError(BaseModel):
    code: str
    field: str | None = None
    message: str


class ExportResult(BaseModel):
    sdrf: str
    errors: list[SdrfError]


class ImportResult(BaseModel):
    rows: list[dict[str, str]]
    errors: list[SdrfError]


def _write(header: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, delimiter="\t", lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue()


def export_sdrf(
    assay_type: str, rows: Sequence[dict[str, str]], instrument: str | None = None
) -> ExportResult:
    """Manifest rows (raw cells) → SDRF text, plus field-level errors for missing data and validator findings.
    The instrument is required: SDRF does not accept 'not available' for it, and we never invent one."""
    errors = [] if instrument else [SdrfError(code="required", field="instrument", message=INSTRUMENT_HINT)]
    errors += [
        SdrfError(code="required", field=f"rows.{i}.{key}", message=f"{key} is needed for SDRF export.")
        for i, row in enumerate(rows)
        for key in REQUIRED
        if not (row.get(key) or "").strip()
    ]
    header = [name for name, _, _ in COLUMNS]
    body: list[list[str]] = []
    for row in rows:
        values: list[str] = []
        for name, source, default in COLUMNS:
            value = (row.get(source) or "").strip() if source else ""
            if name == "comment[instrument]" and instrument:
                value = instrument
            if name == "comment[proteomics data acquisition method]":
                value = ACQUISITION.get(assay_type, ACQUISITION["proteomics_dda"])
            if name == "characteristics[organism]":
                value = value.lower()  # SDRF convention: organism names in lower case
            values.append(value or default)
        body.append(values)
    text = _write(header, body)
    if not errors:
        findings = read_sdrf(io.StringIO(text)).validate_sdrf(SDRF_TEMPLATE, skip_ontology=True)
        errors = [SdrfError(code="sdrf_invalid", message=str(f)) for f in findings]
    return ExportResult(sdrf=text, errors=errors)


def import_sdrf(text: str) -> ImportResult:
    """SDRF text → manifest rows (raw cells). Unknown SDRF columns are ignored; the label-free placeholder is
    not imported as a label channel."""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")), delimiter="\t")
    lines = [line for line in reader if any(cell.strip() for cell in line)]
    if not lines or "source name" not in [h.strip().lower() for h in lines[0]]:
        return ImportResult(
            rows=[], errors=[SdrfError(code="not_sdrf", message="The file has no 'source name' column.")]
        )
    header = [h.strip().lower() for h in lines[0]]
    mapping = {name: source for name, source, _ in COLUMNS if source}
    rows: list[dict[str, str]] = []
    for line in lines[1:]:
        row: dict[str, str] = {}
        for i, name in enumerate(header):
            source = mapping.get(name)
            value = line[i].strip() if i < len(line) else ""
            if source and value and not (source == "label_channel" and value == LABEL_FREE):
                row[source] = value
        if "sample_key" not in row and row.get("source_name"):
            row["sample_key"] = row["source_name"]
        rows.append(row)
    return ImportResult(rows=rows, errors=[])
