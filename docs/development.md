# Development guide

## Repository layout

- `apps/web`: React web interface shared with desktop
- `apps/server`: Fastify API, Better Auth, Drizzle, and PostgreSQL
- `apps/desktop`: Tauri shell and native libmpv playback
- `packages/core`: Rust client engine compiled to WebAssembly
- `docs`: user, operator, format, and roadmap documentation

## Prerequisites

The supported development environment is the repository's Nix flake:

```sh
direnv allow
```

Without Nix, install Node.js, pnpm, Rust, wasm-pack, PostgreSQL, and the native
dependencies required by Tauri and libmpv.

## Environment

Create the local environment file:

```sh
cp .env.example .env
```

Important variables:

- `DATABASE_URL`: PostgreSQL connection string
- `BETTER_AUTH_SECRET`: random secret of at least 32 characters
- `BETTER_AUTH_URL`: public API/auth base URL
- `ADDON_ENCRYPTION_KEY`: 64 hexadecimal characters in production
- `WEB_ORIGIN`: allowed browser origin and recovery-link origin
- `PORT`: API listen port
- `VITE_API_URL`: API origin compiled into the web client as its default server

The sign-in screen's **Change server** flow stores a custom API URL under
`conduit:server-url` in local storage and reloads the app so both Better Auth and
ordinary API requests use the same origin. It verifies `GET /health` before
saving. Use **Default server** in that flow to remove the override.

Generate secrets with a cryptographically secure tool, for example:

```sh
openssl rand -hex 32
```

Never commit `.env`.

## Start development

```sh
docker compose up -d postgres
pnpm install
pnpm core:build
pnpm db:migrate
pnpm dev
```

Run individual applications:

```sh
pnpm dev:server
pnpm dev:web
pnpm dev:desktop
```

## Database migrations

Edit `apps/server/src/db/schema.ts`, then generate and review SQL:

```sh
pnpm db:generate
```

Apply pending migrations:

```sh
pnpm db:migrate
```

Generated SQL, snapshots, and the Drizzle journal must be committed together.
Data backfills or preservation statements may be added to the generated SQL,
but ensure the schema snapshot still represents the final structure.

## Checks and tests

```sh
pnpm check
pnpm test
pnpm build
```

Server and web packages can be checked independently:

```sh
pnpm --filter @conduit/server check
pnpm --filter @conduit/server test
pnpm --filter @conduit/web check
pnpm --filter @conduit/web test
```

Authentication changes should be tested with:

- A new local account
- An existing local account linking Google
- A new OAuth account
- OAuth-only mode
- Recovery-code password restoration
- `pnpm admin:recover`
- Provider rotation with the same verified email

Never log OAuth codes, recovery tokens, client secrets, password hashes, or full
provider subject identifiers.

## Desktop client

The Tauri 2 client reuses the web interface and delegates playback to embedded
libmpv. Selecting a stream renders libmpv beneath Conduit's controls and supports
seek, pause, embedded tracks, and add-on subtitles.

For development outside Nix:

- macOS: install libmpv, for example with `brew install mpv`
- Linux: install libmpv development headers, GTK 3, WebKitGTK 4.1, EGL, DBus,
  and pkg-config development packages

Linux playback uses libmpv's OpenGL render API. X11 is supported directly.
Wayland uses XWayland by default; `CONDUIT_NATIVE_WAYLAND=1` enables the
experimental native path.

## Local recovery CLI

During development:

```sh
pnpm admin:recover
```

The CLI reads the same `.env` as the server and prompts for an email. Test links
against the configured `WEB_ORIGIN`.
