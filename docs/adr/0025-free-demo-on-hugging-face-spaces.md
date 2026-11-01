# 0025 — Free public demo: all services in one Hugging Face Docker Space
Date: 2026-11-01 · Status: accepted
## Context
- **The owner wants a free deployment.** Render's free tier cannot run Tributary:
  - only web services can be free: 0.1 CPU and 512 MB each, 750 instance-hours a month shared
  - no disks, and free services cannot receive private-network traffic
  - they sleep after 15 minutes
  - the free Postgres is deleted after 30 days
  - Keycloak alone needs about 2 GB
- **The options put to the owner:**
  - a Hugging Face Docker Space (free CPU hardware with far more memory)
  - an Oracle Cloud Always Free VM
  - a cut-down Render free service

  The owner chose Hugging Face.
## Decision
- **One image** (`deploy/huggingface/Dockerfile`) runs every service, started by `start.sh` in this order:
  1. Postgres 17 + pgvector (as uid 1000, data under `$HOME/data`)
  2. SeaweedFS
  3. Keycloak (`--optimized`, with Keycloak's own Java 21 copied in)
  4. compute (Python 3.12 venv) and query
  5. migrations, buckets and demo data
  6. Keycloak setup (the same `keycloak-setup.sh` as Render)
  7. the API
  8. Caddy on 7860

  If any service exits, the container exits.
- **One port.** Caddy routes `/api`, `/auth` (admin console blocked), and the S3 bucket paths (`/tributary-raw…`)
  unchanged to SeaweedFS. Presigned URLs therefore use the Space's own address and keep valid signatures.
- **Addresses:**
  - `PUBLIC_URL` defaults to `https://$SPACE_HOST`.
  - `X-Forwarded-Proto` is set for Keycloak from `PUBLIC_URL`.
- **Secrets** are generated at every start, except `TRIBUTARY_ADMIN_PASSWORD`. That one is a Space secret;
  without it, admin sign-in is effectively disabled (a random password).
- **Data is ephemeral:** every restart is a fresh demo, which suits public synthetic data.
- **Source:** the Space builds from the public GitHub repository (a `source` stage that clones it). A local build
  replaces that stage with `--build-context source=.`.
- **Iframe:** the Space page embeds the app in an iframe, where sign-in cookies are third-party. The CSP allows
  framing by huggingface.co, and the demo banner then shows "Open Tributary in a new tab".
## Consequences
- **Free.** There is no persistence, and the first visit after the Space sleeps waits for a 2–3 minute start.
- **Not covered:** pipelines and the AI assistant (unless a key is added), as on Render.
- **Two deployment paths now exist:** `deploy/render` (paid, separate services) and `deploy/huggingface` (free,
  one container). They share `keycloak-setup.sh` and all configuration variables.
## Revisit when
- Persistent free storage is needed: use an external S3 and Postgres through the same variables.
- The Space's free hardware changes.
