"""FastAPI entry point. Internal only: reached by apps/api, never by the browser."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from tributary_compute import __version__
from tributary_compute.sdrf import ExportResult, ImportResult, export_sdrf, import_sdrf

app = FastAPI(title="tributary-compute", version=__version__)


class HealthStatus(BaseModel):
    """Mirrors HealthStatusSchema in packages/contracts."""

    service: str
    status: Literal["ok", "degraded", "down"]
    version: str


@app.get("/healthz")
def healthz() -> HealthStatus:
    return HealthStatus(service="compute", status="ok", version=__version__)


class SdrfExportRequest(BaseModel):
    assay_type: str
    rows: list[dict[str, str]]
    instrument: str | None = None


class SdrfImportRequest(BaseModel):
    sdrf: str


@app.post("/sdrf/export")
def sdrf_export(request: SdrfExportRequest) -> ExportResult:
    return export_sdrf(request.assay_type, request.rows, request.instrument)


@app.post("/sdrf/import")
def sdrf_import(request: SdrfImportRequest) -> ImportResult:
    return import_sdrf(request.sdrf)
