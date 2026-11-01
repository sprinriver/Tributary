"""FastAPI entry point. Internal only: reached by apps/api, never by the browser."""

from typing import Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from tributary_compute import __version__
from tributary_compute.contracts.cluster_request import ClusterRequest
from tributary_compute.contracts.cluster_result import ClusterResult
from tributary_compute.contracts.embed_request import EmbedRequest
from tributary_compute.contracts.embed_response import EmbedResponse
from tributary_compute.contracts.fit4pl_request import Fit4plRequest
from tributary_compute.contracts.fit4pl_result import Fit4plResult
from tributary_compute.contracts.group_summary_request import GroupSummaryRequest
from tributary_compute.contracts.group_summary_result import GroupSummaryResult
from tributary_compute.contracts.group_test_request import GroupTestRequest
from tributary_compute.contracts.group_test_result import GroupTestResult
from tributary_compute.contracts.kde_request import KdeRequest
from tributary_compute.contracts.kde_result import KdeResult
from tributary_compute.contracts.pca_request import PcaRequest
from tributary_compute.contracts.pca_result import PcaResult
from tributary_compute.contracts.pvalues_request import PValuesRequest
from tributary_compute.contracts.pvalues_result import PValuesResult
from tributary_compute.contracts.zscore_request import ZScoreRequest
from tributary_compute.contracts.zscore_result import ZScoreResult
from tributary_compute.embed import embed
from tributary_compute.sdrf import ExportResult, ImportResult, export_sdrf, import_sdrf
from tributary_compute.stats import cluster, groups, simple
from tributary_compute.stats.errors import ComputeError

app = FastAPI(title="tributary-compute", version=__version__)


@app.exception_handler(ComputeError)
async def compute_error(_request: Request, error: ComputeError) -> JSONResponse:
    """Guards answer 422 with a ContractError so the UI can show it next to the control."""
    return JSONResponse(
        status_code=422, content={"code": error.code, "field": error.field, "message": error.message}
    )


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


@app.post("/stats/cluster")
def stats_cluster(request: ClusterRequest) -> ClusterResult:
    return cluster.cluster(request)


@app.post("/stats/kde")
def stats_kde(request: KdeRequest) -> KdeResult:
    return simple.kde(request)


@app.post("/stats/pvalues")
def stats_pvalues(request: PValuesRequest) -> PValuesResult:
    return simple.pvalues(request)


@app.post("/stats/zscore")
def stats_zscore(request: ZScoreRequest) -> ZScoreResult:
    return simple.zscore(request)


@app.post("/stats/pca")
def stats_pca(request: PcaRequest) -> PcaResult:
    return simple.pca(request)


@app.post("/stats/fit-4pl")
def stats_fit_4pl(request: Fit4plRequest) -> Fit4plResult:
    return simple.fit_4pl(request)


@app.post("/stats/group-test")
def stats_group_test(request: GroupTestRequest) -> GroupTestResult:
    return groups.group_test(request)


@app.post("/stats/group-summary")
def stats_group_summary(request: GroupSummaryRequest) -> GroupSummaryResult:
    return groups.group_summary(request)


@app.post("/embed")
def embed_texts(request: EmbedRequest) -> EmbedResponse:
    """The `local` search embedding provider (hashing, not a semantic model)."""
    return embed(request)
