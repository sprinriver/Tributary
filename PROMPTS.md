# Copy-paste prompts for Claude Code

Everything below is meant to be pasted as-is. `<N>` = phase number, `<slug>` = short name, `<area>` = package
or module name. Blocks marked **terminal** go in your shell; everything else goes into Claude Code.

---

## 0. One-time setup

**Before anything else (not technical):** ask counsel whether the earlier client contract permits a
generalised rebuild (SPEC §12 Q8). Keep the client's code, documents, data and branding off this repo and
out of every Claude Code session. If the old code is on the same machine, deny Claude access to it in
`.claude/settings.local.json` (personal, not committed):
```json
{ "permissions": { "deny": ["Read(//absolute/path/to/old-client-app/**)"] } }
```
and add `export CLIENT_CODE_PATHS=/absolute/path/to/old-client-app` to your shell profile (e.g. `~/.zshrc`;
separate several paths with `:`) so the bash guard hook also blocks shell access to it in every session.

**Terminal** (macOS, Linux or WSL — the hook scripts are bash and need `jq`)
```bash
mkdir tributary && cd tributary && git init
unzip ~/Downloads/tributary-kit.zip -d .          # the zip holds the repo root (incl. hidden .claude/ and .mcp.json)
chmod +x .claude/hooks/*.sh
# Prerequisites: Node 24 + corepack (pnpm), uv, Docker, jq, gh (run: gh auth login)
# For Phase 21 later: terraform ≥ 1.15, tflint, checkov (Claude won't install tools itself)
npm install -g typescript-language-server typescript@6.0.3 pyright@1.1.414   # code intelligence (TS 7 has no tsserver)
export CONTEXT7_API_KEY=<your key>   # or delete "context7" from .mcp.json, or run: npx ctx7 setup --claude
git add -A && git commit -m "chore: add specs and Claude Code kit"
claude                                                      # always start at the repo root
```

**Claude Code (once)**
```
/plugin install typescript-lsp@claude-plugins-official
/plugin install pyright-lsp@claude-plugins-official
/mcp
```
Approve the two project MCP servers (playwright, context7) when asked. If the Playwright MCP later reports a
missing browser, install Google Chrome or ask Claude to use the Playwright MCP's `browser_install` tool.

---

## 1. Tailor the spec to you (optional, ~30 min, recommended)
```
Read CLAUDE.md, docs/SPEC.md, docs/REFERENCE_V1.md and docs/ARCHITECTURE.md §14.
Interview me in detail using the AskUserQuestion tool about: every item in docs/SPEC.md §12 "Open questions",
anything that contradicts itself, and anything a first design-partner biotech would push back on.
Don't ask what the documents already answer; dig into the hard parts. When we're done, update docs/SPEC.md
(and docs/ARCHITECTURE.md only if a decision changes — then also add an ADR under docs/adr/).
Show me the diff, then commit "docs: tailor spec".
```

## 2. Independent review of the plan (fresh session)
```
Use a subagent to review docs/PLAN.md against docs/SPEC.md and docs/features.json: every SPEC feature is mapped
to a phase and a features.json ID, no phase is too big for one session, and every DoD item is provable by a
command or an artifact. Report gaps only — no style preferences. Then propose minimal edits and wait for my OK.
```

---

## 3. Phase 0 (special — no tests exist yet)

**Terminal**
```bash
claude --permission-mode plan
```
**Claude Code**
```
/rename phase-0-scaffold
```
```
Read CLAUDE.md and the Phase 0 section of docs/PLAN.md.
[Optional — delete this line if you don't have it: The Celeste repo is at <path>. Read it first as Phase 0 describes.]
Propose a plan: files to create, the exact version you will pin for every package (look each one up on the
npm / PyPI registry now — do not guess), order of work and risks. Wait for my approval.
Write the pinned versions straight into the package.json / pyproject.toml files, then run one `pnpm install`
and one `pnpm compute:sync`; I'll approve each once.
After approval: scaffold everything, then make `pnpm check`, `docker compose up -d` and `pnpm e2e smoke` pass.
Show evidence for every DoD item (command + last output lines). Then:
1. Tick the DoD in docs/PLAN.md and set Phase 0 `Status: done`.
2. Add a docs/PROGRESS.md entry (use its template) and set OPS-01 "passes" to true in docs/features.json.
3. Commit "chore(repo): phase 0 scaffold and guardrails".
4. Put the short sha in the Phase 0 Status line and the PROGRESS entry; commit "docs: record phase 0 sha".
```
Then `/clear`.

---

## 4. The phase loop (Phases 1–23) — same five steps every time

**A. Start in plan mode** (terminal: `claude --permission-mode plan`)
```
/rename phase-<N>-<slug>
```
```
/phase-start <N>
```
Read the plan it proposes. Press Ctrl+G to edit it if needed, then approve.

**B. Tests first** — `/phase-start` does this automatically once you approve the plan (failing tests,
committed alone). Check `git log -1` shows a `test(...)` commit. If it didn't happen, paste:
```
Implement step 1 only: write failing tests for every DoD item and feature ID of Phase <N> (unit/integration
tests, plus Playwright specs for UI items). Start each test title with its feature ID. Run them and show they
fail for the right reason. Commit the tests alone as "test(<area>): phase <N> acceptance tests".
```

**C. Paste the phase add-on from §5 below (if the phase has one), then implement against a goal**
```
/goal Phase <N> DoD in docs/PLAN.md is demonstrated in this conversation: after the last edit, `pnpm check` exits 0; for UI phases the phase's e2e specs pass with screenshots saved under artifacts/phase-<N>/; and `git diff --stat --diff-filter=DMR "$(git log -1 --format=%H --grep='^test(')" -- '*.test.ts' '*.test.tsx' '*.spec.ts' 'apps/compute/tests'` prints nothing (no acceptance test modified, renamed or deleted; new tests are fine); or stop after 40 turns.
```

**D. Review and close**
```
/code-review
```
```
/phase-finish
```

**E. Reset**
```
/clear
```

---

## 5. Phase add-ons (paste between steps B and C)

**UI phases — 5, 6, 11, 13, 14, 15, 16, 18, 19**
```
Use the playwright MCP to open http://localhost:5173, sign in as "scientist", and use this phase's feature
the way a bench scientist would. Take screenshots into artifacts/phase-<N>/, list everything that looks wrong,
slow or confusing, and fix it. Repeat until the list is empty.
```

**Science-heavy phases — 8, 9, 12, 14, 15, 16**
```
Before you finish, use the omics-reviewer subagent on the diff since the test commit and fix every correctness
issue it reports. Do not change tests to make its findings go away.
```

**Phase 9 — importers fan-out**
```
First, for each importer listed in Phase 9 of docs/PLAN.md, look up the tool's official output documentation
for a specific version and write packages/importers/<key>/SOURCE.md (link, version, exact column names and
meanings). Show me the list and wait for my OK. After I approve, commit them alone as
"docs(importers): phase 9 sources" (the batch worktrees branch from this commit).
```
```
/batch implement the remaining importers listed in Phase 9 of docs/PLAN.md using the add-importer skill, following packages/importers/diann_pg_matrix exactly (detect, map, DuckDB SQL, quality rules, synth fixture, golden test). Each unit starts with `pnpm run bootstrap`, adds no dependencies, and must pass `pnpm run test:importers <its importer key>`.
```
After the batch is merged, in the main checkout:
```
Run `pnpm check` and `pnpm run test:importers DS-06`; fix any conflicts or failures between importers.
```

**Phase 12 — benchmark**
```
Run `pnpm bench:query` and record p50/p95 for each benchmark spec in docs/ARCHITECTURE.md §6, labelled
"local, <machine description>". Flag anything that misses docs/SPEC.md §9.
```

**Phase 15 — charts fan-out**
```
/batch implement the chart types listed in Phase 15 of docs/PLAN.md (line, bar, scatter2d, scatter3d, box_violin, histogram_kde, lollipop, bubble, pie_donut) using the add-chart-type skill, following apps/web/src/charts/volcano and its registry entry exactly. Each unit starts with `pnpm run bootstrap`, adds no dependencies, writes its e2e spec but does not run e2e (parallel units would fight over the dev-server ports), and must pass `pnpm run test:contracts <its chart type>` and `pnpm run test:web <its chart type>`.
```
After the batch is merged, in the main checkout (one dev stack, so e2e runs here only):
```
Run `pnpm check` and `pnpm e2e "VIZ-0[5-8]"`; fix every failure without editing the specs' assertions.
```

**Phase 19 — AI layer**
```
Use only the stub provider in tests and CI. Never write real API keys into any file. Every tool must execute
with the requesting user's identity — prove it with a test per tool. After everything is green I will run the
eval harness against a real provider myself.
```

**Phase 21 — infrastructure**
```
You may run terraform fmt, validate, tflint and checkov (installed by me — if one is missing, tell me which
version to install). Do not run terraform plan unless I give you an AWS profile name in this session. Never
run terraform apply or destroy, and never create AWS resources by CLI.
```

---

## 6. When things go wrong
| Situation | Paste |
|---|---|
| You corrected the same thing twice | `/clear`, then restart the phase prompt with one extra line describing what went wrong |
| Context is getting full mid-phase | `/compact Focus on Phase <N> remaining DoD items, files touched, failing tests and their errors` |
| Claude wants a new dependency | `Show me: registry link, publisher, first-publish date, weekly downloads, licence. Is it on the ARCHITECTURE §9 allowlist? If any doubt, propose a way without it.` |
| Suspected invented API | `Look up <library> <pinned version> docs with context7 and correct the code to match them exactly.` |
| Flaky or long test output | `Use the test-triager subagent on "pnpm e2e <pattern>" and fix the root cause. No retries, no sleeps.` |
| Phase turned out too big | `Split Phase <N> into <N>a and <N>b in docs/PLAN.md with separate DoDs and feature IDs. Implement <N>a only.` |
| Scientific doubt | `Use the omics-reviewer subagent on <file or diff> and explain each finding in plain language before changing anything.` |

## 7. Status at any time
```
/phase-status
```

## 8. Model, effort and cost
- Spec, plan and architecture sessions: Opus with `/effort high`; add `ultrathink` to a single hard prompt.
- Routine phases: Sonnet, or `/model opusplan` (Opus plans, Sonnet executes) — Anthropic's advice is Sonnet
  for most coding. Use Opus for the hard ones: 10, 12, 14, 19, 20.
- Subagents: test-triager runs on Haiku; plan-reviewer and omics-reviewer on Opus (set in their files).
- Set model, effort and MCP servers at session start; changing them mid-phase invalidates the prompt cache.
- Use `/clear` (free) between phases rather than `/compact`.
- Anthropic's published average is ~$13 per developer per active day; ~30–35 sessions over 6–9 weeks is
  roughly $400–600 at API list prices, up to ~$1,200 with heavy `/batch` or Opus-heavy sessions. On a Max
  plan the limit you'll hit is session/weekly usage — check `/usage` weekly.
