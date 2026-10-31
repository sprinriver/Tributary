# pyright: basic
"""Typed wrappers around the SciPy calls we use. SciPy ships incomplete type information (no stubs), so this
one module is checked in pyright's basic mode and every wrapper returns precise numpy types."""

from collections.abc import Callable
from typing import Any, cast

import numpy as np
import numpy.typing as npt
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
