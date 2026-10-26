# packages/db — Postgres schema, migrations, Kysely types
- Test: `pnpm run test:db [<pattern>]` — integration tests on a fresh Testcontainers Postgres (needs Docker).
- Migrate the local stack: `pnpm db:migrate` (`pnpm db:migrate down` rolls everything back). Seed: Phase 2b.
- Migrations: `migrations/NNNN_name/up.sql` + `down.sql`, applied in order, each in a transaction. Never edit a
  committed migration (a hook blocks it); add a new folder. Every new table needs: the base columns (copy
  `program`), a `touch_updated_at` trigger, and grants to `tributary_app` (select/insert/update; never delete).
- Types: `src/generated/db.ts`, written by `pnpm gen` (migrates a throwaway container, runs kysely-codegen). Commit it.
- Immutability: published versions, their samples/contrasts/custom fields, and published/rejected releases raise
  SQLSTATE `TR409` (`IMMUTABLE_SQLSTATE`); apps/api maps it to 409. audit_log is append-only.
- URNs are set by triggers from ids; never write them from application code.
- Reference to copy: `src/immutability.test.ts` (raw SQL + `set role tributary_app` to test grants).
