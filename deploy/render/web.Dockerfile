# syntax=docker/dockerfile:1.7
# The SPA, served by Caddy, which also routes /api to the API and /auth to Keycloak on the private network.
# Render terminates HTTPS in front of it, so Caddy speaks plain HTTP on $PORT.
FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
RUN corepack enable pnpm
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && pnpm install --frozen-lockfile \
 && pnpm --dir apps/web run build

FROM caddy:2.10.0-alpine
COPY --from=build /app/apps/web/dist /srv
COPY deploy/render/Caddyfile /etc/caddy/Caddyfile
ENV PORT=10000
EXPOSE 10000
