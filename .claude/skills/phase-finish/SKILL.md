---
name: phase-finish
description: Close out the current build phase - verify, review, record progress, commit. Only when the user runs /phase-finish.
disable-model-invocation: true
---
1. Run `pnpm check` and the phase's e2e specs; paste the final output lines. Fix failures without editing
   tests, and rerun until green.
2. Use the plan-reviewer subagent on the diff since the phase's test commit. For phases 8, 9, 12, 14, 15 and
   16 also use the omics-reviewer subagent. Fix correctness and requirement gaps only; list anything you
   deliberately left and why.
3. In docs/PLAN.md tick the phase's DoD boxes and set `Status: done`.
4. In docs/features.json set `"passes": true` only for this phase's feature IDs whose `verify` command you ran
   successfully in this session. Change nothing else in that file.
5. Append an entry to docs/PROGRESS.md using its template: what was built, decisions and reasons, dependencies
   added (name@version and why), evidence (commands and results), gaps and follow-ups.
6. Commit once as "feat(<area>): phase <N> <title>" and show `git show --stat HEAD`.
7. Put the short sha into the phase's Status line and the PROGRESS entry; commit "docs: record phase <N> sha".
