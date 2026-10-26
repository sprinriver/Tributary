"""Deterministic writers: fixed column order, `\\n` line endings, fixed float formatting, sorted JSON keys."""

import json
import math
from collections.abc import Iterable, Sequence
from pathlib import Path

Cell = str | int | float | None


def fmt(value: Cell, digits: int = 6) -> str:
    """Empty cell for missing values; floats with `digits` significant digits."""
    if value is None:
        return ""
    if isinstance(value, float):
        return "" if math.isnan(value) else f"{value:.{digits}g}"
    return str(value)


def write_tsv(path: Path, header: Sequence[str], rows: Iterable[Sequence[Cell]], digits: int = 6) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header)]
    lines += ["\t".join(fmt(cell, digits) for cell in row) for row in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
