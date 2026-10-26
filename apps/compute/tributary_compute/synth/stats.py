"""Small statistics helpers for simulated results (the real statistics run in pipelines or apps/compute)."""

import math

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]


def two_sided_normal_p(z: FloatArray) -> FloatArray:
    """Two-sided p-value of a standard-normal statistic, kept in (0, 1] (CLAUDE.md science conventions)."""
    p = np.array([math.erfc(abs(float(v)) / math.sqrt(2.0)) for v in z], dtype=np.float64)
    return np.clip(p, np.finfo(np.float64).tiny, 1.0)


def benjamini_hochberg(p: FloatArray) -> FloatArray:
    """BH-adjusted p-values (Benjamini & Hochberg 1995, doi:10.1111/j.2517-6161.1995.tb02031.x)."""
    n = p.size
    order = np.argsort(p, kind="stable")
    ranked = p[order] * n / np.arange(1, n + 1)
    adjusted = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n, dtype=np.float64)
    out[order] = np.minimum(adjusted, 1.0)
    return out


def four_pl_ratio(log10_dose: float, pec50: float, slope: float, front: float, back: float) -> float:
    """CurveCurator's 4-parameter log-logistic model in log10 molar dose (curve_curator/models.py, v0.6.0):
    y = back + (front - back) / (1 + 10^(slope * (x + pEC50))). `front` is the low-dose plateau."""
    return back + (front - back) / (1.0 + 10.0 ** (slope * (log10_dose + pec50)))
