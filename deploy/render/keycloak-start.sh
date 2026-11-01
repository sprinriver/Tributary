#!/bin/bash
# Starts Keycloak, then configures the tributary realm for this deployment; exits if setup fails (Render restarts).
set -euo pipefail
: "${PUBLIC_URL:?PUBLIC_URL must be set}" "${DATABASE_HOST:?}" "${KEYCLOAK_DB_PASSWORD:?}"
export KC_HOSTNAME="${PUBLIC_URL%/}/auth"
export KC_DB_URL="jdbc:postgresql://${DATABASE_HOST}:${DATABASE_PORT:-5432}/keycloak"
export KC_DB_USERNAME=keycloak KC_DB_PASSWORD="${KEYCLOAK_DB_PASSWORD}"
export KC_BOOTSTRAP_ADMIN_USERNAME=admin KC_BOOTSTRAP_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:?}"
/opt/keycloak/bin/kc.sh start --import-realm &
KC=$!
if ! /bin/bash /opt/keycloak/bin/keycloak-setup.sh; then
  echo "keycloak-setup failed; stopping" >&2
  kill "$KC"; exit 1
fi
wait "$KC"
