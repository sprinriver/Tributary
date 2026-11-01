"""Matrix input checks shared by clustering, z-scores and PCA."""

from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

from tributary_compute.stats.errors import ComputeError


def rectangular(rows: Sequence[Sequence[float | None]], field: str = "values") -> list[list[float | None]]:
    width = len(rows[0])
    if any(len(r) != width for r in rows):
        raise ComputeError("ragged_matrix", field, "Every row needs the same number of values.")
    return [list(r) for r in rows]


def complete(rows: list[list[float | None]], field: str = "values") -> npt.NDArray[np.float64]:
    """A float matrix with no missing or non-finite values (missing values are never imputed here)."""
    if any(v is None for r in rows for v in r):
        missing = sum(1 for r in rows if any(v is None for v in r))
        raise ComputeError(
            "missing_values",
            field,
            f"{missing} row(s) have missing values; drop them or choose complete columns (no imputation).",
        )
    data = np.asarray(rows, dtype=np.float64)
    if not np.all(np.isfinite(data)):
        raise ComputeError("non_finite_values", field, "Values must be finite numbers.")
    return data
