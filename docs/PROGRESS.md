# Progress log

Append-only, newest at the bottom. Written by `/phase-finish`; read at the start of every session.

Entry template:
```
## <YYYY-MM-DD> — Phase <N>: <title> — done | partial
- Built: …
- Decisions (and why): …
- Dependencies added: name@version — reason (or "none")
- Evidence: `pnpm check` ✓ · `pnpm e2e <pattern>` ✓ · screenshots in artifacts/phase-<N>/
- Gaps and follow-ups: …
- Commit: <short sha>
```

---

## 2026-10-26 — Kit created (before Phase 0)
- Built: SPEC, ARCHITECTURE (with decision log), PLAN (Phases 0–23), PROMPTS, features.json (90 features),
  REFERENCE_V1 (clean-room parity notes), RESEARCH, and Claude Code guardrails (settings, hooks, subagents,
  skills, path rules, MCP servers).
- Decisions: see docs/ARCHITECTURE.md §14 (ADR-001 … ADR-014).
- Next: settle SPEC §12 Q8 (client contract) → optional spec interview → Phase 0.

## 2026-10-26 — Phase 0: Scaffold and guardrails — done
- Built: pnpm 12 + Turborepo workspace with root scripts from CLAUDE.md; apps/web (Vite + React + TanStack
  Router/Query, home page shows API health via `/api` proxy), apps/api (Fastify `/healthz`, `/readyz`),
  apps/query (Fastify + DuckDB `GET /v1/select42`), apps/compute (FastAPI `/healthz`, uv, pytest, ruff,
  pyright strict), packages/contracts (`HealthStatusSchema`), db, importers, ui (`StatusBadge`) with one test
  each; ESLint flat config (max-lines 400 warning) + Prettier; docker-compose.yml (Postgres 17 + pgvector,
  SeaweedFS S3 :8333 + Iceberg REST :8181, Keycloak with `tributary` realm and users admin/scientist/viewer,
  password = username); Playwright config + `e2e/smoke.spec.ts`; `.github/workflows/ci.yml`; per-package CLAUDE.md.
- Decisions (and why):
  - No Celeste repo provided → no ADR-0014 yet; UI kit decision deferred to the first UI-heavy phase.
  - API/query run TypeScript with Node 24's built-in type stripping (`.ts` import extensions, erasable syntax
    only) — no tsx dependency.
  - Licence scanner: pnpm's built-in `pnpm licenses list` for Node + pip-licenses 5.5.5 (MIT) for Python, with
    the allowlist in `scripts/licence-scan.mjs`. MPL-2.0 is allowed (certifi; file-level copyleft, never copied).
  - `@tanstack/react-query` pinned to 5.104.5 (not 5.105.0): pnpm 12's minimum release age rejected the newer one;
    pinning an older version beats adding an exclusion.
  - Compute HTTP tests use `httpx.ASGITransport`, not starlette's TestClient (it now wants `httpx2`, a new dependency).
  - Keycloak image from Docker Hub (`keycloak/keycloak:26.8.1`, official mirror) — quay.io was unreachable here.
  - `.prettierignore` also skips `*.md` and `.claude/` so hand-written kit docs keep their layout.
- Dependencies added: see ARCHITECTURE §3 "Pinned" notes (all versions read from npm/PyPI on 2026-10-26).
  Under 90 days old, taken as specified by the kit's ARCHITECTURE §3: @duckdb/node-api 2.0.0-r.1, vitest 5.0.5,
  @playwright/test 1.64.1.
- Evidence: `pnpm check` ✓ (14 turbo tasks, eslint + prettier, pytest 1 passed, ruff, pyright 0 errors) ·
  `docker compose ps` → postgres, seaweedfs, keycloak all healthy · `pnpm e2e smoke` ✓ (1 passed) ·
  `pnpm run licence:scan` ✓ (168 dependencies) · protect-files hook on `.env` → "Blocked edit to …/.env — secrets
  files are edited by the user only." (exit 2) · screenshot artifacts/phase-0/home.png.
- Gaps and follow-ups: CI not yet run on GitHub (first push). Context7 MCP needs `CONTEXT7_API_KEY`. `pnpm synth`
  is a stub until Phase 2. Plan-reviewer subagent not run (built in a cloud session without `/phase-finish`).
  Open legal question SPEC §12 Q8 (earlier client contract) still needs counsel.
- Commit: 8545274
