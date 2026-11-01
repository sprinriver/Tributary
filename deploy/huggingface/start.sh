#!/bin/bash
# Starts every Tributary service in one container (free Hugging Face Space). Data lives under $HOME/data and is
# gone when the Space restarts: each start is a fresh demo. If any service exits, the container exits (and restarts).
set -euo pipefail

# --- addresses -------------------------------------------------------------------------------------------------
# Hugging Face sets SPACE_HOST (e.g. you-tributary.hf.space); PUBLIC_URL overrides it (local runs, custom domains).
if [ -z "${PUBLIC_URL:-}" ]; then
  [ -n "${SPACE_HOST:-}" ] || { echo "Set PUBLIC_URL (or run as a Hugging Face Space)." >&2; exit 1; }
  PUBLIC_URL="https://${SPACE_HOST}"
fi
export PUBLIC_URL="${PUBLIC_URL%/}"
case "$PUBLIC_URL" in https://*) export FORWARDED_PROTO=https ;; *) export FORWARDED_PROTO=http ;; esac
export PORT="${PORT:-7860}"

# --- secrets: generated per start unless set as Space secrets ---------------------------------------------------
rand() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }
export DATABASE_PASSWORD="${DATABASE_PASSWORD:-$(rand)}"
export KEYCLOAK_DB_PASSWORD="$(rand)" KC_ADMIN_PASSWORD="$(rand)"
export OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-$(rand)}" COOKIE_SECRET="${COOKIE_SECRET:-$(rand 48)}"
export QUERY_INTERNAL_TOKEN="$(rand)" S3_ACCESS_KEY_ID="tributary$(rand 12)" S3_SECRET_ACCESS_KEY="$(rand)"
# Without a TRIBUTARY_ADMIN_PASSWORD secret the admin gets a random password nobody knows (admin sign-in disabled).
export TRIBUTARY_ADMIN_PASSWORD="${TRIBUTARY_ADMIN_PASSWORD:-$(rand)}"

# --- shared application settings ----------------------------------------------------------------------------------
export NODE_ENV=production TRIBUTARY_TENANT_ID=00000000-0000-7000-8000-000000000001
export DATABASE_HOST=127.0.0.1 DATABASE_USER=tributary DATABASE_NAME=tributary S3_REGION=us-east-1
export DEMO_MODE="${DEMO_MODE:-true}" DEMO_LOGINS="${DEMO_LOGINS:-scientist:scientist,viewer:viewer}"
export INSTANCE_NAME="${INSTANCE_NAME:-Tributary demo}"
export DEMO_NOTICE="${DEMO_NOTICE:-Data resets whenever the demo restarts.}"
export AI_PROVIDER="${AI_PROVIDER:-none}"
export BUNDLED_KEYCLOAK=true OIDC_CLIENT_ID=tributary-api QUERY_HOSTPORT=127.0.0.1:3100 COMPUTE_HOSTPORT=127.0.0.1:8000
export AUTH_GROUP_ROLE_MAP='[{"group":"admin","role":"system_admin"},{"group":"scientist","role":"contributor","programs":["*"]},{"group":"viewer","role":"viewer","programs":["*"]}]'

DATA="$HOME/data"
mkdir -p "$DATA/pg" "$DATA/s3" "$DATA/caddy"
log() { echo "[start] $*"; }
wait_port() { for _ in $(seq 1 120); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 1; done; echo "port $1 did not open" >&2; return 1; }
PIDS=()

# --- Postgres 17 + pgvector ---------------------------------------------------------------------------------------
log "postgres"
if [ ! -s "$DATA/pg/PG_VERSION" ]; then
  printf '%s' "$DATABASE_PASSWORD" > "$DATA/pwfile"
  initdb -D "$DATA/pg" -U tributary --auth=scram-sha-256 --pwfile="$DATA/pwfile" >/dev/null
  rm -f "$DATA/pwfile"
fi
pg_ctl -D "$DATA/pg" -l "$DATA/postgres.log" -o "-c listen_addresses=127.0.0.1 -k /tmp" -w start >/dev/null
export PGPASSWORD="$DATABASE_PASSWORD"
psql -h 127.0.0.1 -U tributary -d postgres -v ON_ERROR_STOP=1 -q -v kcpass="$KEYCLOAK_DB_PASSWORD" <<'SQL'
select 'create database tributary' where not exists (select from pg_database where datname = 'tributary')\gexec
select 'create role keycloak login' where not exists (select from pg_roles where rolname = 'keycloak')\gexec
alter role keycloak password :'kcpass';
select 'create database keycloak owner keycloak' where not exists (select from pg_database where datname = 'keycloak')\gexec
SQL
unset PGPASSWORD

# --- SeaweedFS (S3) -------------------------------------------------------------------------------------------------
log "object storage"
printf '{"identities":[{"name":"tributary","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' \
  "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" > "$DATA/s3.json"
weed server -dir="$DATA/s3" -ip=127.0.0.1 -ip.bind=127.0.0.1 -volume.port=8090 -volume.max=50 -master.volumeSizeLimitMB=128 \
  -s3 -s3.port=8333 -s3.config="$DATA/s3.json" > "$DATA/seaweedfs.log" 2>&1 &
PIDS+=($!)

# --- Keycloak (sign-in, served at PUBLIC_URL/auth) -------------------------------------------------------------------
log "keycloak"
export KC_BOOTSTRAP_ADMIN_USERNAME=admin KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD"
KC_DB=postgres KC_DB_URL="jdbc:postgresql://127.0.0.1:5432/keycloak" KC_DB_USERNAME=keycloak \
KC_DB_PASSWORD="$KEYCLOAK_DB_PASSWORD" KC_HOSTNAME="$PUBLIC_URL/auth" KC_HTTP_ENABLED=true KC_HTTP_PORT=8080 \
KC_HTTP_HOST=127.0.0.1 KC_PROXY_HEADERS=xforwarded JAVA_OPTS_KC_HEAP="-Xms256m -Xmx768m" \
  /opt/keycloak/bin/kc.sh start --optimized --import-realm > "$DATA/keycloak.log" 2>&1 &
PIDS+=($!)

# --- compute and query ----------------------------------------------------------------------------------------------
log "compute"
(cd /app/apps/compute && exec /opt/venv/bin/uvicorn tributary_compute.main:app --host 127.0.0.1 --port 8000 --log-level warning) &
PIDS+=($!)
log "query"
QUERY_HOST=127.0.0.1 QUERY_PORT=3100 S3_ENDPOINT=http://127.0.0.1:8333 node /app/apps/query/src/server.ts > "$DATA/query.log" 2>&1 &
PIDS+=($!)

# --- database schema, buckets, demo data, then the API ---------------------------------------------------------------
wait_port 8333
cd /app
log "migrations"
node packages/db/scripts/migrate.ts
S3_ENDPOINT=http://127.0.0.1:8333 node apps/api/scripts/setup-storage.ts
if [ "$DEMO_MODE" = "true" ]; then log "demo data"; S3_ENDPOINT=http://127.0.0.1:8333 node packages/db/scripts/seed.ts >/dev/null; fi

log "configuring sign-in"
bash /opt/tributary/keycloak-setup.sh

log "api"
# Presigned upload URLs use the public address; Caddy routes the bucket paths to SeaweedFS.
API_HOST=127.0.0.1 API_PORT=3000 S3_ENDPOINT="$PUBLIC_URL" node apps/api/src/server.ts > "$DATA/api.log" 2>&1 &
PIDS+=($!)
wait_port 3000

log "web on :$PORT ($PUBLIC_URL)"
XDG_DATA_HOME="$DATA/caddy" XDG_CONFIG_HOME="$DATA/caddy" caddy run --config /opt/tributary/Caddyfile --adapter caddyfile &
PIDS+=($!)

# Any service exiting stops the container (Hugging Face restarts it).
set +e
wait -n "${PIDS[@]}"
code=$?
echo "[start] a service exited ($code); last log lines:" >&2
tail -n 20 "$DATA"/*.log >&2
exit "$code"
