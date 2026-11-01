"""Phase 17 `local` embedding provider: a deterministic, dependency-free hashing embedder (not a semantic model)."""

import asyncio
import math
from typing import Any

import httpx

from tributary_compute.main import app


def post(path: str, body: dict[str, Any]) -> httpx.Response:
    async def go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
            return await client.post(path, json=body)

    return asyncio.run(go())


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def test_SRCH_02_local_embeddings_are_deterministic_unit_vectors() -> None:
    texts = ["HEK293 dose series", "HEK293 dose series", "CRISPR screen in K-562"]
    res = post("/embed", {"texts": texts, "dims": 256})
    assert res.status_code == 200
    body = res.json()
    assert body["dims"] == 256
    assert body["model"].startswith("hashing-")
    vectors = body["embeddings"]
    assert len(vectors) == 3
    assert all(len(v) == 256 for v in vectors)
    assert vectors[0] == vectors[1]
    for v in vectors:
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-6)


def test_SRCH_02_local_embeddings_rank_shared_words_closer() -> None:
    res = post(
        "/embed", {"texts": ["dose series in HEK293", "HEK293 dose", "CRISPR screen K-562"], "dims": 1024}
    )
    a, b, c = res.json()["embeddings"]
    assert cosine(a, b) > cosine(a, c)


def test_SRCH_02_local_embeddings_reject_empty_text_with_field_error() -> None:
    res = post("/embed", {"texts": ["ok", "  "], "dims": 1024})
    assert res.status_code == 422
    assert res.json()["field"] == "texts.1"
