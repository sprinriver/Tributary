# pyright: basic
"""Typed wrappers around the SciPy calls we use. SciPy ships incomplete type information (no stubs), so this
one module is checked in pyright's basic mode and every wrapper returns precise numpy types."""

from collections.abc import Callable
from typing import Any, cast

import numpy as np
import numpy.typing as npt
from scipy import stats as _stats
from scipy.cluster import hierarchy
from scipy.optimize import curve_fit
from scipy.spatial.distance import pdist
from scipy.stats import false_discovery_control, gaussian_kde

Array = npt.NDArray[np.float64]


def distances(data: Array, metric: str | Callable[[Array, Array], float]) -> Array:
    return np.asarray(pdist(data, metric=cast(Any, metric)), dtype=np.float64)


def linkage(condensed: Array, method: str) -> Array:
    return np.asarray(hierarchy.linkage(condensed, method=method), dtype=np.float64)


def optimal_leaf_ordering(z: Array, condensed: Array) -> Array:
    return np.asarray(hierarchy.optimal_leaf_ordering(z, condensed), dtype=np.float64)


def leaves(z: Array) -> list[int]:
    return [int(i) for i in hierarchy.leaves_list(z)]


def fdr(p: list[float], method: str) -> list[float]:
    return [float(v) for v in false_discovery_control(p, method=method)]


def kde(values: Array, bandwidth: str) -> tuple[Callable[[Array], Array], float]:
    """The density function and its bandwidth factor (multiply by the sample SD for data units)."""
    density = gaussian_kde(values, bw_method=bandwidth)
    factor = cast(float, density.factor)
    return (lambda x: np.asarray(density(x), dtype=np.float64)), factor


def fit(
    model: Callable[..., Array], x: Array, y: Array, p0: list[float], bounds: tuple[list[float], list[float]]
) -> list[float]:
    params, _cov = curve_fit(model, x, y, p0=p0, bounds=bounds, maxfev=20000)
    return [float(v) for v in params]


def two_sample_p(method: str, a: Array, b: Array) -> float:
    """b vs a: Welch's t (unequal variances), Mann-Whitney U (two-sided), or two-sample Kolmogorov-Smirnov."""
    if method == "welch_t":
        return float(cast(Any, _stats.ttest_ind(b, a, equal_var=False)).pvalue)
    if method == "mann_whitney":
        return float(cast(Any, _stats.mannwhitneyu(b, a, alternative="two-sided")).pvalue)
    return float(cast(Any, _stats.ks_2samp(b, a)).pvalue)


def overall_p(method: str, groups: list[Array]) -> float:
    """One-way ANOVA (F test) or Kruskal-Wallis H test across all groups."""
    test = _stats.f_oneway if method == "anova" else _stats.kruskal
    return float(cast(Any, test(*groups)).pvalue)


def t_quantile(q: float, df: int) -> float:
    return float(_stats.t.ppf(q, df))


def hypergeom_sf(k: int, population: int, successes: int, draws: int) -> float:
    """P(X > k) for X ~ Hypergeometric(population, successes, draws) (scipy.stats.hypergeom.sf)."""
    return float(_stats.hypergeom.sf(k, population, successes, draws))
