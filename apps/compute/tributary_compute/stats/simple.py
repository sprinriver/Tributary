"""KDE, p-value adjustment, z-scores, PCA and 4PL fits (ARCHITECTURE §7) with the science-rule guards."""

import math

import numpy as np

from tributary_compute.contracts.fit4pl_request import Fit4plRequest
from tributary_compute.contracts.fit4pl_result import Fit4plResult
from tributary_compute.contracts.kde_request import KdeRequest
from tributary_compute.contracts.kde_result import KdeResult
from tributary_compute.contracts.pca_request import PcaRequest
from tributary_compute.contracts.pca_result import PcaResult
from tributary_compute.contracts.pvalues_request import PValuesRequest
from tributary_compute.contracts.pvalues_result import PValuesResult
from tributary_compute.contracts.zscore_request import ZScoreRequest
from tributary_compute.contracts.zscore_result import ZScoreResult
from tributary_compute.stats.errors import COMPUTE_VERSION, ComputeError
from tributary_compute.stats.matrix import complete, rectangular
from tributary_compute.stats.scipy_api import fdr, fit
from tributary_compute.stats.scipy_api import kde as gaussian_kde


def kde(request: KdeRequest) -> KdeResult:
    """Gaussian KDE (scipy.stats.gaussian_kde; Scott or Silverman bandwidth); grid spans +/-3 bandwidths."""
    values = np.asarray(request.values, dtype=np.float64)
    if not np.all(np.isfinite(values)):
        raise ComputeError("non_finite_values", "values", "Values must be finite numbers.")
    if len(np.unique(values)) < 2:
        raise ComputeError("too_few_distinct_values", "values", "A density needs at least 2 distinct values.")
    density, factor = gaussian_kde(values, request.bandwidth)
    h = factor * float(values.std(ddof=1))
    x = np.linspace(values.min() - 3 * h, values.max() + 3 * h, request.points)
    return KdeResult(x=x.tolist(), density=density(x).tolist(), bandwidth=h, compute_version=COMPUTE_VERSION)


def pvalues(request: PValuesRequest) -> PValuesResult:
    """BH (Benjamini & Hochberg 1995) or BY (Benjamini & Yekutieli 2001).

    Uses scipy.stats.false_discovery_control; nulls stay null and are not counted in m.
    """
    present = [p for p in request.p_values if p is not None]
    if any(not (math.isfinite(p) and 0 < p <= 1) for p in present):
        raise ComputeError("p_out_of_range", "p_values", "p-values must be finite and in (0, 1].")
    adjusted = iter(fdr(present, request.method.lower()) if present else [])
    return PValuesResult(
        adjusted=[None if p is None else next(adjusted) for p in request.p_values],
        method=request.method,
        compute_version=COMPUTE_VERSION,
    )


def zscore(request: ZScoreRequest) -> ZScoreResult:
    """(x - mean) / sample SD (ddof = 1) per row or column over present values; < 2 values or SD 0 → null."""
    rows = rectangular([v.root for v in request.values])
    lines = rows if request.axis == "rows" else [list(c) for c in zip(*rows, strict=True)]
    out: list[list[float | None]] = []
    for line in lines:
        present = [v for v in line if v is not None]
        sd = float(np.std(present, ddof=1)) if len(present) >= 2 else 0.0
        mean = float(np.mean(present)) if present else 0.0
        out.append([None if v is None or sd == 0 else (v - mean) / sd for v in line])
    if request.axis == "columns":
        out = [list(r) for r in zip(*out, strict=True)]
    return ZScoreResult.model_validate({"values": out, "compute_version": COMPUTE_VERSION})


def pca(request: PcaRequest) -> PcaResult:
    """PCA by SVD of the centred (optionally unit-variance) matrix, samples x features.

    The sign of each component is fixed so its largest-magnitude loading is positive (otherwise ambiguous).
    """
    data = complete(rectangular([v.root for v in request.values]))
    n, p = data.shape
    if n < 2:
        raise ComputeError("too_few_samples", "values", "PCA needs at least 2 samples.")
    if request.components > min(n, p):
        raise ComputeError("too_many_components", "components", f"At most {min(n, p)} components here.")
    x = data - data.mean(axis=0)
    if request.scale:
        sd = data.std(axis=0, ddof=1)
        if np.any(sd == 0):
            raise ComputeError("constant_feature", "values", "Scaling needs every feature to vary.")
        x = x / sd
    u, s, vt = np.linalg.svd(x, full_matrices=False)
    k = request.components
    signs = np.sign(vt[np.arange(len(vt)), np.argmax(np.abs(vt), axis=1)])
    u, vt = u * signs, vt * signs[:, None]
    var = s**2
    return PcaResult.model_validate(
        {
            "scores": (u[:, :k] * s[:k]).tolist(),
            "loadings": vt[:k].tolist(),
            "explained_variance_ratio": (var / var.sum())[:k].tolist(),
            "compute_version": COMPUTE_VERSION,
        }
    )


def _logistic(x: np.ndarray, bottom: float, top: float, log_ec50: float, hill: float) -> np.ndarray:
    # 4PL on log10 dose: bottom + (top - bottom) / (1 + 10^(hill·(x - log10 EC50))) (Sebaugh 2011,
    # doi:10.1002/pst.426). hill > 0 = response falls with dose.
    return bottom + (top - bottom) / (1 + np.power(10.0, hill * (x - log_ec50)))


def fit_4pl(request: Fit4plRequest) -> Fit4plResult:
    doses = np.asarray(request.doses_molar, dtype=np.float64)
    y = np.asarray(request.responses, dtype=np.float64)
    if len(doses) != len(y):
        raise ComputeError("length_mismatch", "responses", "One response per dose.")
    if np.any(doses <= 0):
        raise ComputeError("dose_not_positive", "doses_molar", "Doses must be > 0 M (log scale).")
    if len(np.unique(doses)) < 4:
        raise ComputeError(
            "too_few_dose_levels", "doses_molar", "A 4-parameter fit needs at least 4 dose levels."
        )
    if not np.all(np.isfinite(y)):
        raise ComputeError("non_finite_values", "responses", "Responses must be finite numbers.")
    x = np.log10(doses)
    p0 = [float(y.min()), float(y.max()), float(np.median(x)), 1.0]
    bounds = ([-np.inf, -np.inf, float(x.min()) - 2, -10.0], [np.inf, np.inf, float(x.max()) + 2, 10.0])
    try:
        params = fit(_logistic, x, y, p0, bounds)
    except RuntimeError as error:
        raise ComputeError("fit_failed", "responses", f"The curve fit did not converge: {error}") from error
    bottom, top, log_ec50, hill = params
    residual = y - _logistic(x, bottom, top, log_ec50, hill)
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - float(np.sum(residual**2)) / ss_tot if ss_tot > 0 else 0.0
    return Fit4plResult(
        top=top,
        bottom=bottom,
        ec50_molar=10**log_ec50,
        pec50=-log_ec50,
        hill_slope=hill,
        r2=r2,
        compute_version=COMPUTE_VERSION,
    )
