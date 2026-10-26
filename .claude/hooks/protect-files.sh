#!/bin/bash
# PreToolUse (Edit|Write) — blocks edits to secrets, lockfiles, git internals, committed migrations,
# production infra config and the guardrail files themselves. Exit 2 = block; stderr goes to Claude.
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0
FILE_PATH="${FILE_PATH//\\//}"
case "$FILE_PATH" in /*) ;; *) FILE_PATH="$(pwd)/$FILE_PATH" ;; esac
BASE=$(basename "$FILE_PATH")

block() {
  echo "Blocked edit to $FILE_PATH — $1" >&2
  exit 2
}

case "$BASE" in
  .env.example) ;;
  .env|.env.*) block "secrets files are edited by the user only. Put placeholders in .env.example." ;;
  pnpm-lock.yaml|uv.lock|package-lock.json|yarn.lock)
    block "lockfiles change only through the package manager (pnpm add / uv add, which ask the user first)." ;;
esac

case "$FILE_PATH" in
  */.git/*) block "git internals are never edited directly." ;;
  */.claude/settings.json|*/.claude/hooks/*)
    block "guardrail files (.claude/settings.json, .claude/hooks/) are changed by the user only. Tell the user what to change and why." ;;
  */infra/terraform/envs/prod/*) block "production infrastructure configuration is edited by the user only." ;;
esac

# Committed migrations are immutable: write a new migration instead.
case "$FILE_PATH" in
  */packages/db/migrations/*)
    DIR=$(dirname "$FILE_PATH")
    if [ -d "$DIR" ] && git -C "$DIR" ls-files --error-unmatch "$FILE_PATH" >/dev/null 2>&1; then
      block "this migration is already committed. Create a new migration file instead of editing it."
    fi
    ;;
esac

exit 0
