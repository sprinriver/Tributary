## What and why

## How it was verified
- [ ] `pnpm check` passes
- [ ] Tests start with their feature id (`docs/features.json`) and were written first
- [ ] e2e run for UI changes: `pnpm e2e <pattern>`

## Checklist
- [ ] No real data, client names, secrets or personal information
- [ ] No new dependency, or it is exact-pinned, over 90 days old, and `pnpm run licence:scan` passes
- [ ] Contract changes regenerated with `pnpm gen`; breaking ones have an ADR
