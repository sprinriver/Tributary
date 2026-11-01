# Tributary — Claude Code build kit

A copy-paste plan, specification and guardrail set for building a **proteomics-first experiment data platform
for drug discovery** with Claude Code, on Celeste's stack (React + Node.js). It generalises the experiment
data application you built earlier for a biotech client — clean-room: no client names, data, code or
documents — and folds in research on what competitors, open-source projects and AI vendors have built since.
"Tributary" is a codename; rename it with one find-and-replace before Phase 0.

## What's inside
```
CLAUDE.md                  project memory Claude Code reads every session (index style, < 200 lines)
.claude/settings.json      permissions + hook wiring (pre-approves checks/tests, asks for installs, blocks destructive commands)
.claude/hooks/             protect-files · guard-bash · format-file · stop-verify (blocks "done" until `pnpm check` passes)
.claude/agents/            plan-reviewer (Opus) · omics-reviewer (Opus, science correctness) · test-triager (Haiku)
.claude/skills/            /phase-start · /phase-finish · /phase-status · add-importer · add-chart-type
.claude/rules/             path-scoped rules: API contracts, science, web UI, infrastructure
.mcp.json                  Playwright (tests the UI like a user) + Context7 (current library docs)
docs/SPEC.md               WHAT to build: 13 modules, data contracts, QuerySpec/ChartSpec, NFRs, security, AI rules
docs/ARCHITECTURE.md       HOW: stack with versions, old→new mapping, licences, deployment, decision log
docs/PLAN.md               24 phases (0–23), each with a checkable definition of done
docs/PROMPTS.md            the exact prompts to paste, phase by phase  ← you'll live in this file
docs/features.json         90 features (old-app parity + new), each with a verify command
docs/REFERENCE_V1.md       what the old app did, in functional terms, incl. its known defects
docs/RESEARCH.md           the research report behind every decision (repo copy, with earlier-client specifics
                           removed; its milestones M0–M14 are organised here as Phases 0–23)
docs/PROGRESS.md, docs/adr state that survives between Claude Code sessions
```

## Before you start
1. **Legal.** Ask counsel whether the earlier client contract permits a generalised rebuild (SPEC §12 Q8).
2. **Clean room.** Keep the client's code, documents, data and branding out of this repo and out of every
   Claude Code session. `docs/PROMPTS.md` §0 shows the deny rule and `CLIENT_CODE_PATHS` guard.
3. **Tools.** Node 24 (with corepack/pnpm), uv, Docker, jq, gh, Claude Code; typescript-language-server,
   TypeScript 6.0.3 and pyright for code intelligence; terraform ≥ 1.15, tflint and checkov by Phase 21.
   macOS, Linux or WSL. The project pins TypeScript 6.0.3: TypeScript 7 ships no tsserver and typescript-eslint
   doesn't support it yet.

## Quick start
1. Create the repo and unzip this kit into it (`docs/PROMPTS.md` §0 has the commands).
2. Optional but recommended: run the spec interview (§1) so the spec reflects your first customer.
3. Run Phase 0 with the Phase 0 prompt (§3). If you have the Celeste repo, give its path there.
4. For every later phase run the five-step loop (§4): `/phase-start N` → tests first → `/goal …` →
   `/code-review` + `/phase-finish` → `/clear`.
5. Check progress any time with `/phase-status`.

## The plan at a glance
| Milestone | Phases | What you can show afterwards | Rough time (one developer) |
|---|---|---|---|
| A Foundations | 0–3 | Login, CI green | week 1 |
| B Registry | 4–6 | Experiments with validated, ontology-backed manifests | weeks 2–3 |
| C Data in | 7–11 | Uploads, demo pipeline run, dataset releases | weeks 3–5 |
| D Explore | 12–16 | **First sales demo**: explorer, charts, results, compound and protein pages | weeks 5–7 |
| E Find & trust | 17–18 | Search, lineage, audit — the answers pharma IT asks for | week 7 |
| F AI | 19–20 | Assistant + MCP server (Claude can query a customer's platform) | week 8 |
| G Ship | 21–23 | Terraform install into a design partner's AWS account | week 9 |

About 30–35 Claude Code sessions in total. Claude Code cost ≈ $400–600 at API list prices, up to ~$1,200 with
heavy parallel work (Anthropic's average is ~$13 per developer per active day). Customer infrastructure
≈ $430–520/month per environment before pipeline compute.

## What changes from the old app, and why
- **Kept:** the whole user loop — registry with versions and searchable custom keys, manifest editing,
  one-click Nextflow, filter/join explorer with CSV export, the 12 chart types and their options.
- **React stays; Node replaces the FastAPI microservices** (one Fastify API + a DuckDB query service), like Celeste.
  One small internal **Python service** remains for statistics (clustering with bootstrap, curve fits, PCA) —
  JavaScript has no credible equivalents.
- **Postgres** replaces OpenSearch and Neptune (search, pgvector, lineage); **Iceberg + DuckDB** replace Redshift;
  **ECS Fargate** replaces EKS; any **OIDC** identity provider replaces single-vendor SSO.
- **lakeFS is out**: it moved to a Business Source License in September 2026 and its licence objects to AI
  agents reading its code. Versions now live as data in Postgres + S3 + Iceberg.
- **Validation everywhere** (one schema per chart, contracts per dataset) removes the old app's main bug class.
- **New:** native DIA-NN/Spectronaut/MaxQuant/FragPipe/quantms import, dose-response as first-class results,
  results pages with auto-written methods, compound and protein pages, hybrid search, lineage graph,
  an AI assistant that runs validated queries with the user's own permissions, and an MCP server.

## Fewer permission prompts in Claude Code
- **Default (recommended):** recent Claude Code starts in auto mode, and `.claude/settings.json` pre-approves
  checks, tests, builds, commits and local Docker. It **asks** before dependency installs, `git push/reset/rebase`,
  `terraform plan` and `aws` commands, and **blocks** `terraform apply/destroy`, force-push, deleting AWS
  resources and reading `.env` files.
- **Fewer "ask" prompts:** move entries from `"ask"` to `"allow"` in `.claude/settings.json`. Edit it yourself —
  the protect-files hook stops Claude from editing its own guardrails. The deny rules and blocking hooks stay.
  Dependency and lockfile changes will still prompt: the guard-bash hook asks for those in every form
  (`pnpm add`, `pnpm --filter x add`, `uv add`, or a package.json script that does so). To remove that too,
  delete section 6 of `.claude/hooks/guard-bash.sh` — not recommended, since AI-suggested package names are a
  known attack route.
- **Fully unattended:** `claude --permission-mode bypassPermissions` — only inside a dev container or VM, per
  Anthropic's guidance. Deny rules and blocking hooks still apply in that mode.
- **What the guardrails are and aren't:** permission rules and hooks catch mistakes, including commands hidden
  in package.json scripts, but they inspect command text — a script file Claude writes could still do anything.
  They are not a sandbox. For hard isolation run Claude Code with `/sandbox` or in a dev container, and keep
  the plan-reviewer step, which checks new scripts and dependencies in every phase.

## Risks to watch
- DuckDB 2.0 came out days before this kit; benchmark in Phase 12 before relying on it (DuckLake is the fallback).
- AWS HealthOmics runs in 8 regions, none in India; S3 Tables availability must be checked per customer region.
- General-availability AI models block some biology requests; Anthropic's relaxed-safeguard programme is not
  available on Bedrock. The AI layer is designed to navigate customer data, not to do target discovery.
- AG Grid Enterprise only if customers insist on Excel-style clipboard; otherwise the Paste TSV dialog covers it.
- Licences: limma and its Python port inmoose are GPL, so differential statistics run only in pipeline
  containers (e.g. nf-core/differentialabundance), never inside the product. The licence scan in Phase 22
  enforces the allowlist in `docs/ARCHITECTURE.md` §9.
