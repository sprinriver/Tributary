"""Hierarchical clustering with optional bootstrap support (SciPy; no pvclust in PyPI - ARCHITECTURE §7).

Methods/metrics follow R's hclust/dist names (REFERENCE_V1 §7): ward.D2 is SciPy's `ward` on Euclidean
distances (Murtagh & Legendre 2014, doi:10.1007/s00357-014-9161-z); maximum = Chebyshev; manhattan =
city block. Support is the bootstrap probability of each clade: the share of resamples (columns drawn with
replacement when clustering rows, and vice versa) whose tree contains the same set of leaves
(Felsenstein 1985, doi:10.1111/j.1558-5646.1985.tb00420.x). Resampling uses numpy's PCG64 seeded with
the request seed.
"""

from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

from tributary_compute.contracts.cluster_request import ClusterRequest
from tributary_compute.contracts.cluster_result import ClusterResult
from tributary_compute.stats.errors import COMPUTE_VERSION, ComputeError
from tributary_compute.stats.matrix import complete, rectangular
from tributary_compute.stats.scipy_api import distances, leaves, linkage, optimal_leaf_ordering

# `weighted` is WPGMA (R's "mcquitty"); v1 used the SciPy name.
SCIPY_METHOD = {"ward.D2": "ward"}
SCIPY_METRIC = {"manhattan": "cityblock", "maximum": "chebyshev"}
EUCLIDEAN_ONLY = {"centroid", "median", "ward.D2"}

Linkage = npt.NDArray[np.float64]


def canberra_r(u: npt.NDArray[np.float64], v: npt.NDArray[np.float64]) -> float:
    """R's dist(method = "canberra"): sum |u - v| / |u + v|; 0/0 terms are omitted and the sum is scaled by
    p / (p - omitted) (R stats::dist documentation). SciPy's canberra divides by |u| + |v| instead, which
    differs whenever signs differ (log fold changes, z-scores)."""
    num = np.abs(u - v)
    den = np.abs(u + v)
    keep = ~((num == 0) & (den == 0))
    if not keep.any():
        return 0.0
    with np.errstate(divide="ignore", invalid="ignore"):
        total = float(np.sum(num[keep] / den[keep]))
    return total * len(u) / int(keep.sum())


def _distances(data: npt.NDArray[np.float64], metric: str) -> npt.NDArray[np.float64] | None:
    d = distances(data, canberra_r if metric == "canberra" else SCIPY_METRIC.get(metric, metric))
    return d if np.all(np.isfinite(d)) else None


def _clades(z: Linkage, n: int) -> list[frozenset[int]]:
    members: list[frozenset[int]] = [frozenset([i]) for i in range(n)]
    for a, b, _h, _s in z:
        members.append(members[int(a)] | members[int(b)])
    return members[n:]


def _tree(
    data: npt.NDArray[np.float64], request: ClusterRequest, rng: np.random.Generator, axis_name: str
) -> dict[str, object]:
    if data.shape[0] < 2:
        code = "too_few_rows" if axis_name == "rows" else "too_few_columns"
        raise ComputeError(code, "values", f"Clustering {axis_name} needs at least 2 {axis_name}.")
    d = _distances(data, request.metric)
    if d is None:
        constant = request.metric in ("correlation", "cosine")
        raise ComputeError(
            "constant_vector" if constant else "undefined_distance",
            "values",
            f"Some {axis_name} have no variation, so the {request.metric} distance is undefined."
            if constant
            else f"The {request.metric} distance is undefined for some {axis_name} (canberra: x + y = 0).",
        )
    method = SCIPY_METHOD.get(request.method, request.method)
    z = linkage(d, method)
    if request.leaf_ordering == "optimal":
        z = optimal_leaf_ordering(z, d)
    support: list[float] | None = None
    valid = 0
    if request.bootstrap_n > 0:
        clades = _clades(z, data.shape[0])
        hits = np.zeros(len(clades))
        for _ in range(request.bootstrap_n):
            cols = rng.integers(0, data.shape[1], size=data.shape[1])
            bd = _distances(data[:, cols], request.metric)
            if bd is None:
                continue  # an all-constant resample has no tree; it counts for neither side
            valid += 1
            seen = set(_clades(linkage(bd, method), data.shape[0]))
            hits += [c in seen for c in clades]
        support = [float(h / valid) for h in hits] if valid else None
    return {
        "order": leaves(z),
        "linkage": [[float(v) for v in row] for row in z],
        "support": support,
        # Resamples that produced a tree (support is a share of these, not of bootstrap_n).
        "bootstrap_valid": valid if request.bootstrap_n > 0 else None,
    }


def _labels(labels: Sequence[str], expected: int, field: str) -> None:
    if len(labels) != expected:
        raise ComputeError("label_count", field, f"Expected {expected} labels, got {len(labels)}.")


def cluster(request: ClusterRequest) -> ClusterResult:
    rows = rectangular([v.root for v in request.values])
    _labels(request.row_labels, len(rows), "row_labels")
    _labels(request.column_labels, len(rows[0]), "column_labels")
    if request.method in EUCLIDEAN_ONLY and request.metric != "euclidean":
        raise ComputeError(
            "method_requires_euclidean",
            "metric",
            f"{request.method} linkage is defined for Euclidean distances only.",
        )
    data = complete(rows)
    rng = np.random.default_rng(request.seed)
    row_tree = _tree(data, request, rng, "rows") if request.axis in ("rows", "both") else None
    col_tree = _tree(data.T, request, rng, "columns") if request.axis in ("columns", "both") else None
    return ClusterResult.model_validate(
        {
            "rows": row_tree,
            "columns": col_tree,
            "seed": request.seed,
            "method": request.method,
            "metric": request.metric,
            "compute_version": COMPUTE_VERSION,
        }
    )
