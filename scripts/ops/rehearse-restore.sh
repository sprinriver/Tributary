#!/bin/sh
# Backup/restore rehearsal on the local stack (docs/RUNBOOK.md): dump the database, restore it into a scratch
# database, and compare every table's row count; archive the object store and check the archive lists objects.
# Never touches anything but the local Docker Compose stack.
set -eu
cd "$(dirname "$0")/../.."
OUT="${TMPDIR:-/tmp}/tributary-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
PG="docker compose exec -T postgres"

echo "== backup: pg_dump (custom format) -> $OUT/tributary.dump"
$PG pg_dump -U tributary -d tributary -Fc > "$OUT/tributary.dump"
ls -l "$OUT/tributary.dump" | awk '{print "   size", $5, "bytes"}'

echo "== restore into tributary_restore"
$PG psql -U tributary -d postgres -q -c 'drop database if exists tributary_restore' -c 'create database tributary_restore'
# Roles (tributary_app, tributary_query_ro) are cluster-wide and already exist; ownership is kept.
$PG pg_restore -U tributary -d tributary_restore --exit-on-error < "$OUT/tributary.dump"

echo "== compare row counts (source vs restored)"
COUNTS="select table_schema||'.'||table_name from information_schema.tables where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by 1"
diffs=0; tables=0
for t in $($PG psql -U tributary -d tributary -At -c "$COUNTS"); do
  a=$($PG psql -U tributary -d tributary -At -c "select count(*) from $t")
  b=$($PG psql -U tributary -d tributary_restore -At -c "select count(*) from $t")
  tables=$((tables + 1))
  if [ "$a" != "$b" ]; then echo "   MISMATCH $t: $a vs $b"; diffs=$((diffs + 1)); fi
done
echo "   $tables tables compared, $diffs mismatches"
$PG psql -U tributary -d postgres -q -c 'drop database tributary_restore'

echo "== object store: archive the SeaweedFS volume"
docker run --rm --volumes-from "$(docker compose ps -q seaweedfs)" -v "$OUT:/backup" alpine:3.22 \
  tar czf /backup/seaweedfs.tar.gz -C /data . 
echo "   $(tar tzf "$OUT/seaweedfs.tar.gz" | wc -l) entries in seaweedfs.tar.gz"
[ "$diffs" -eq 0 ] && echo "rehearsal: OK ($OUT)" || { echo "rehearsal: FAILED"; exit 1; }
