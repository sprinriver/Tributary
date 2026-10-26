import asyncio

import httpx

from tributary_compute.main import app


async def _get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
        return await client.get(path)


def test_OPS_01_healthz_reports_ok() -> None:
    response = asyncio.run(_get("/healthz"))
    assert response.status_code == 200
    assert response.json() == {"service": "compute", "status": "ok", "version": "0.0.0"}
