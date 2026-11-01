# apps/web — Vite + React 19 SPA
- Test: `pnpm run test:web [<pattern>]` (vitest; tests sit next to the code as `*.test.ts(x)`)
- E2E: `pnpm e2e [<pattern>]`; specs in `/e2e`, screenshots to `artifacts/phase-<N>/`
- Dev: `pnpm dev` (port 5173). `/api/*` is proxied to apps/api on 3000 (vite.config.ts), so no CORS.
- Routing: TanStack Router, code-based routes in `src/router.tsx`; pages in `src/routes/`.
- Server state: TanStack Query. Validate every response with a zod schema from `@tributary/contracts`.
- Reference to copy: `src/health.ts` (fetch + zod parse + pure view-model function) and its test.
- Rules: `.claude/rules/web-ui.md` (AG Grid Community only, Plotly partial bundle, no statistics in the browser).
