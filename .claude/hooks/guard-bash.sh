#!/bin/bash
# PreToolUse (Bash) — second line of defence behind the permission rules. Neither is a security boundary
# (a node script can still run anything); for hard isolation use /sandbox or a dev container.
# Hard blocks: infra changes, ad-hoc package runners/installers, curl|sh, force pushes, clean-room breaches.
# Then: forces a permission prompt for anything that can change dependencies or lockfiles.
# `pnpm <script>` / `pnpm run <script>` are checked against the script's body in package.json (2 levels).
# Exit 2 = block (stderr goes to Claude). JSON "ask" = always prompt the user, in any permission mode.
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty'); [ -z "$CWD" ] && CWD=$(pwd)
ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$CWD")

block() {
  echo "Blocked by guard-bash: $1" >&2
  exit 2
}
lower() { tr '[:upper:]' '[:lower:]'; }

# Expand package.json scripts so wrapped commands are checked too.
expand_scripts() {
  printf '%s' "$1" | grep -oE "(^|[;&|[:space:]])pnpm([[:space:]]+run)?[[:space:]]+[A-Za-z0-9:_.-]+" | awk '{print $NF}' | sort -u |
  while read -r name; do
    for pj in "$CWD/package.json" "$ROOT/package.json"; do
      [ -f "$pj" ] && jq -r --arg n "$name" '.scripts[$n] // empty' "$pj" 2>/dev/null
    done
  done
}
BODY1=$(expand_scripts "$CMD")
BODY2=$(expand_scripts "$BODY1")
LC=$(printf '%s ; %s ; %s' "$CMD" "$BODY1" "$BODY2" | tr '\n' ';' | lower)
has() { printf '%s' "$LC" | grep -Eq -e "$1"; }   # -e: patterns may start with "--"

B="(^|[;&|(\`\"'[:space:]])"                                                  # start of a command (incl. inside quotes)
F='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'   # flags (and their values) before a subcommand

# 1. Infrastructure changes are a human step.
if has '(^|[^a-z])(terraform|tofu)([[:space:]]+-[^[:space:]]+)*[[:space:]]+(apply|destroy|import|state[[:space:]]+(rm|mv|push))'; then
  block "terraform/tofu apply, destroy, import and state edits are done by a human. Run fmt, validate or plan only."
fi

# 2. Ad-hoc package execution or installation outside the project's package managers.
if has "${B}(npx|pnpx|bunx|uvx|pipx)[[:space:]]|${B}pnpm${F}[[:space:]]+(dlx|create)([[:space:]]|\$)|${B}npm${F}[[:space:]]+(i|install|add|exec|x|create)([[:space:]]|\$)|${B}npm${F}[[:space:]]+init[[:space:]]+[^-[:space:]]|${B}yarn${F}[[:space:]]+((global[[:space:]]+)?add|dlx|create)([[:space:]]|\$)|${B}pip3?[[:space:]]+install([[:space:]]|\$)|${B}python3?[[:space:]]+-m[[:space:]]+pip[[:space:]]+install|${B}uv${F}[[:space:]]+pip[[:space:]]+install|${B}uv${F}[[:space:]]+tool[[:space:]]+(run|install)"; then
  block "don't run or install packages ad hoc (npx, uvx, pnpm dlx/create, npm exec/install, pip install, uv tool). Propose the dependency with name, exact version, registry link, publisher and first-publish date; once approved, add it with pnpm add / uv add, or add a package.json script. Tools the user must install (terraform, tflint, checkov): tell the user."
fi

# 3. Piping downloaded scripts into a shell.
if has '(curl|wget)[^|;]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z)?sh([[:space:]]|$)'; then
  block "piping a downloaded script into a shell is not allowed. Download it, show it to the user, and ask."
fi

# 4. Force pushes.
if has 'git[[:space:]]+push[^;&|]*([[:space:]]--force(-with-lease)?|[[:space:]]-f)([[:space:]]|$|=)'; then
  block "force-push is not allowed from Claude Code."
fi

# 5. Clean-room boundaries.
if has 'treeverse/lakefs|github\.com/treeverse'; then
  block "lakeFS source is BUSL-licensed and its licence objects to AI agents reading it. Keep it out of this workspace."
fi
if [ -n "$CLIENT_CODE_PATHS" ]; then
  IFS=':' read -ra PATHS <<< "$CLIENT_CODE_PATHS"
  for p in "${PATHS[@]}"; do
    [ -z "$p" ] && continue
    case "$CMD $BODY1 $BODY2" in
      *"$p"*) block "that path is an earlier client's codebase. Clean-room rule: never read, search or copy from it." ;;
    esac
  done
fi

# 6. Dependency and lockfile changes always need the user's approval, whatever form the command takes
#    (e.g. `pnpm --filter api add x`, `pnpm install x`, `uv add x`, an unlocked `uv run`, or a script doing so).
ask() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
}
DEP_MSG="this can change dependencies or lockfiles. Approve only if Claude has given the package name, exact version, registry link, publisher and first-publish date."
if has "${B}pnpm${F}[[:space:]]+(add|remove|rm|uninstall|un|update|up|upgrade|import|dedupe|link|patch-commit)([[:space:]]|\$)"; then
  ask "pnpm dependency change: $DEP_MSG"
fi
if has "${B}pnpm${F}[[:space:]]+(i|install)([[:space:]]|\$)" && ! has '--frozen-lockfile'; then
  ask "pnpm install without --frozen-lockfile: $DEP_MSG"
fi
if has "${B}uv${F}[[:space:]]+(add|remove)([[:space:]]|\$)"; then
  ask "uv dependency change: $DEP_MSG"
fi
if has "${B}uv${F}[[:space:]]+(lock|sync|run)([[:space:]]|\$)" && ! has '(--locked|--frozen|--check)([[:space:]]|$|=)'; then
  ask "uv without --locked/--frozen can rewrite uv.lock. Prefer the pnpm scripts (pnpm run test:compute, pnpm compute:sync). $DEP_MSG"
fi

exit 0
