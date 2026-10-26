"""Sample manifests in the seed template's columns (SPEC §6.1); every value passes validateManifest."""

from collections.abc import Sequence
from dataclasses import dataclass

from tributary_compute.synth.catalog import DOSES, TMT10_CHANNELS, ExperimentPlan

COLUMNS = (
    "sample_key",
    "source_name",
    "organism",
    "cell_line",
    "compound_id",
    "vehicle",
    "dose",
    "time",
    "condition",
    "replicate_group",
    "biological_replicate",
    "plate",
    "well",
    "label_channel",
    "raw_file",
    "instrument_run",
)

VEHICLE = "DMSO"
NA = "not applicable"


@dataclass(frozen=True)
class Sample:
    key: str
    condition: str
    dose_molar: float | None  # None = vehicle
    replicate: int
    cells: dict[str, str]


def _well(index: int) -> str:
    return f"{'ABCDEFGH'[index // 12]}{index % 12 + 1:02d}"


def _sample(
    plan: ExperimentPlan,
    index: int,
    condition: str,
    dose: tuple[float, str] | None,
    replicate: int,
    run: str,
    channel: str = NA,
) -> Sample:
    key = f"{plan.key}-S{index + 1:02d}"
    treated = dose is not None and plan.compound is not None
    cells = {
        "sample_key": key,
        "source_name": f"{plan.cell_line} culture {index + 1}",
        "organism": "Homo sapiens",
        "cell_line": plan.cell_line,
        "compound_id": plan.compound if treated and plan.compound else "vehicle",
        "vehicle": VEHICLE,
        "dose": dose[1] if dose else NA,
        "time": "24 h" if plan.design != "screen" else "14 d",
        "condition": condition,
        "replicate_group": condition,
        "biological_replicate": str(replicate),
        "plate": f"{plan.key}-P1" if plan.assay_type.startswith("proteomics") else NA,
        "well": _well(index) if plan.assay_type.startswith("proteomics") else NA,
        "label_channel": channel,
        "raw_file": f"{run}.raw" if plan.assay_type.startswith("proteomics") else f"{key}_R1.fastq.gz",
        "instrument_run": run,
    }
    return Sample(key, condition, dose[0] if dose else None, replicate, cells)


def build_samples(plan: ExperimentPlan) -> list[Sample]:
    samples: list[Sample] = []
    if plan.design == "dose_series":
        series: Sequence[tuple[float, str] | None] = (None, *DOSES)
        for d in series:
            for rep in (1, 2):
                condition = f"{plan.compound}@{d[1]}" if d else VEHICLE
                i = len(samples)
                samples.append(_sample(plan, i, condition, d, rep, f"{plan.key}_run{i + 1:02d}"))
    elif plan.design == "contrast":
        treated = f"{plan.compound}@1 µM"
        reps = 5 if plan.assay_type == "proteomics_tmt" else 3
        for condition, d in ((VEHICLE, None), (treated, (1e-6, "1 µM"))):
            for rep in range(1, reps + 1):
                i = len(samples)
                if plan.assay_type == "proteomics_tmt":
                    samples.append(_sample(plan, i, condition, d, rep, f"{plan.key}_F01", TMT10_CHANNELS[i]))
                else:
                    samples.append(_sample(plan, i, condition, d, rep, f"{plan.key}_run{i + 1:02d}"))
    else:  # CRISPR screen: library-transduced cells at day 0 and after 14 days, two replicates each
        for condition in ("T0", "T14"):
            for rep in (1, 2):
                i = len(samples)
                samples.append(_sample(plan, i, condition, None, rep, f"{plan.key}_lib{i + 1:02d}"))
    return samples


def contrasts(plan: ExperimentPlan) -> list[dict[str, str]]:
    """Analysis design (SPEC §4 Contrast). Labels read 'numerator vs denominator'."""
    if plan.design == "contrast":
        numerator = f"{plan.compound}@1 µM"
        return [{"label": f"{numerator} vs {VEHICLE}", "numerator": numerator, "denominator": VEHICLE}]
    if plan.design == "screen":
        return [{"label": "T14 vs T0", "numerator": "T14", "denominator": "T0"}]
    return []
