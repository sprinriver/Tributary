#!/bin/sh
# Runs once, when the data directory is first created: Keycloak's own role and database.
set -eu
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v kcpass="$KEYCLOAK_DB_PASSWORD" <<'SQL'
create role keycloak login password :'kcpass';
create database keycloak owner keycloak;
SQL
