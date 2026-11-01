# syntax=docker/dockerfile:1.7
# The API and the query service (TypeScript run directly by Node 24; no build step). One image, two commands:
# render.yaml starts the API with the default CMD and the query service with dockerCommand.
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=ca,src=/path/to/ca.pem …
FROM node:24.22.1-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable pnpm
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && pnpm install --frozen-lockfile --prod \
 && rm -rf apps/web apps/compute

FROM node:24.22.1-bookworm-slim
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000 QUERY_HOST=0.0.0.0 QUERY_PORT=3100
WORKDIR /app
COPY --from=deps --chown=node:node /app /app
USER node
EXPOSE 3000 3100
CMD ["node", "apps/api/src/server.ts"]
