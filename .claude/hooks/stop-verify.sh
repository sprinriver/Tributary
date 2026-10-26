#!/bin/bash
# Stop — deterministic "definition of done" gate. When non-test, non-doc files changed, `pnpm check` must
# pass before Claude can end its turn. Disarmed until Phase 0 adds a `check` script.
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0   # one forced fix-up pass per stop
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')                                   # follows worktrees; CLAUDE_PROJECT_DIR does not
ROOT=$(git -C "${CWD:-$CLAUDE_PROJECT_DIR}" rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0
[ -f package.json ] && jq -e '.scripts.check' package.json >/dev/null 2>&1 || exit 0  # no `check` yet → gate disarmed

CHANGED=$(git status --porcelain -uall | awk '{print $NF}')
[ -z "$CHANGED" ] && exit 0                                                           # clean tree: plan-only turn or already committed
# Only tests, docs, markdown (e.g. SOURCE.md) or artifacts changed — e.g. the tests-first step, where
# failures are expected, or a step that waits for the user's approval — → skip.
printf '%s\n' "$CHANGED" | grep -qvE '(\.test\.|\.spec\.|(^|/)tests?/|(^|/)e2e/|^docs/|^artifacts/|\.md$)' || exit 0

if ! OUT=$(pnpm -s check 2>&1); then
  {
    echo "Stop gate: \`pnpm check\` is failing."
    echo "If you are stopping to wait for the user (a question, an approval, a dependency decision), say so in one line and stop — this gate will not block that next stop."
    echo "Otherwise fix the implementation (never edit, skip or delete tests), rerun \`pnpm check\` and show the output."
    printf '%s\n' "$OUT" | tail -n 60
  } >&2
  exit 2
fi
exit 0
