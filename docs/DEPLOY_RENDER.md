# Deploying Tributary on Render

This guide puts Tributary online on [Render](https://render.com) as a **public demo**: synthetic data, a banner
that says it is a demo, and published low-privilege logins. You can also run it for a small team (see
[Running it for real use](#running-it-for-real-use)). Everything is defined in [`render.yaml`](../render.yaml)
(a Render Blueprint), so deploying is a few clicks and needs no secrets typed by hand.

## What gets created

| Service | Render type | What it does | Plan in `render.yaml` |
|---|---|---|---|
| `tributary-web` | Web service (public) | Caddy: serves the app and routes `/api` → API and `/auth` → Keycloak | `0.5c-512mb` |
| `tributary-s3` | Web service (public) + 10 GB disk | SeaweedFS S3 storage; browsers upload files to it with signed URLs | `0.5c-512mb` |
| `tributary-api` | Private service | The API; its pre-deploy step runs migrations, creates buckets, loads demo data | `0.5c-512mb` |
| `tributary-query` | Private service | DuckDB query service (Explorer, charts) | `1c-2g` |
| `tributary-compute` | Private service | Statistics and chart computation (Python) | `0.5c-512mb` |
| `tributary-keycloak` | Private service | Sign-in (served under `/auth` by `tributary-web`) | `1c-2g` |
| `tributary-db` | Private service + 10 GB disk | Postgres 17 with pgvector, for Tributary and Keycloak | `0.5c-512mb` |

- **Not on the free tier.** Private services and disks need paid plans. Check [render.com/pricing](https://render.com/pricing)
  for the current price of each plan.
- **Plans are adjustable.** Change a service's plan in the dashboard or in `render.yaml`. Keycloak and the query
  service need about 2 GB of memory; the others run in 512 MB.
- **Secrets are generated.** Every secret (database passwords, S3 keys, the OIDC client secret, the cookie secret,
  the admin password) is created by Render on the first deploy. Nothing secret is in the repository.

## Before you start
1. **Repository:** the repository is on GitHub, with this branch merged to `main`. For the "Deploy to Render"
   button, the repository must be public; otherwise connect your private repository in Render.
2. **Account:** you have a Render account with a payment method, and the GitHub app connected (Render →
   Account settings → Git).

## Deploy
1. **Create the Blueprint:** in Render, go to **New → Blueprint**, pick the repository and branch `main`, then
   **Apply**. Or use the button in the README.
2. **Optional key:** Render asks for one optional value, `ANTHROPIC_API_KEY`. Leave it empty; the AI assistant
   stays off.
3. **Wait for the first deploy:** it takes about 15–20 minutes. All seven images build, and the database,
   storage and Keycloak start.
   - The API's pre-deploy step waits up to 5 minutes for the database and storage, then migrates and loads the
     demo data.
   - If a deploy fails because something was not ready in time, use **Manual Deploy → Deploy latest commit** on
     that service.
4. **Open the app:** open the `tributary-web` URL (`https://tributary-web-xxxx.onrender.com`).
   - You should see the yellow demo banner. Sign in as **scientist / scientist** or **viewer / viewer**.
   - The **admin** account (system administrator) has a generated password. Find it in Render under
     `tributary-keycloak` → **Environment** → `TRIBUTARY_ADMIN_PASSWORD`. Keep it private.

### Checking it works
- **API:** `https://<web-url>/api/healthz` returns `{"service":"api","status":"ok",…}`.
- **Demo settings:** `https://<web-url>/api/v1/instance` shows the demo settings.
- **Data:** sign in as scientist. The Experiments page lists the demo experiments (ONC-…, IMM-…), and in
  Explore, choosing *sample* and **Run query** shows rows.
- **Health page:** sign in as admin and open **Admin → Health**. Every dependency should be OK. Pipeline runners
  are "not configured": pipelines are not run on Render.

## Custom domain
1. **Add the domain:** in `tributary-web` → **Settings → Custom Domains**, add it (for example
   `tributary.example.com`) and create the DNS record Render shows.
2. **Set `PUBLIC_URL`:** in `tributary-web` → **Environment**, set `PUBLIC_URL` to `https://tributary.example.com`
   (it replaces the onrender.com reference).
3. **Redeploy:** sync the Blueprint (**Blueprints → your Blueprint → Manual sync**), then redeploy
   `tributary-api` and `tributary-keycloak`.
   - Both read `PUBLIC_URL` from `tributary-web`.
   - Keycloak's setup step updates the sign-in redirect on every start.
4. **Upload domain (optional):** give `tributary-s3` a custom domain the same way, and set `S3_PUBLIC_URL` on it.

## Configuration
All settings are environment variables; most live in the **`tributary-shared`** environment group.

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `DEMO_MODE` | group | `true` | Demo banner, and demo data loaded on deploy |
| `DEMO_LOGINS` | group | `scientist:scientist,viewer:viewer` | Shown on the banner and set as those users' passwords. Never list `admin` (the API refuses to start). |
| `INSTANCE_NAME`, `DEMO_NOTICE` | group | | Banner text |
| `AI_PROVIDER` | `tributary-api` | `none` | `anthropic` to switch the assistant on (also set `ANTHROPIC_API_KEY`); see ADR 0022 |
| `PUBLIC_URL` | `tributary-web` | its onrender.com URL | The address users open; change it for a custom domain |

After changing the group or a service's variables, Render redeploys the affected services.

## Updating
Render deploys every push to `main` (auto-deploy). Migrations run in the API's pre-deploy step before the new
version takes traffic. The demo data loader skips data that already exists.

## Resetting the demo data
Data persists on the two disks. To start again from the demo data:

1. Suspend `tributary-api`.
2. Open a **Shell** on `tributary-db` and drop and recreate the database:

   ```sh
   psql -U tributary -d postgres -c 'drop database tributary with (force)' -c 'create database tributary owner tributary'
   ```

3. Resume `tributary-api`. Its pre-deploy step migrates and reloads the demo data on the next deploy (use
   **Manual Deploy**). Old uploaded files stay in storage but are no longer referenced.

## Backups
- **Disk snapshots:** Render keeps snapshots of persistent disks (see the service's **Disks** tab).
- **Database dump:** for a portable backup, open a Shell on `tributary-db` and run
  `pg_dumpall -U tributary | gzip > /var/lib/postgresql/data/backup.sql.gz`, then download it. This covers the
  Tributary and Keycloak databases.

## Running it for real use
- **Turn the demo off:**
  - Set `DEMO_MODE=false` and remove `DEMO_LOGINS` in the group.
  - Then, in Keycloak, give the scientist and viewer users new passwords or delete them.
  - Keycloak's admin console is not exposed on the public URL. Use a Render Shell on `tributary-keycloak` with
    `kcadm.sh`.
- **Use your own identity provider:** set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and
  `AUTH_GROUP_ROLE_MAP` on `tributary-api` (see the README's Configuration). You can then remove
  `tributary-keycloak`.
- **Larger data:**
  - Raise the disk sizes; disks can grow but not shrink.
  - Raise the plans of `tributary-query` and `tributary-db`.
  - For large raw files, point the S3 variables at Amazon S3, Cloudflare R2 or another S3-compatible store.
    Browser uploads need CORS for `PUBLIC_URL`; `apps/api/scripts/setup-storage.ts` sets it.

## Try it locally first
`deploy/local-trial/compose.yml` runs the same Dockerfiles and variables on your machine:

```sh
docker compose -f deploy/local-trial/compose.yml up -d --build
# then open http://tributary.localhost:8080  (scientist / scientist)
docker compose -f deploy/local-trial/compose.yml down -v
```

## Troubleshooting
- **"HTTPS required" on the Keycloak sign-in page:** `PUBLIC_URL` must start with `https://` on Render. Redeploy
  `tributary-keycloak` after changing it.
- **Sign-in goes back to the wrong address, or shows "Invalid redirect_uri":** `PUBLIC_URL` on `tributary-web` does
  not match the URL in the browser. Fix it, sync the Blueprint, and redeploy `tributary-keycloak` and
  `tributary-api`.
- **Uploads fail in the browser:**
  - `tributary-api` → Environment → `S3_ENDPOINT` must be the public `tributary-s3` URL.
  - The pre-deploy log must show `setup-storage: buckets ready`.
- **The API pre-deploy times out on the first deploy:** check that `tributary-db` and `tributary-s3` are live,
  then deploy `tributary-api` again.
- **Keycloak restarts repeatedly:** it needs about 2 GB of memory (`1c-2g`). Check its logs for
  `keycloak-setup: realm tributary configured`.
