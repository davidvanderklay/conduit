# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml vite.config.ts ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/core/Cargo.toml packages/core/Cargo.toml
RUN corepack pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/core packages/core
RUN apk add --no-cache curl build-base pkgconf openssl-dev
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack --locked
RUN corepack pnpm core:build \
    && corepack pnpm --filter @conduit/server build \
    && corepack pnpm --filter @conduit/web build \
    && corepack pnpm --filter @conduit/server deploy --prod --legacy /prod/server

FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

# Keep the API as the final stage so platforms that do not support selecting a
# Docker build target deploy the server. Compose selects both stages explicitly.
FROM node:22-alpine AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/server ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
