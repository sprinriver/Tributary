# Tributary

**An experiment data platform for drug discovery, proteomics first.** Register experiments and their samples,
upload raw data, launch Nextflow pipelines, import tool outputs into versioned dataset releases, then explore,
chart, compare and search the results. Every change is audited, and lineage runs from raw file to chart.
It is installed in each customer's own AWS account.

> "Tributary" is a codename. Status: Phases 0–17 and 18a of [`docs/PLAN.md`](docs/PLAN.md) are complete. See
> [`docs/PROGRESS.md`](docs/PROGRESS.md) for what was built in each phase and the evidence for it.

## Contents
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation (local development)](#installation-local-development)
- [Running the app](#running-the-app)
- [Testing](#testing)
- [Configuration](#configuration)
- [Repository layout](#repository-layout)
- [Common tasks](#common-tasks)
- [Deployment](#deployment)
- [Security and compliance](#security-and-compliance)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)

## What it does
| Area | Highlights |
|---|---|
| **Registry** | Programs, experiments and immutable published versions. Manifest editor validated against versioned templates and ontologies (OLS4). SDRF import and export. Approval workflow. |
| **Data in** | Presigned multipart uploads straight to object storage. Format sniffing and a QC gate that an approver can override. Lifecycle policies. |
| **Pipelines** | Nextflow runners (local Docker, AWS Batch, AWS HealthOmics) with a form generated from the nf-schema. Live status and logs. Outputs are imported automatically. |
| **Datasets** | Versioned Parquet releases with contracts, column statistics and quality rules. 14 importers: DIA-NN, Spectronaut, MaxQuant, FragPipe, AlphaDIA, quantms, limma, DESeq2, MSstats, DEqMS, CurveCurator, MAGeCK and more. |
| **Explore** | QuerySpec-based explorer (filters, joins, explode, exports) running on DuckDB. Saved views with permission-checked links. "Copy as Python/R". |
| **Charts** | 16 chart types from one registry: volcano, heatmap with dendrograms, PCA, MA, dose-response and more. Statistics run in a Python compute service, and every chart records its provenance. |
| **Results** | Results pages with a generated methods paragraph, a dose-response viewer, protein and compound pages, and a 2–6 contrast comparison. |
| **Search** | Full-text search over experiments and samples, with ontology synonyms and facets. Optional embeddings fused by reciprocal rank. ⌘K palette. |
| **Trust** | Lineage graph (raw file → run → release → chart). Audit log viewer with CSV export. Per-entity history. Append-only audit of every mutation and export. |

## Architecture
```
Browser ── apps/web (Vite + React 19, TanStack Router/Query, AG Grid Community, Plotly)
   │  /api (cookie session, CSRF)
   ▼
apps/api (Fastify 5, Node 24) ── OIDC BFF auth · registry · ingest · pipelines (pg-boss) · charts · search · audit
   ├── Postgres 17 + pgvector   system of record, full-text search, lineage, job queue
   ├── S3 (SeaweedFS locally)   raw files, Parquet releases, exports
   ├── apps/query (Fastify + DuckDB 2.0)   compiles QuerySpec → parameterised SQL over Parquet
   └── apps/compute (Python 3.12, FastAPI, SciPy)   statistics, clustering, curve fits, SDRF, embeddings
Pipelines: Nextflow on local Docker · AWS Batch · AWS HealthOmics
```
- `packages/contracts` holds zod schemas, the single source of truth. OpenAPI 3.1, JSON Schema and the Python
  models are generated from it.
- Every API boundary is validated, and SQL is only ever compiled from a QuerySpec, never accepted from a client.
- Full detail and the decision log: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/adr/`](docs/adr).

## Prerequisites
| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 LTS | with corepack (`corepack enable`) |
| pnpm | 12.15.0 | pinned in `package.json` (`packageManager`) |
| Python | ≥ 3.12 | for `apps/compute` |
| uv | recent | Python package manager ([docs](https://docs.astral.sh/uv/)) |
| Docker | with Compose v2 | runs Postgres, SeaweedFS and Keycloak locally, and the demo Nextflow pipeline |
| Git | any recent | |

macOS, Linux or WSL2. About 4 GB of free RAM for the local stack.

## Installation (local development)
```bash
git clone https://github.com/sprinriver/Tributary.git
cd Tributary
corepack enable                      # provides the pinned pnpm

pnpm run bootstrap                   # frozen installs: pnpm (Node) + uv (Python); never changes lockfiles
docker compose up -d --wait          # Postgres + pgvector :5432, SeaweedFS S3 :8333, Keycloak :8080
pnpm db:migrate                      # apply SQL migrations
pnpm db:seed                         # synthetic demo corpus: 2 programs, 12 experiments, compounds, files, search index
```
The seed loads only synthetic data from `fixtures/` (written by `pnpm synth`). Running it again is safe; the
search index is rebuilt each time.

## Running the app
```bash
pnpm dev
```
| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 (health: `/healthz`) |
| Query service | http://localhost:3100 (internal) |
| Compute service | http://localhost:8000 (internal) |
| Keycloak admin | http://localhost:8080 (admin / admin-dev) |

Sign in with a local Keycloak user (password = username):

| User | Role |
|---|---|
| `admin` | system admin (pipelines, audit log, everything) |
| `scientist` | contributor in every program |
| `viewer` | read-only in every program |

Things to try:
1. Experiments → open `ONC-DIA-01`.
2. Explore → pick a release, filter and chart it.
3. Press **⌘K** (Ctrl+K) and search `HEK293`.
4. As `admin`: Pipelines, and the Audit log.

## Testing
| Command | What it runs |
|---|---|
| `pnpm check` | **Everything that must pass before merging:** typecheck, lint, every TS unit and integration test, compute pytest, ruff and pyright |
| `pnpm run test:api <pattern>` | one package (`test:web`, `test:api`, `test:query`, `test:contracts`, `test:db`, `test:importers`); the pattern matches test titles |
| `pnpm run test:compute -k <pattern>` | Python tests |
| `pnpm e2e [<pattern>]` | Playwright end-to-end tests; need the local stack and `pnpm db:seed` |

- Install the browser once with `pnpm run e2e:install-browsers`.
- API and DB tests start throwaway Postgres and S3 containers (Testcontainers), so Docker must be running.
- Test titles start with a feature ID from [`docs/features.json`](docs/features.json), e.g. `SRCH-01: …`.

CI (`.github/workflows/ci.yml`) runs `check`, `e2e` (with the local stack), an SBOM and, when enabled,
dependency review on every push and pull request.

## Configuration
The API reads its configuration from environment variables. Development defaults match `docker-compose.yml`;
in production (`NODE_ENV=production`) the required ones must be set, or the API refuses to start.

| Variable | Required in prod | Purpose |
|---|---|---|
| `DATABASE_URL` | ✓ | Postgres connection string |
| `PUBLIC_URL` | ✓ | Public URL of the web app (OIDC redirects, cookies) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | ✓ | Your identity provider (Okta, Entra ID, Auth0, Keycloak…) |
| `OIDC_GROUPS_CLAIM` | | Token claim with the user's groups (default `groups`) |
| `AUTH_GROUP_ROLE_MAP` | | JSON list mapping IdP groups to roles and programs |
| `COOKIE_SECRET` | ✓ | Signs session and flow cookies |
| `TRIBUTARY_TENANT_ID` | ✓ | Tenant id of this installation |
| `QUERY_URL`, `QUERY_INTERNAL_TOKEN` | ✓ (token) | Query service location and shared secret |
| `COMPUTE_URL` | | Compute service (default `http://127.0.0.1:8000`) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | Object storage (on AWS, leave keys unset to use the task role) |
| `S3_RAW_BUCKET`, `S3_WAREHOUSE_BUCKET`, `S3_WORK_BUCKET` | | Buckets for raw files, releases and pipeline work |
| `OLS_URL` | | Ontology lookup service (default EBI OLS4) |
| `SEARCH_EMBEDDINGS` | | `none` (default), `local`, `voyage_4` or `bedrock_titan_v2` (see ADR 0020) |
| `SEARCH_EMBEDDING_DIMS`, `SEARCH_MIN_SIMILARITY`, `VOYAGE_API_KEY` | | Embedding options |
| `SESSION_TTL_HOURS` | | Browser session lifetime (default 12) |

Query service limits: `QUERY_TIMEOUT_MS`, `QUERY_ROW_CAP`, `QUERY_MAX_CONCURRENT`, `QUERY_MEMORY_LIMIT`,
`QUERY_THREADS`.

## Repository layout
```
apps/web          React SPA (routes, explorer, charts, results, search, lineage)
apps/api          Fastify API (auth, registry, ingest, pipelines, datasets, charts, search, lineage, audit)
apps/query        DuckDB query service (QuerySpec compiler, exports)
apps/compute      Python service (statistics, SDRF, synthetic data generator, local embeddings)
packages/contracts  zod schemas → OpenAPI, JSON Schema, Python models
packages/db       SQL migrations, Kysely types, seed
packages/importers  tool-output importers with golden tests
packages/ui       shared React components
pipelines/demo    tiny local Nextflow pipeline used in development and e2e
infra/local       Keycloak realm and SeaweedFS config for the local stack
e2e               Playwright tests
fixtures          synthetic corpus (generated by `pnpm synth`, committed)
docs              spec, architecture, plan, progress, ADRs
```

## Common tasks
| Task | Command |
|---|---|
| Regenerate OpenAPI, JSON Schema, Python models and Kysely types after a contract or migration change | `pnpm gen` |
| Add a migration | new folder `packages/db/migrations/NNNN_name/` with `up.sql` and `down.sql` (never edit a committed one) |
| Regenerate the synthetic corpus | `pnpm synth` |
| Benchmark the query service | `pnpm bench:query` |
| Check dependency licences | `pnpm run licence:scan` |
| Format | `pnpm format` |

## Deployment
Target: the customer's AWS account (ECS Fargate, RDS Postgres 17, S3, optional AWS Batch or HealthOmics).
Terraform modules are planned for Phase 21 (`infra/terraform`). Until then:
- only `terraform plan` is ever run by tooling, never `apply` or `destroy`;
- a real AWS Batch or HealthOmics run needs a sandbox account;
- see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §12 for environments and costs.

## Security and compliance
- **Sign-in:** OIDC only, through a backend-for-frontend. Tokens never reach the browser; the session cookie is
  httpOnly and SameSite=strict, and mutations need a CSRF token.
- **Authorisation:** roles per program (CASL), enforced in the API. Every data query is scoped to the caller's
  programs before it is compiled.
- **Change control:** published versions and releases are immutable (enforced by a DB trigger). Every mutation
  and export writes an append-only audit row with a reason.
- **Part 11-ready controls, not a validation claim:** see [`docs/SPEC.md`](docs/SPEC.md) §10.
- **Licences:** no GPL, AGPL or BUSL code in the product. Copyleft tools run only as separate pipeline
  containers (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §9).

## Troubleshooting
| Symptom | Fix |
|---|---|
| `pnpm` or `turbo` errors about the Node version | Use Node 24 (`node -v`) |
| API cannot reach Postgres or S3 | `docker compose ps`; restart the stack with `docker compose up -d --wait` |
| Sign-in loops or "Account unavailable" | Keycloak must be healthy on :8080; check `PUBLIC_URL` and the redirect URIs in `infra/local/keycloak` |
| Search finds nothing | Run `pnpm db:seed` again (it rebuilds the index), or, as an admin, `POST /api/v1/admin/search/reindex` |
| e2e cannot find a browser | `pnpm run e2e:install-browsers` |
| Port already in use | Override with `POSTGRES_PORT`, `S3_PORT` or `KEYCLOAK_PORT` for Compose |

## Documentation
- [`docs/SPEC.md`](docs/SPEC.md): what the product does (modules, contracts, NFRs, security, AI rules)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the stack with versions, licences and deployment
- [`docs/PLAN.md`](docs/PLAN.md), [`docs/PROGRESS.md`](docs/PROGRESS.md): phases and what was built
- [`docs/adr/`](docs/adr): architecture decision records
- [`docs/BUILD_KIT.md`](docs/BUILD_KIT.md): how this repo is built with Claude Code (prompts, guardrails, phase loop)

## Contributing
- One phase of `docs/PLAN.md` per change. Commit the failing tests first, then the implementation.
- `pnpm check` must pass, and every new dependency is exact-pinned and approved first.
- Conventions: [`CLAUDE.md`](CLAUDE.md) and `.claude/rules/`.

No licence has been chosen yet; until a `LICENSE` file is added, all rights are reserved.
