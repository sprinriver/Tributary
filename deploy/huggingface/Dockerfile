# syntax=docker/dockerfile:1.7
# Tributary as ONE container, for a free Hugging Face Docker Space (public demo; data resets on restart).
# Inside: Postgres + pgvector, SeaweedFS (S3), Keycloak, compute (Python), query + API (Node), Caddy on 7860.
#
# The Space builds from the public GitHub repository (stage "source"). To build from a local checkout instead:
#   docker build -f deploy/huggingface/Dockerfile --build-context source=. -t tributary-space .

ARG TRIBUTARY_REPO=https://github.com/sprinriver/Tributary.git
ARG TRIBUTARY_REF=main

FROM alpine:3.22 AS clone
ARG TRIBUTARY_REPO
ARG TRIBUTARY_REF
RUN apk add --no-cache git \
 && git clone --depth 1 --branch "${TRIBUTARY_REF}" "${TRIBUTARY_REPO}" /src && rm -rf /src/.git

# The repository at the root of a stage (replaced by --build-context source=. for local builds).
FROM scratch AS source
COPY --from=clone /src /

# ---- Node: the web build, then production dependencies for the API and query service ----
FROM node:24.22.1-bookworm-slim AS web
WORKDIR /app
RUN corepack enable pnpm
COPY --from=source . /app
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && pnpm install --frozen-lockfile && pnpm --dir apps/web run build

FROM node:24.22.1-bookworm-slim AS app
WORKDIR /app
RUN corepack enable pnpm
COPY --from=source . /app
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && pnpm install --frozen-lockfile --prod && rm -rf apps/web/src e2e

FROM keycloak/keycloak:26.8.1 AS keycloak
# Bake the build-time options so the container starts with --optimized.
RUN /opt/keycloak/bin/kc.sh build --db=postgres --health-enabled=true --http-relative-path=/auth
# Keycloak's own Java 21 runtime, copied with symlinks resolved so it is self-contained (no apt in the final image).
USER root
RUN cp -rL /usr/lib/jvm/jre-21-openjdk /opt/java

# ---- Compute (FastAPI) on Python 3.12 from the locked dependencies ----
FROM python:3.12.12-slim-trixie AS compute
COPY --from=source /apps/compute/pyproject.toml /apps/compute/uv.lock /app/apps/compute/
WORKDIR /app/apps/compute
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export SSL_CERT_FILE=/run/secrets/ca PIP_CERT=/run/secrets/ca; fi \
 && pip install --no-cache-dir uv==0.11.32 \
 && uv sync --frozen --no-dev --no-install-project --python /usr/local/bin/python3.12

FROM chrislusf/seaweedfs:4.51 AS seaweedfs
FROM caddy:2.10.0-alpine AS caddy

# ---- Runtime: Debian trixie with Postgres 17 + pgvector ----
FROM pgvector/pgvector:0.8.7-pg17-trixie
COPY --from=keycloak /opt/java /opt/java
ENV JAVA_HOME=/opt/java PATH=/opt/java/bin:$PATH
COPY --from=node:24.22.1-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=seaweedfs /usr/bin/weed /usr/local/bin/weed
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=keycloak /opt/keycloak /opt/keycloak
COPY --from=app /app /app
COPY --from=web /app/apps/web/dist /srv

# Python 3.12 (same paths as in the compute stage, so the virtualenv's interpreter link stays valid).
COPY --from=compute /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=compute /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=compute /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/
COPY --from=compute /opt/venv /opt/venv
RUN ldconfig

COPY --from=source /deploy/huggingface/start.sh /deploy/huggingface/Caddyfile /deploy/render/keycloak-setup.sh /opt/tributary/
COPY --from=source /infra/local/keycloak/tributary-realm.json /opt/keycloak/data/import/tributary-realm.json

# Hugging Face runs the container as uid 1000 with HOME=/home/user; everything it writes lives there.
RUN useradd -m -u 1000 user \
 && chown -R user:user /opt/keycloak /app \
 && chmod +x /opt/tributary/*.sh
USER user
ENV HOME=/home/user PORT=7860 NODE_ENV=production
EXPOSE 7860
CMD ["/bin/bash", "/opt/tributary/start.sh"]
