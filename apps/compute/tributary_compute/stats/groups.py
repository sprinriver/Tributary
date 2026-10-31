"""Group comparisons and summaries for bar, box/violin, histogram p-values, error bars and QC CVs.

p-values: Welch's t-test (Welch 1947), Mann-Whitney U (Mann & Whitney 1947), two-sample
Kolmogorov-Smirnov, one-way ANOVA, Kruskal-Wallis (scipy.stats). Pairwise tests compare each group with the
first (reference) and are BH-adjusted across the comparisons. These are exploratory display statistics, not
the experiment's analysis.
"""

import math

import numpy as np

from tributary_compute.contracts.group_summary_request import GroupSummaryRequest
from tributary_compute.contracts.group_summary_result import GroupSummaryResult
from tributary_compute.contracts.group_test_request import GroupTestRequest
from tributary_compute.contracts.group_test_result import GroupTestResult
from tributary_compute.stats.errors import COMPUTE_VERSION, ComputeError
from tributary_compute.stats.scipy_api import fdr, overall_p, t_quantile, two_sample_p

PAIRWISE = {"welch_t", "mann_whitney", "ks"}


def _finite(values: list[float]) -> list[float]:
    if any(not math.isfinite(v) for v in values):
        raise ComputeError("non_finite_values", "groups", "Values must be finite numbers.")
    return values


def group_test(request: GroupTestRequest) -> GroupTestResult:
    groups = [(g.name, np.asarray(_finite(g.values), dtype=np.float64)) for g in request.groups]
    usable = [(n, v) for n, v in groups if len(v) >= 2]
    if len(usable) < 2 or len(usable) != len(groups):
        raise ComputeError(
            "too_few_groups",
            "groups",
            "p-values need at least 2 groups with at least 2 values each.",
        )
    if request.method in PAIRWISE:
        ref_name, ref = groups[0]
        raw = [two_sample_p(request.method, ref, v) for _n, v in groups[1:]]
        if any(not math.isfinite(p) for p in raw):
            raise ComputeError(
                "constant_groups",
                "groups",
                "A p-value is undefined: some groups have no variation (e.g. all values equal).",
            )
        adjusted = fdr(raw, "bh")
        comparisons = [
            {"group": n, "reference": ref_name, "p": p, "p_adj": q}
            for (n, _v), p, q in zip(groups[1:], raw, adjusted, strict=True)
        ]
        overall = None
    else:
        comparisons = []
        overall = overall_p(request.method, [v for _n, v in groups])
    return GroupTestResult.model_validate(
        {
            "method": request.method,
            "overall_p": overall,
            "comparisons": comparisons,
            "adj_method": "BH",
            "compute_version": COMPUTE_VERSION,
        }
    )


def group_summary(request: GroupSummaryRequest) -> GroupSummaryResult:
    out: list[dict[str, object]] = []
    for g in request.groups:
        v = np.asarray(_finite(g.values), dtype=np.float64)
        n = len(v)
        mean = float(v.mean()) if n else None
        sd = float(v.std(ddof=1)) if n >= 2 else None
        sem = sd / math.sqrt(n) if sd is not None else None
        out.append(
            {
                "name": g.name,
                "n": n,
                "mean": mean,
                "sd": sd,
                "sem": sem,
                # 95% t interval half-width: t(0.975, n - 1) * SEM.
                "ci95": t_quantile(0.975, n - 1) * sem if sem is not None else None,
                "median": float(np.median(v)) if n else None,
                "cv": sd / mean if sd is not None and mean else None,
            }
        )
    return GroupSummaryResult.model_validate({"groups": out, "compute_version": COMPUTE_VERSION})
