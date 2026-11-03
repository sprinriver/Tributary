# pyright: basic
"""ENR-01: over-representation analysis (one-sided hypergeometric, BH) vs hand-checked values and SciPy."""

import asyncio
import math
from typing import Any

import httpx
from scipy.stats import false_discovery_control, hypergeom

from tributary_compute.main import app

# Universe of 20 genes G01..G20; hits G01..G05 (n = 5).
BACKGROUND = [f"G{i:02d}" for i in range(1, 21)]
HITS = ["G01", "G02", "G03", "G04", "G05"]
SETS = [
    # 4 of its 5 members are hits: strongly enriched.
    {"id": "SET_A", "name": "Set A", "members": ["G01", "G02", "G03", "G04", "G10"]},
    # 1 hit in 6 members, plus two members outside the universe (ignored for K).
    {"id": "SET_B", "name": "Set B", "members": ["G05", "G11", "G12", "G13", "G14", "G15", "X1", "X2"]},
    # No hits.
    {"id": "SET_C", "name": "Set C", "members": ["G16", "G17", "G18", "G19"]},
    # Too small within the universe (K = 1 < min_size).
    {"id": "SET_TINY", "name": "Tiny", "members": ["G06", "NOT_MEASURED"]},
]


def _post(body: dict[str, Any]) -> httpx.Response:
    async def go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
            return await client.post("/stats/enrichment", json=body)

    return asyncio.run(go())


def _body(**extra: Any) -> dict[str, Any]:
    return {"hits": HITS, "background": BACKGROUND, "gene_sets": SETS, "min_size": 2, "max_size": 500} | extra


def test_ENR_01_hypergeometric_p_values_fold_and_bh_match_scipy() -> None:
    res = _post(_body())
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["n_hits"] == 5
    assert out["n_background"] == 20
    assert out["tested"] == 3
    assert out["excluded_small"] == 1
    assert out["excluded_large"] == 0
    terms = {t["id"]: t for t in out["terms"]}
    n, big_n = 5, 20
    expected_p = {}
    for set_id, k, size in (("SET_A", 4, 5), ("SET_B", 1, 6), ("SET_C", 0, 4)):
        term = terms[set_id]
        assert term["overlap"] == k
        assert term["size"] == size
        # P(X >= k) for X ~ Hypergeom(N=20, K=size, n=5).
        p = float(hypergeom.sf(k - 1, big_n, size, n))
        expected_p[set_id] = p
        assert math.isclose(term["p_value"], p, rel_tol=1e-12)
        assert math.isclose(term["expected"], n * size / big_n, rel_tol=1e-12)
        assert math.isclose(term["fold_enrichment"], (k / n) / (size / big_n), rel_tol=1e-12)
    # Hand check for SET_A: C(5,4)C(15,1)/C(20,5) + C(5,5)C(15,0)/C(20,5) = 76/15504.
    assert math.isclose(terms["SET_A"]["p_value"], 76 / 15504, rel_tol=1e-12)
    assert terms["SET_C"]["p_value"] == 1.0
    order = ["SET_A", "SET_B", "SET_C"]
    adjusted = false_discovery_control([expected_p[s] for s in order], method="bh")
    for set_id, adj in zip(order, adjusted, strict=True):
        assert math.isclose(terms[set_id]["adj_p_value"], float(adj), rel_tol=1e-12)
    assert [t["id"] for t in out["terms"]] == order  # by p-value
    assert terms["SET_A"]["genes"] == ["G01", "G02", "G03", "G04"]
    assert out["method"].startswith("hypergeometric")
    assert out["adj_method"] == "BH"


def test_ENR_01_size_limits_use_members_within_the_background() -> None:
    out = _post(_body(min_size=5, max_size=5)).json()
    assert [t["id"] for t in out["terms"]] == ["SET_A"]
    assert out["excluded_small"] == 2  # SET_C (4) and SET_TINY (1)
    assert out["excluded_large"] == 1  # SET_B (6 measured members)


def test_ENR_01_hits_must_be_in_the_background() -> None:
    res = _post(_body(hits=["G01", "NOT_MEASURED"]))
    assert res.status_code == 422
    assert res.json()["code"] == "hits_not_in_background"
    assert res.json()["field"] == "hits"


def test_ENR_01_no_set_left_to_test_is_an_error_not_an_empty_answer() -> None:
    res = _post(_body(min_size=50))
    assert res.status_code == 422
    assert res.json()["code"] == "no_sets_tested"
