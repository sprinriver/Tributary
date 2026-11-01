---
name: phase-start
description: Begin a build phase from docs/PLAN.md. Only when the user runs /phase-start.
argument-hint: [phase-number]
disable-model-invocation: true
---
## Repo state
!`git status --short`
!`git log --oneline -15`

Start Phase $ARGUMENTS of docs/PLAN.md.

1. Read the last three entries of docs/PROGRESS.md and the Phase $ARGUMENTS section of docs/PLAN.md. Read only
   the docs/SPEC.md and docs/ARCHITECTURE.md sections it cites, and the docs/features.json entries for its IDs.
2. If an earlier phase is not marked done, or the working tree is dirty, stop and tell me.
3. Do not edit files yet. Present the plan:
   - files that change and the order of work;
   - how each DoD item and feature ID will be proven (test titles start with the feature ID);
   - dependencies you expect to add (none without my approval: name, exact version, link, publisher, age);
   - risks and open questions;
   - whether to split (more than ~10 steps or more than 2 packages → propose $ARGUMENTS a / $ARGUMENTS b, or
     follow the "Suggested split" in the plan).
4. Wait for my approval. Then run `pnpm check` to confirm a green baseline, write the failing acceptance tests,
   run them to show they fail for the right reason, and commit them alone as
   "test(<area>): phase $ARGUMENTS acceptance tests".
