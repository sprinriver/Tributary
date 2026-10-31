# pyright: basic
# Direct SciPy calls are the reference here; SciPy ships incomplete type information.
"""Phase 15 group statistics: p-values between groups and per-group summaries (error bars, CVs)."""

import asyncio
from typing import Any

import httpx
import numpy as np
import pytest
from scipy import stats

from tributary_compute.main import app


def post(path: str, body: dict[str, Any]) -> httpx.Response:
    async def go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
            return await client.post(path, json=body)

    return asyncio.run(go())


GROUPS = [
    {"name": "DMSO", "values": [1.0, 1.2, 0.9, 1.1, 1.05]},
    {"name": "CPD-1", "values": [1.6, 1.8, 1.7, 1.9, 1.65]},
    {"name": "CPD-2", "values": [1.0, 1.4, 1.2, 0.8, 1.3]},
]


@pytest.mark.parametrize(
    ("method", "reference"),
    [
        ("welch_t", lambda a, b: stats.ttest_ind(b, a, equal_var=False).pvalue),
        ("mann_whitney", lambda a, b: stats.mannwhitneyu(b, a, alternative="two-sided").pvalue),
        ("ks", lambda a, b: stats.ks_2samp(b, a).pvalue),
    ],
)
def test_VIZ_05_pairwise_tests_match_scipy_with_bh(method: str, reference: Any) -> None:
    res = post("/stats/group-test", {"groups": GROUPS, "method": method})
    assert res.status_code == 200, res.text
    body = res.json()
    raw = [reference(GROUPS[0]["values"], g["values"]) for g in GROUPS[1:]]
    assert [c["group"] for c in body["comparisons"]] == ["CPD-1", "CPD-2"]
    assert all(c["reference"] == "DMSO" for c in body["comparisons"])
    assert np.allclose([c["p"] for c in body["comparisons"]], raw)
    assert np.allclose([c["p_adj"] for c in body["comparisons"]], stats.false_discovery_control(raw, method="bh"))
    assert body["adj_method"] == "BH"
    assert body["overall_p"] is None


@pytest.mark.parametrize(
    ("method", "reference"),
    [("anova", stats.f_oneway), ("kruskal", stats.kruskal)],
)
def test_VIZ_05_multi_group_tests_match_scipy(method: str, reference: Any) -> None:
    body = post("/stats/group-test", {"groups": GROUPS, "method": method}).json()
    assert body["overall_p"] == pytest.approx(reference(*[g["values"] for g in GROUPS]).pvalue)
    assert body["comparisons"] == []


def test_VIZ_06_group_tests_need_two_groups_with_two_values() -> None:
    for groups in ([GROUPS[0]], [GROUPS[0], {"name": "x", "values": [1.0]}]):
        res = post("/stats/group-test", {"groups": groups, "method": "welch_t"})
        assert res.status_code == 422
        assert res.json()["code"] == "too_few_groups"
        assert res.json()["field"] == "groups"


def test_VIZ_05_group_summary_sd_sem_ci95_cv() -> None:
    body = post("/stats/group-summary", {"groups": GROUPS + [{"name": "one", "values": [2.0]}]}).json()
    first = body["groups"][0]
    v = np.asarray(GROUPS[0]["values"])
    sd = v.std(ddof=1)
    assert first["n"] == 5
    assert first["mean"] == pytest.approx(v.mean())
    assert first["sd"] == pytest.approx(sd)
    assert first["sem"] == pytest.approx(sd / np.sqrt(5))
    assert first["ci95"] == pytest.approx(stats.t.ppf(0.975, 4) * sd / np.sqrt(5))
    assert first["median"] == pytest.approx(np.median(v))
    assert first["cv"] == pytest.approx(sd / v.mean())
    single = body["groups"][-1]
    assert single["n"] == 1
    assert single["sd"] is None
    assert single["ci95"] is None
