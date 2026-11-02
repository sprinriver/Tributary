import asyncio

import httpx

from tributary_compute.main import app


async def _get(path: str, headers: dict[str, str] | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
        return await client.get(path, headers=headers)


def test_OPS_01_healthz_reports_ok() -> None:
    response = asyncio.run(_get("/healthz"))
    assert response.status_code == 200
    assert response.json() == {"service": "compute", "status": "ok", "version": "0.0.0"}


def test_OPS_08_request_id_from_the_api_is_echoed(caplog) -> None:  # noqa: ANN001
    caplog.set_level("INFO", logger="tributary_compute.requests")
    trace = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    response = asyncio.run(_get("/healthz", {"x-request-id": "req-abc12345", "traceparent": trace}))
    assert response.headers["x-request-id"] == "req-abc12345"
    line = next(r for r in caplog.records if r.name == "tributary_compute.requests")
    assert '"request_id": "req-abc12345"' in line.getMessage()
    assert '"trace_id": "0af7651916cd43dd8448eb211c80319c"' in line.getMessage()


def test_OPS_08_a_malformed_request_id_is_replaced() -> None:
    response = asyncio.run(_get("/healthz", {"x-request-id": "bad id"}))
    assert response.headers["x-request-id"] != "bad id"
    assert len(response.headers["x-request-id"]) == 36
