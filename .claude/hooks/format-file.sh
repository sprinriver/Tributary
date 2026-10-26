#!/bin/bash
# PostToolUse (Edit|Write) — formats the edited file with the workspace-pinned tools. Never blocks.
# Uses node_modules/.bin/prettier (pinned devDependency) rather than npx, which could fetch an unpinned copy.
FILE=$(jq -r '.tool_input.file_path // empty')
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0   # follows worktrees

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.md|*.yml|*.yaml)
    if [ -x "$ROOT/node_modules/.bin/prettier" ]; then
      (cd "$ROOT" && ./node_modules/.bin/prettier --write --log-level=warn "$FILE") >/dev/null 2>&1
    fi
    ;;
  *.py)
    if [ -d "$ROOT/apps/compute" ] && command -v uv >/dev/null 2>&1; then
      (cd "$ROOT/apps/compute" && uv run --frozen ruff format "$FILE" && uv run --frozen ruff check --fix "$FILE") >/dev/null 2>&1
    fi
    ;;
esac
exit 0
