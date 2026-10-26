"""`pnpm synth [--seed N] [--out DIR]` — writes the synthetic corpus (default: <repo>/fixtures)."""

import argparse
from pathlib import Path

from tributary_compute.synth import DEFAULT_SEED, generate

REPO_ROOT = Path(__file__).resolve().parents[4]


def main() -> int:
    parser = argparse.ArgumentParser(prog="pnpm synth", description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "fixtures")
    args = parser.parse_args()
    files = generate(args.out, seed=args.seed)
    print(f"synth: wrote {len(files)} files to {args.out} (seed {args.seed})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
