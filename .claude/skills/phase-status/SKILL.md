---
name: phase-status
description: Summarise build progress from docs/PLAN.md, docs/PROGRESS.md and docs/features.json. Only when the user runs /phase-status.
argument-hint: [phase-number (optional)]
disable-model-invocation: true
---
Do not edit files. In under 25 lines, summarise: phases done (with commit shas), the current phase and its
unticked DoD items, feature IDs still `"passes": false` grouped by phase, open follow-ups from the last three
PROGRESS entries, and the next milestone demo from the table at the top of docs/PLAN.md.
If "$ARGUMENTS" is a phase number, give that phase's detail instead.
