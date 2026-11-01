# Contributing to Tributary

Thanks for helping. Tributary is an experiment data platform for drug discovery: a registry, pipeline launcher,
data explorer and charts. This guide covers how to get a change merged.

## Ground rules
- **No real data, ever.** Use the synthetic generator (`pnpm synth`) or public datasets. Never add a company's
  name, data, code, URLs, programme names or people's names.
- **Licences.** No dependencies on, or code copied from, GPL/AGPL/BUSL or non-commercial projects. Run
  `pnpm run licence:scan` before you open a pull request.
- **Dependencies are exact-pinned.** Open an issue first, giving the name, the version, why it is needed, its
  licence and its publisher. Packages younger than 90 days need a maintainer's approval.
- **Science is correctness.** log2 fold change is log2(numerator / denominator), p-values are in (0, 1], and
  adjusted p-values are Benjamini–Hochberg unless the source tool says otherwise. Never impute, filter or
  normalise silently. See `CLAUDE.md` → Science conventions.

## Set up
See [README → Installation](README.md#installation-local-development). In short:

```bash
pnpm run bootstrap        # frozen installs (Node 24, pnpm, uv)
docker compose up -d      # Postgres, SeaweedFS, Keycloak
pnpm db:migrate && pnpm db:seed
pnpm dev                  # web http://localhost:5173 (admin/admin, scientist/scientist, viewer/viewer)
```

## Making a change
1. **Open an issue first** for anything bigger than a small fix, so the approach can be agreed.
2. **Write the test first.** Test titles start with the feature id from `docs/features.json`, for example
   `REG-03: publish requires a reason`. Python tests are named like `test_REG_03_...`.
3. **Keep to the architecture.**
   - Every API boundary is validated with the zod contracts in `packages/contracts`. Never hand-write a
     duplicate type; run `pnpm gen` after changing a contract.
   - Postgres goes through Kysely only.
   - DuckDB SQL comes only from the QuerySpec compiler. User input is never interpolated into SQL.
   - Migrations are new folders only; never edit a committed migration.
   - Every mutation and export writes an audit row.
4. **Run the checks.** `pnpm check` must pass (typecheck, lint, all unit tests, Python tests, ruff). For UI work,
   also run the relevant `pnpm e2e <pattern>`.
5. **Keep files under ~400 lines** and pull requests focused. Describe what changed and how you verified it.

## Changes that need extra care
- Changes to a shared contract need an ADR in `docs/adr/`.
- Changes to authentication, permissions or the audit log need a test for the denied case as well.

## Licence of contributions
By contributing you agree that your contributions are licensed under the Apache License 2.0
([LICENSE](LICENSE)), the project's licence (Apache-2.0 §5).
