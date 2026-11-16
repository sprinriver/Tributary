"""Demo TPP-TR result table (Phase 46): the layout of TPP 3.40.2's `analyzeTPPTR` output, invented values.

Column names and definitions: packages/importers/src/tpp_tr/SOURCE.md (Bioconductor TPP 3.40.2, Artistic-2.0).
Values come from the package's melting-curve model, y(T) = (1 - Pl) / (1 + exp(-(a / T - b))) + Pl, plus
noise. Nothing is fitted and the p-values are invented: the file exercises the importer, not the statistics.
"""

import math
from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import Protein
from tributary_compute.synth.io import Cell, fmt

LABELS = ["126", "127L", "127H", "128L", "128H", "129L", "129H", "130L", "130H", "131L"]
TEMPERATURES = [37.0, 41.0, 44.0, 47.0, 50.0, 53.0, 56.0, 59.0, 63.0, 67.0]
EXPERIMENTS = ["Vehicle_1", "Vehicle_2", "CPD5_1", "CPD5_2"]
COMPARISONS = [("CPD5_1", "Vehicle_1"), ("CPD5_2", "Vehicle_2")]
N_PROTEINS = 30
# Melting-point shift (deg C) of the treatment, by protein index; the others do not shift.
SHIFTS = {0: 6.0, 1: 4.5, 2: 5.2, 3: -4.0}
HIGH_PLATEAU = {5, 6}  # vehicle plateau above TPP's default maxPlateau (0.3): no p-value
NOT_FITTED = (7, "CPD5_2")  # one curve without a fit


def _model(t: float, a: float, b: float, pl: float) -> float:
    return (1.0 - pl) / (1.0 + math.exp(-(a / t - b))) + pl


def _r(value: Cell) -> str:
    """R's write.table: NA for missing values, TRUE/FALSE for logicals."""
    if value is None:
        return "NA"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return fmt(value)


def write_tpp(out: Path, proteins: list[Protein], rng: np.random.Generator) -> list[str]:
    ps = proteins[:N_PROTEINS]
    grid = [30.0 + 0.01 * i for i in range(5001)]
    header = ["Protein_ID"]
    header += [f"norm_rel_fc_{label}_{e}" for e in EXPERIMENTS for label in LABELS]
    for e in EXPERIMENTS:
        header += [f"{p}_{e}" for p in ("a", "b", "meltPoint", "inflPoint", "slope", "plateau", "R_sq")]
    for t, v in COMPARISONS:
        header += [f"diff_meltP_{t}_vs_{v}", f"min_slope_{t}_vs_{v}", f"pVal_adj_{t}_vs_{v}"]
        header += [f"passed_filter_{v}_vs_{t}"]  # vehicle first, as in TPP's example table
    header += [
        "diff_meltP_Vehicle_1_vs_Vehicle_2",
        "min_pVals_less_0.1_and_max_pVals_less_0.2",
        "meltP_diffs_have_same_sign",
        "meltP_diffs_T_vs_V_greater_V1_vs_V2",
        "minSlopes_less_than_0.06",
        "fulfills_all_4_requirements",
    ]
    header += [f"protein_identified_in_{e}" for e in EXPERIMENTS]
    header += [f"model_converged_{e}" for e in EXPERIMENTS]
    header += [f"sufficient_data_for_fit_{e}" for e in EXPERIMENTS]
    header += [f"{q}_{e}" for e in EXPERIMENTS for q in ("qssm", "qupm")]

    rows: list[list[Cell]] = []
    for i, p in enumerate(ps):
        tm0 = float(rng.normal(52.0, 3.0))
        fcs: dict[str, list[Cell]] = {}
        par: dict[str, dict[str, float | None]] = {}
        for e in EXPERIMENTS:
            treated = e.startswith("CPD")
            b = float(rng.uniform(30.0, 60.0))
            pl = float(rng.uniform(0.32, 0.45)) if i in HIGH_PLATEAU else float(rng.uniform(0.0, 0.1))
            a = b * (tm0 + float(rng.normal(0.0, 0.4)) + (SHIFTS.get(i, 0.0) if treated else 0.0))
            noise = rng.normal(0.0, 0.03, size=len(TEMPERATURES))
            if (i, e) == NOT_FITTED:
                fcs[e] = [None] * len(LABELS)
                par[e] = dict.fromkeys(("a", "b", "meltPoint", "inflPoint", "slope", "plateau", "R_sq"))
                continue
            truth = [_model(t, a, b, pl) for t in TEMPERATURES]
            # Fold changes are relative to the lowest temperature (TPP tpptrImport): the first is 1.
            measured = [1.0] + [max(0.0, y + float(n)) for y, n in zip(truth[1:], noise[1:], strict=True)]
            fcs[e] = list(measured)
            curve = [_model(t, a, b, pl) for t in grid]
            slopes = [(curve[k + 1] - curve[k - 1]) / 0.02 for k in range(1, len(grid) - 1)]
            k_min = min(range(len(slopes)), key=slopes.__getitem__)
            mean = sum(measured) / len(measured)
            ss_tot = sum((y - mean) ** 2 for y in measured)
            ss_res = sum((y - f) ** 2 for y, f in zip(measured, truth, strict=True))
            par[e] = {
                "a": a,
                "b": b,
                # The curve crosses 0.5 where a / T - b = -ln(0.5 / (0.5 - Pl)).
                "meltPoint": a / (b - math.log(0.5 / (0.5 - pl))),
                "inflPoint": grid[k_min + 1],
                "slope": slopes[k_min],
                "plateau": pl,
                "R_sq": 1.0 - ss_res / ss_tot,
            }
        row: list[Cell] = [p.genes[0]]
        row += [c for e in EXPERIMENTS for c in fcs[e]]
        for e in EXPERIMENTS:
            row += [par[e][k] for k in ("a", "b", "meltPoint", "inflPoint", "slope", "plateau", "R_sq")]
        diffs: list[float | None] = []
        min_slopes: list[float | None] = []
        pvals: list[float | None] = []
        for t, v in COMPARISONS:
            mt, mv = par[t]["meltPoint"], par[v]["meltPoint"]
            st, sv = par[t]["slope"], par[v]["slope"]
            rt, rv, plv = par[t]["R_sq"], par[v]["R_sq"], par[v]["plateau"]
            diff = None if mt is None or mv is None else mt - mv
            min_slope = None if st is None or sv is None else min(st, sv)
            # TPP's filter: both R2 above 0.8 and the vehicle plateau below 0.3.
            passed = (
                rt is not None and rv is not None and plv is not None and rt > 0.8 and rv > 0.8 and plv < 0.3
            )
            pval = None
            if passed:
                low, high = (1e-4, 1e-2) if i in SHIFTS else (0.2, 1.0)
                pval = float(rng.uniform(low, high))
            diffs.append(diff)
            min_slopes.append(min_slope)
            pvals.append(pval)
            row += [diff, min_slope, pval, passed]
        mv1, mv2 = par["Vehicle_1"]["meltPoint"], par["Vehicle_2"]["meltPoint"]
        vehicle_diff = None if mv1 is None or mv2 is None else mv1 - mv2
        have = all(x is not None for x in (*diffs, *min_slopes, vehicle_diff))
        check_p = None if None in pvals else (min(pvals) < 0.1 and max(pvals) < 0.2)  # type: ignore[type-var]
        check_sign = None if not have else (diffs[0] > 0) == (diffs[1] > 0)  # type: ignore[operator]
        check_size = None if not have else min(abs(d) for d in diffs) > abs(vehicle_diff)  # type: ignore[arg-type]
        check_slope = None if not have else max(min_slopes) < -0.06  # type: ignore[type-var,operator]
        checks: list[bool | None] = [check_p, check_sign, check_size, check_slope]
        row += [vehicle_diff, *checks, None if None in checks else all(checks)]
        row += [True] * len(EXPERIMENTS)
        row += [(i, e) != NOT_FITTED for e in EXPERIMENTS]
        row += [True] * len(EXPERIMENTS)
        row += [int(x) for _ in EXPERIMENTS for x in (rng.integers(4, 60), rng.integers(2, 20))]
        rows.append(row)

    path = out / "tpp" / "tr_results.tsv"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header)] + ["\t".join(_r(c) for c in row) for row in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ["tools/tpp/tr_results.tsv"]
