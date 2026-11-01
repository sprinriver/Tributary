#!/bin/sh
# Render pre-deploy command for the API: migrations, buckets and upload CORS, and demo data when DEMO_MODE=true.
# Every step is idempotent. On the first deploy all services start together, so the database and object storage may
# still be starting: those steps retry for up to 5 minutes.
set -eu
retry() {
  what="$1"; shift
  i=0
  until "$@"; do
    i=$((i + 1)); [ "$i" -ge 30 ] && { echo "$what not reachable" >&2; exit 1; }
    echo "waiting for $what ($i)"; sleep 10
  done
}
retry database node packages/db/scripts/migrate.ts
retry "object storage" node apps/api/scripts/setup-storage.ts
if [ "${DEMO_MODE:-false}" = "true" ]; then node packages/db/scripts/seed.ts; fi
