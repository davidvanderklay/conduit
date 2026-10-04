# syntax=docker/dockerfile:1

FROM node:26-alpine AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml vite.config.ts ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json

FROM dependencies AS server-build
RUN pnpm --filter @conduit/server... install --frozen-lockfile
COPY apps/server apps/server
RUN pnpm --filter @conduit/server build \
    && pnpm --filter @conduit/server deploy --prod --legacy /prod/server

FROM dependencies AS web-build
RUN pnpm --filter conduit --filter @conduit/web... install --frozen-lockfile
COPY apps/web apps/web
COPY packages/core packages/core
RUN apk add --no-cache curl build-base pkgconf openssl-dev
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack --locked
RUN pnpm core:build && pnpm --filter @conduit/web build

FROM nginx:1.31-alpine AS web
ARG RELEASE_VERSION=development
ARG RELEASE_TAG
ARG RELEASE_REVISION
LABEL org.opencontainers.image.version=$RELEASE_VERSION \
      org.opencontainers.image.ref.name=$RELEASE_TAG \
      org.opencontainers.image.revision=$RELEASE_REVISION
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

# Keep the API as the final stage for hosts that cannot select a build target.
FROM node:26-alpine AS server
ARG RELEASE_VERSION=development
ARG RELEASE_TAG
ARG RELEASE_REVISION
LABEL org.opencontainers.image.version=$RELEASE_VERSION \
      org.opencontainers.image.ref.name=$RELEASE_TAG \
      org.opencontainers.image.revision=$RELEASE_REVISION
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-build /prod/server ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
