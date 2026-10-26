"""FastAPI entry point. Internal only: reached by apps/api, never by the browser."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from tributary_compute import __version__

app = FastAPI(title="tributary-compute", version=__version__)


class HealthStatus(BaseModel):
    """Mirrors HealthStatusSchema in packages/contracts."""

    service: str
    status: Literal["ok", "degraded", "down"]
    version: str


@app.get("/healthz")
def healthz() -> HealthStatus:
    return HealthStatus(service="compute", status="ok", version=__version__)
