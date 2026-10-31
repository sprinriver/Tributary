# pyright: basic
# Direct SciPy calls are the reference here; SciPy ships incomplete type information.
"""Phase 14 statistics: clustering (+ bootstrap), KDE, p-value adjustment, z-score, PCA, 4PL fits."""

import asyncio
from typing import Any

import httpx
import numpy as np
import pytest
from scipy.cluster import hierarchy
from scipy.spatial.distance import pdist
from scipy.stats import false_discovery_control

from tributary_compute.main import app

SCIPY_METHOD = {"ward.D2": "ward"}
SCIPY_METRIC = {"manhattan": "cityblock", "maximum": "chebyshev"}


def r_canberra(u: Any, v: Any) -> float:
    """R stats::dist canberra: 0/0 terms are dropped and the sum rescaled by p / (p - dropped)."""
    terms = [abs(a - b) / abs(a + b) for a, b in zip(u, v, strict=True) if not (a - b == 0 and a + b == 0)]
    return sum(terms) * len(u) / len(terms) if terms else 0.0


def post(path: str, body: dict[str, Any]) -> httpx.Response:
    async def go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://compute") as client:
            return await client.post(path, json=body)

    return asyncio.run(go())


def matrix(rows: int = 12, cols: int = 6, seed: int = 7) -> list[list[float]]:
    rng = np.random.default_rng(seed)
    data = rng.normal(size=(rows, cols))
    data[: rows // 2] += 3  # two row groups
    return [[float(v) for v in row] for row in data]


def cluster_body(values: Any, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "values": values,
        "row_labels": [f"r{i}" for i in range(len(values))],
        "column_labels": [f"c{j}" for j in range(len(values[0]))],
        "axis": "rows",
        "method": "average",
        "metric": "euclidean",
        "leaf_ordering": "default",
        "bootstrap_n": 0,
        "seed": 1,
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize(
    ("method", "metric"),
    [
        (m, d)
        for m in ["average", "single", "complete", "weighted"]
        for d in ["euclidean", "manhattan", "maximum", "canberra", "cosine", "correlation"]
    ]
    + [("centroid", "euclidean"), ("median", "euclidean"), ("ward.D2", "euclidean")],
)
def test_VIZ_03_clustering_matches_direct_scipy(method: str, metric: str) -> None:
    values = matrix()
    res = post("/stats/cluster", cluster_body(values, method=method, metric=metric))
    assert res.status_code == 200, res.text
    data = np.asarray(values)
    # canberra follows R's dist() (v1 used R names): sum |x - y| / |x + y|, not SciPy's |x| + |y| denominator.
    ref_metric: Any = r_canberra if metric == "canberra" else SCIPY_METRIC.get(metric, metric)
    expected = hierarchy.linkage(pdist(data, metric=ref_metric), method=SCIPY_METHOD.get(method, method))
    tree = res.json()["rows"]
    assert np.allclose(np.asarray(tree["linkage"]), expected)
    assert tree["order"] == [int(i) for i in hierarchy.leaves_list(expected)]
    assert res.json()["columns"] is None


def test_VIZ_03_optimal_leaf_ordering_and_both_axes() -> None:
    values = matrix()
    res = post("/stats/cluster", cluster_body(values, axis="both", leaf_ordering="optimal"))
    assert res.status_code == 200, res.text
    data = np.asarray(values)
    for key, axis_data in (("rows", data), ("columns", data.T)):
        d = pdist(axis_data)
        expected = hierarchy.optimal_leaf_ordering(hierarchy.linkage(d, method="average"), d)
        assert res.json()[key]["order"] == [int(i) for i in hierarchy.leaves_list(expected)]


def test_VIZ_03_columns_only_clusters_columns() -> None:
    res = post("/stats/cluster", cluster_body(matrix(), axis="columns"))
    assert res.status_code == 200, res.text
    assert res.json()["rows"] is None
    assert len(res.json()["columns"]["order"]) == 6


def test_VIZ_03_bootstrap_is_deterministic_with_a_seed() -> None:
    body = cluster_body(matrix(), bootstrap_n=50, seed=42)
    first = post("/stats/cluster", body).json()
    again = post("/stats/cluster", body).json()
    other = post("/stats/cluster", {**body, "seed": 43}).json()
    support = first["rows"]["support"]
    assert support == again["rows"]["support"]
    assert len(support) == len(first["rows"]["linkage"])
    assert all(0 <= s <= 1 for s in support)
    # The final merge contains every leaf, so every resample has it.
    assert support[-1] == 1
    assert first["seed"] == 42
    assert support != other["rows"]["support"] or first == other


def test_VIZ_03_two_clear_groups_have_high_support() -> None:
    res = post("/stats/cluster", cluster_body(matrix(rows=10, cols=30), bootstrap_n=100, seed=3)).json()
    tree = res["rows"]
    n = 10
    # Find the merges that form each planted group (rows 0-4 and 5-9) and check their support.
    members: dict[int, set[int]] = {i: {i} for i in range(n)}
    for k, (a, b, _h, _s) in enumerate(tree["linkage"]):
        members[n + k] = members[int(a)] | members[int(b)]
        if members[n + k] in ({0, 1, 2, 3, 4}, {5, 6, 7, 8, 9}):
            assert tree["support"][k] >= 0.9


@pytest.mark.parametrize(
    ("body", "code", "field"),
    [
        (cluster_body([[1.0, 2.0]]), "too_few_rows", "values"),
        (cluster_body([[1.0], [2.0]], axis="columns"), "too_few_columns", "values"),
        (cluster_body([[1.0, None], [2.0, 3.0]]), "missing_values", "values"),
        (
            cluster_body([[1.0, 2.0], [2.0, 3.0]], method="ward.D2", metric="manhattan"),
            "method_requires_euclidean",
            "metric",
        ),
        (cluster_body([[1.0, 2.0], [2.0, 3.0]], row_labels=["a"]), "label_count", "row_labels"),
        (cluster_body([[1.0, 2.0], [2.0]]), "ragged_matrix", "values"),
        (cluster_body([[1.0, 1.0], [2.0, 3.0]], metric="correlation"), "constant_vector", "values"),
    ],
)
def test_VIZ_03_guards_return_structured_errors(body: dict[str, Any], code: str, field: str) -> None:
    res = post("/stats/cluster", body)
    assert res.status_code == 422, res.text
    assert res.json()["code"] == code
    assert res.json()["field"] == field
    assert res.json()["message"]


def test_VIZ_03_kde_matches_scipy_and_guards_distinct_values() -> None:
    from scipy.stats import gaussian_kde

    values = [0.1, 0.4, 0.4, 0.9, 1.3, 2.0]
    res = post("/stats/kde", {"values": values, "points": 64, "bandwidth": "scott"}).json()
    kde = gaussian_kde(values, bw_method="scott")
    assert np.allclose(res["density"], kde(np.asarray(res["x"])))
    bad = post("/stats/kde", {"values": [1.0, 1.0, 1.0], "points": 64, "bandwidth": "scott"})
    assert bad.status_code == 422
    assert bad.json() == {
        "code": "too_few_distinct_values",
        "field": "values",
        "message": bad.json()["message"],
    }


def test_VIZ_03_pvalue_adjustment_matches_scipy_and_keeps_nulls() -> None:
    p = [0.01, 0.04, None, 0.03, 0.2]
    res = post("/stats/pvalues", {"p_values": p, "method": "BH"}).json()
    expected = false_discovery_control([0.01, 0.04, 0.03, 0.2], method="bh")
    assert res["adjusted"][2] is None
    assert np.allclose([v for v in res["adjusted"] if v is not None], expected)
    for bad in ([0.0, 0.5], [1.5], [-0.01]):
        r = post("/stats/pvalues", {"p_values": bad, "method": "BH"})
        assert r.status_code == 422
        assert r.json()["code"] == "p_out_of_range"


def test_VIZ_03_zscore_rows_with_sample_sd_and_constant_rows_null() -> None:
    res = post(
        "/stats/zscore", {"values": [[1.0, 2.0, 3.0], [5.0, 5.0, 5.0], [1.0, None, 3.0]], "axis": "rows"}
    )
    out = res.json()["values"]
    assert np.allclose(out[0], [-1.0, 0.0, 1.0])
    assert out[1] == [None, None, None]
    assert out[2][1] is None
    assert np.allclose([out[2][0], out[2][2]], [-0.7071067811865475, 0.7071067811865475])


def test_VIZ_03_pca_matches_svd_reference() -> None:
    data = np.asarray(matrix(rows=8, cols=5))
    res = post("/stats/pca", {"values": data.tolist(), "scale": False, "components": 2}).json()
    centred = data - data.mean(axis=0)
    _u, s, vt = np.linalg.svd(centred, full_matrices=False)
    var = s**2 / (len(data) - 1)
    assert np.allclose(res["explained_variance_ratio"], (var / var.sum())[:2])
    # Signs are fixed so the largest loading of each component is positive.
    scores = np.asarray(res["scores"])
    assert np.allclose(np.abs(scores), np.abs(centred @ vt[:2].T))
    assert post("/stats/pca", {"values": [[1.0, 2.0]], "scale": False, "components": 1}).status_code == 422


def test_VIZ_03_fit_4pl_recovers_parameters_and_guards_dose_levels() -> None:
    doses = [1e-9, 3e-9, 1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6]
    ec50, hill, top, bottom = 5e-8, 1.2, 1.0, 0.1
    responses = [bottom + (top - bottom) / (1 + (d / ec50) ** hill) for d in doses]
    res = post("/stats/fit-4pl", {"doses_molar": doses, "responses": responses})
    assert res.status_code == 200, res.text
    fit = res.json()
    assert fit["ec50_molar"] == pytest.approx(ec50, rel=1e-3)
    assert fit["pec50"] == pytest.approx(-np.log10(ec50), abs=1e-3)
    assert fit["r2"] == pytest.approx(1.0, abs=1e-6)
    few = post("/stats/fit-4pl", {"doses_molar": doses[:3], "responses": responses[:3]})
    assert few.status_code == 422
    assert few.json()["code"] == "too_few_dose_levels"
    zero = post("/stats/fit-4pl", {"doses_molar": [0.0, *doses[1:]], "responses": responses})
    assert zero.json()["code"] == "dose_not_positive"


def test_VIZ_03_canberra_uses_r_definition() -> None:
    # Opposite signs: R gives |1 - (-1)| / |1 + (-1)| = inf (undefined); SciPy would give 2.
    values = [[1.0, 2.0, 4.0], [2.0, 2.0, 1.0], [3.0, 1.0, 1.0]]
    res = post("/stats/cluster", cluster_body(values, metric="canberra", method="single"))
    assert res.status_code == 200, res.text
    pairs = [r_canberra(values[i], values[j]) for i, j in ((0, 1), (0, 2), (1, 2))]
    assert res.json()["rows"]["linkage"][0][2] == pytest.approx(min(pairs))
    bad = post("/stats/cluster", cluster_body([[1.0, -1.0], [-1.0, 1.0]], metric="canberra"))
    assert bad.status_code == 422
    assert bad.json()["code"] == "undefined_distance"


def test_VIZ_03_bootstrap_reports_valid_resamples() -> None:
    tree = post("/stats/cluster", cluster_body(matrix(), bootstrap_n=30, seed=5)).json()["rows"]
    assert tree["bootstrap_valid"] == 30
    assert post("/stats/cluster", cluster_body(matrix())).json()["rows"]["bootstrap_valid"] is None


def test_VIZ_03_fit_4pl_reports_top_above_bottom_and_flags_extrapolation() -> None:
    doses = [1e-9, 3e-9, 1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6]
    rising = [0.1 + 0.9 / (1 + (5e-8 / d) ** 1.2) for d in doses]
    fit = post("/stats/fit-4pl", {"doses_molar": doses, "responses": rising}).json()
    assert fit["top"] > fit["bottom"]
    assert fit["hill_slope"] < 0
    assert fit["ec50_molar"] == pytest.approx(5e-8, rel=1e-3)
    assert fit["ec50_in_range"] is True
    far = [0.1 + 0.9 / (1 + (d / 1e-4) ** 1.2) for d in doses]
    assert post("/stats/fit-4pl", {"doses_molar": doses, "responses": far}).json()["ec50_in_range"] is False
