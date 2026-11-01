# 0024 — Open source under Apache-2.0; public demo hosted on Render from one Blueprint
Date: 2026-11-01 · Status: accepted
## Context
- **The owner's decisions:**
  - Publish Tributary as open source under Apache-2.0.
  - Host a public demo, on Render only.
- **What Render offers:**
  - Docker web services (public, HTTPS terminated by Render)
  - private services reachable by `host:port` on a private network
  - persistent disks
  - environment groups, generated secrets and pre-deploy commands
- **What Render lacks:**
  - Docker Compose
  - object storage
  - composing an environment value from other values
  - choosing a Dockerfile build target
  - URL-safe generated secrets (they are base64)
- **What the platform needs:**
  - an OIDC IdP
  - S3 that browsers can reach for presigned uploads
  - Postgres with pgvector, in which migrations create roles
## Decision
- **Licence:** Apache-2.0 (`LICENSE`, `NOTICE`), with CONTRIBUTING, a code of conduct, SECURITY and issue/PR
  templates.
- **Blueprint:** `render.yaml` defines seven services. Each has its own Dockerfile in `deploy/render/`, because
  Render cannot select a build target:
  - `tributary-web` (Caddy): serves the SPA and routes `/api` to the API and `/auth` to Keycloak over the private
    network. Its plain-HTTP config trusts Render's proxy headers, so Keycloak sees HTTPS.
  - `tributary-s3` (SeaweedFS + disk): public, because presigned uploads go straight from the browser.
  - `tributary-api`, `tributary-query`, `tributary-compute` (private).
  - `tributary-keycloak` (private): the bundled sign-in. A start script runs `kcadm` setup after Keycloak starts,
    on every start: the client secret, the redirect URIs for `PUBLIC_URL`, `sslRequired`, brute-force
    protection, and passwords. Admin console paths are not proxied.
  - `tributary-db` (pgvector Postgres + disk): self-run rather than Render Postgres, because migrations create
    roles (`tributary_app`, `tributary_query_ro`) and Keycloak needs its own database and role.
- **Configuration that Blueprints can express:**
  - `DATABASE_HOST`/`DATABASE_PASSWORD`/… instead of a URL; the parts are URL-encoded in
    `databaseUrlFromEnv`.
  - `QUERY_HOSTPORT`, `COMPUTE_HOSTPORT` and `S3_HOSTPORT` (`fromService` hostport).
  - `BUNDLED_KEYCLOAK=true` derives the issuer from `PUBLIC_URL`.
  - `PUBLIC_URL` is the web service's self-referenced `RENDER_EXTERNAL_URL`, and the others reference it.
  - Shared secrets come from an environment group with `generateValue`.
- **Pre-deploy** (`deploy/render/api-predeploy.sh`): migrations, buckets with CORS, then demo data. It retries
  the database and storage for 5 minutes, because on the first deploy every service starts at once.
- **Demo mode:** `DEMO_MODE`, `DEMO_LOGINS` (non-admin only, enforced at startup), `INSTANCE_NAME` and
  `DEMO_NOTICE`.
  - `GET /v1/instance` (public) feeds a banner on every page.
  - The same `DEMO_LOGINS` sets those users' Keycloak passwords. The admin password is generated and never
    shown.
- **Plain HTTP:** production refuses plain-HTTP OIDC issuers, except on `localhost`/`*.localhost`. This allows
  `deploy/local-trial/compose.yml`, which runs the same images and variables locally.
- **Pipelines are not run on Render.** No runner is configured in production; AWS Batch and HealthOmics belong to
  the AWS deployment (Phase 21).
## Consequences
- **Cost:** private services and disks are paid plans, so the demo is not on Render's free tier.
- **Single instances:** services with disks run as one instance. Fine for a demo; production scale is the AWS
  deployment.
- **Generated secrets** live in Render's environment settings. Rotating one means changing it there and
  redeploying the services that use it.
- **Verified:** the local trial runs the Dockerfiles, the pre-deploy, Keycloak setup, sign-in, the Explorer and
  a browser upload through a presigned URL to the S3 service. The Blueprint itself has not been applied on Render
  from this environment.
## Revisit when
- Render offers managed object storage, or Render Postgres allows the needed roles.
- The demo needs more than one instance per service.
