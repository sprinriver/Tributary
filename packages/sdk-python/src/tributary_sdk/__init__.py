"""Tributary Python SDK (SPEC M13): list experiments, run QuerySpecs, verify webhooks.

Uses the public `/v1` API with a personal access token (Settings → Access tokens in the web app). Every call runs
with the token owner's permissions. Queries are QuerySpecs (the same JSON the Explorer's "Copy as QuerySpec"
gives); SQL is never accepted.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from typing import Any

__all__ = ["Client", "TributaryError", "verify_webhook"]
__version__ = "0.1.0"

Json = dict[str, Any]


class TributaryError(Exception):
    """An API error: HTTP status plus the contract's `{code, field?, message}`."""

    def __init__(self, status: int, code: str, message: str, field: str | None = None) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.field = field
        self.message = message


class Client:
    """A small client for the Tributary API.

    >>> client = Client("https://tributary.example.com/api", token="trb_...")
    >>> for experiment in client.list_experiments():
    ...     print(experiment["name"])
    """

    def __init__(self, base_url: str, token: str, timeout: float = 60.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _request(self, method: str, path: str, query: Json | None = None, body: Any = None) -> Any:
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None}, doseq=True)
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)  # noqa: S310 (http(s) base URL from the caller)
        request.add_header("authorization", f"Bearer {self.token}")
        request.add_header("accept", "application/json")
        if data is not None:
            request.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read() or b"{}")
            except ValueError:
                detail = {}
            raise TributaryError(
                error.code,
                str(detail.get("code", "http_error")),
                str(detail.get("message", error.reason)),
                detail.get("field"),
            ) from None

    def list_experiments(self, **filters: Any) -> Iterator[Json]:
        """Experiments you can read, following the cursor (filters: program_id, assay_type, q, …)."""
        cursor: str | None = None
        while True:
            page = self._request("GET", "/v1/experiments", {**filters, "cursor": cursor})
            yield from page["items"]
            cursor = page.get("next_cursor")
            if not cursor:
                return

    def get_experiment(self, experiment_id: str) -> Json:
        return self._request("GET", f"/v1/experiments/{urllib.parse.quote(experiment_id)}")

    def list_datasets(self, **filters: Any) -> list[Json]:
        """Datasets you can read with their latest release (filters: kind, program_id, q)."""
        return self._request("GET", "/v1/datasets", filters)["items"]

    def search(self, q: str, **filters: Any) -> Json:
        return self._request("GET", "/v1/search", {"q": q, **filters})

    def run_query(self, spec: Json) -> Json:
        """Runs a QuerySpec (validated by the API; program scoping is applied for you). Returns one page."""
        return self._request("POST", "/v1/query", body=spec)

    def iter_rows(self, spec: Json) -> Iterator[Json]:
        """Every row of a QuerySpec, page by page."""
        page_spec = dict(spec)
        while True:
            result = self.run_query(page_spec)
            yield from result["rows"]
            cursor = result.get("nextCursor")
            if not cursor:
                return
            page_spec["page"] = {**page_spec.get("page", {"size": 1000}), "cursor": cursor}


_SIGNATURE = re.compile(r"^t=(\d+),v1=([0-9a-f]{64})$")


def verify_webhook(
    secret: str, header: str, body: str | bytes, now: int | None = None, tolerance_seconds: int = 300
) -> bool:
    """Checks `X-Tributary-Signature` (`t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`) on the raw request body.

    Rejects tampered bodies, wrong secrets and deliveries older than the tolerance (replays).
    """
    match = _SIGNATURE.match(header.strip())
    if not match:
        return False
    timestamp = int(match.group(1))
    if abs((now if now is not None else int(time.time())) - timestamp) > tolerance_seconds:
        return False
    raw = body.encode() if isinstance(body, str) else body
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, match.group(2))
