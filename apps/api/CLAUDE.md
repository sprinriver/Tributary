# apps/api — Fastify 5 API
- Test: `pnpm run test:api [<pattern>]` (vitest + Testcontainers Postgres; use `app.inject`, not a live port)
- Dev: `pnpm dev` (port 3000). Node 24 type stripping: import local files with `.ts`; erasable syntax only
  (no enums, namespaces or constructor parameter properties).
- App factory `src/app.ts` `buildApp({ db, config })`; config from env in `src/config.ts` (dev defaults; production
  requires secrets). Process entry `src/server.ts`.
- Auth: every route needs a principal unless `config: { public: true }`. Bearer PATs (`trb_…`, read/write scopes) or
  the `trb_session` cookie (+ `X-CSRF-Token` on mutations). Check access with `authorize(request, action, type,
  programId)`; scope lists with `readablePrograms(principal)`.
- Mutations: parse bodies with `parse(Schema, request.body)` from @tributary/contracts; change + `writeAudit(trx,
  request, {...})` in one transaction (reason from `X-Change-Reason`).
- Errors: throw `HttpError`/`forbidden()`/`notFound()`; DB `TR409` → 409 `immutable`.
- Reference to copy: `src/routes/experiments.ts` and `src/auth.test.ts`.
