# Postgres 17 with pgvector for Tributary and Keycloak (a separate database and role, created on first start).
FROM pgvector/pgvector:0.8.7-pg17-trixie
# Render disks are mounted at the data directory and contain lost+found, so the cluster lives in a subdirectory.
ENV PGDATA=/var/lib/postgresql/data/pgdata POSTGRES_USER=tributary POSTGRES_DB=tributary
COPY deploy/render/postgres-init.sh /docker-entrypoint-initdb.d/10-keycloak.sh
EXPOSE 5432
