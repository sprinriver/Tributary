#!/bin/bash
# Idempotent: points the tributary client at PUBLIC_URL with this deployment's secret, requires HTTPS for external
# requests (except plain-http local trials), and sets user passwords. The imported realm only carries dev values.
set -euo pipefail
KC=/opt/keycloak/bin/kcadm.sh
URL="${PUBLIC_URL%/}"
for i in $(seq 1 90); do
  $KC config credentials --server http://localhost:8080/auth --realm master \
    --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1 && break
  [ "$i" -eq 90 ] && { echo "keycloak did not start" >&2; exit 1; }
  sleep 5
done
SSL=external; case "$URL" in http://*) SSL=none ;; esac
$KC update realms/tributary -s "sslRequired=${SSL}" -s registrationAllowed=false -s bruteForceProtected=true
CLIENT_ID=$($KC get clients -r tributary -q clientId=tributary-api --fields id --format csv --noquotes)
$KC update "clients/${CLIENT_ID}" -r tributary \
  -s "secret=${OIDC_CLIENT_SECRET:?}" \
  -s "redirectUris=[\"${URL}/api/v1/auth/callback\"]" \
  -s "webOrigins=[\"${URL}\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=${URL}/*"
$KC set-password -r tributary --username admin --new-password "${TRIBUTARY_ADMIN_PASSWORD:?}"
# Demo users get the passwords published in DEMO_LOGINS ("user:password,…"); without it they get random ones.
IFS=',' read -ra LOGINS <<< "${DEMO_LOGINS:-}"
for user in scientist viewer; do
  password=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
  for pair in "${LOGINS[@]}"; do
    pair="${pair#"${pair%%[![:space:]]*}"}"
    [ "${pair%%:*}" = "$user" ] && password="${pair#*:}"
  done
  $KC set-password -r tributary --username "$user" --new-password "$password"
done
echo "keycloak-setup: realm tributary configured for ${URL}"
