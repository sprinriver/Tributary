---
paths:
  - "apps/api/src/**/*.ts"
  - "apps/query/src/**/*.ts"
  - "packages/contracts/src/**/*.ts"
---
# API and contract rules
- Every endpoint: zod-validated params, query and body from packages/contracts; typed response; OpenAPI
  metadata; `/v1/` prefix; list endpoints use cursor pagination.
- Authorisation first: check the CASL ability for the program before touching data; scope queries to the
  caller's programs before compiling any SQL.
- Every mutation and export writes audit_log (actor, action, entity, before/after, reason from `X-Change-Reason`).
- Errors use `{code, field?, message}` with the right status: 400 validation, 403, 404, 409 immutability or
  conflict, 422 domain rule.
- A breaking change to a shared schema needs an ADR in docs/adr/ and a regenerated client (`pnpm gen`).
- No raw SQL from clients or the AI layer. DuckDB SQL only through the QuerySpec compiler; Postgres through Kysely.
