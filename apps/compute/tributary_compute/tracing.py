"""Request ids and trace context from apps/api (SPEC §9 Observability, OPS-08).

Each request logs one JSON line under the caller's ``x-request-id`` (else a new UUID) and the trace id of
its W3C ``traceparent`` (https://www.w3.org/TR/trace-context/#traceparent-header); the id is echoed back.
"""

import json
import logging
import re
import sys
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

logger = logging.getLogger("tributary_compute.requests")
# Uvicorn configures only its own loggers: request lines get a stdout handler (one JSON object a line).
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$")


async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    inbound = request.headers.get("x-request-id", "")
    request_id = inbound if _REQUEST_ID.match(inbound) else str(uuid.uuid4())
    trace = _TRACEPARENT.match(request.headers.get("traceparent", ""))
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    logger.info(
        json.dumps(
            {
                "msg": "request completed",
                "request_id": request_id,
                "trace_id": trace.group(1) if trace else None,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            }
        )
    )
    return response
