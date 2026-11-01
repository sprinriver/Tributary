"""API-01 / API-02: the Python SDK (packages/sdk-python) lists experiments, runs a QuerySpec, verifies webhooks."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

# packages/sdk-python/src is on the test path (pyproject: pytest pythonpath, pyright extraPaths).
from tributary_sdk import Client, TributaryError, verify_webhook

SPEC = {"source": {"kind": "sample", "scope": {}}, "page": {"size": 25}}


class _Api(BaseHTTPRequestHandler):
    seen: list[dict[str, object]] = []

    def _reply(self, status: int, body: object) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        _Api.seen.append({"method": "GET", "path": self.path, "auth": self.headers["authorization"]})
        if self.path.startswith("/v1/experiments"):
            self._reply(200, {"items": [{"id": "e1", "name": "ONC-DIA-01"}], "next_cursor": None})
        else:
            self._reply(404, {"code": "not_found", "message": "Experiment not found."})

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        _Api.seen.append({"method": "POST", "path": self.path, "body": body})
        self._reply(200, {"rows": [{"sample_key": "S1"}], "columns": [], "totalRows": 1, "nextCursor": None})

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture()
def fake_api():
    server = HTTPServer(("127.0.0.1", 0), _Api)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _Api.seen.clear()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def test_API_01_client_sends_the_token_and_returns_parsed_results(fake_api: str) -> None:
    client = Client(fake_api, token="trb_test")
    experiments = list(client.list_experiments())
    assert [e["name"] for e in experiments] == ["ONC-DIA-01"]
    result = client.run_query(SPEC)
    assert result["rows"] == [{"sample_key": "S1"}]
    assert _Api.seen[0]["auth"] == "Bearer trb_test"
    assert _Api.seen[1] == {"method": "POST", "path": "/v1/query", "body": SPEC}


def test_API_01_errors_carry_the_api_code_and_message(fake_api: str) -> None:
    with pytest.raises(TributaryError) as err:
        Client(fake_api, token="trb_test").get_experiment("missing")
    assert err.value.status == 404
    assert err.value.code == "not_found"


@pytest.mark.skipif(
    not (os.environ.get("TRIBUTARY_API_URL") and os.environ.get("TRIBUTARY_TOKEN")),
    reason="needs the local stack: TRIBUTARY_API_URL and TRIBUTARY_TOKEN (pnpm dev:token)",
)
def test_API_01_against_the_local_stack_lists_experiments_and_runs_a_queryspec() -> None:
    client = Client(os.environ["TRIBUTARY_API_URL"], token=os.environ["TRIBUTARY_TOKEN"])
    experiments = list(client.list_experiments())
    assert any(e["name"].startswith("ONC-") for e in experiments)
    result = client.run_query(SPEC)
    assert result["rows"], "the sample metadata kind returns rows for the seeded programs"


def test_API_02_verify_webhook_accepts_signed_and_rejects_tampered_or_old() -> None:
    secret = "whsec_" + "a" * 40
    body = json.dumps({"event": "run.status", "data": {"status": "succeeded"}})
    ts = int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    header = f"t={ts},v1={sig}"
    assert verify_webhook(secret, header, body)
    assert not verify_webhook(secret, header, body.replace("succeeded", "failed"))
    assert not verify_webhook(secret, header, body, now=ts + 301)
    assert not verify_webhook(secret, "v1=nonsense", body)
