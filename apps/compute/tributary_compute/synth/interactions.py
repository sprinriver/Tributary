"""Demo interaction collection for the network of hits (Phase 45): invented pairs, not real interactions."""

from pathlib import Path

import numpy as np

from tributary_compute.synth.catalog import Protein

N_PAIRS = 2000


def write_interactions(out: Path, proteins: list[Protein], rng: np.random.Generator) -> list[str]:
    """Random gene pairs with scores 150-999, laid out like a thresholded STRING file; no meaning."""
    genes = sorted({str(g) for p in proteins for g in p.genes})
    pairs: dict[tuple[str, str], int] = {}
    while len(pairs) < N_PAIRS:
        i, j = (int(x) for x in rng.choice(len(genes), size=2, replace=False))
        a, b = sorted((genes[i], genes[j]))
        pairs.setdefault((a, b), int(rng.integers(150, 1000)))
    lines = [f"{a}\t{b}\t{score}" for (a, b), score in sorted(pairs.items())]
    out.mkdir(parents=True, exist_ok=True)
    (out / "interactions.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ["reference/interactions.tsv"]
