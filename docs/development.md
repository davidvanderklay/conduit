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
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
pnpm install
pnpm core:build
pnpm db:migrate
pnpm dev
```

The development overlay publishes PostgreSQL on `localhost:5432`. Running
`docker compose up -d postgres` without `compose.dev.yaml` starts the
production-only database network and does not expose PostgreSQL to host
commands such as `pnpm db:migrate`.

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

`pnpm check` includes linting, Rust formatting, Clippy, and TypeScript checks.
Use `pnpm lint:fix` for safe JavaScript/TypeScript lint fixes and `pnpm format`
to format the repository. CI only verifies code; it never pushes formatting
changes back to a branch.

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
- Desktop OAuth through the system browser and loopback callback

Never log OAuth codes, recovery tokens, client secrets, password hashes, or full
provider subject identifiers.

## Desktop client

The Tauri 2 client reuses the web interface and delegates playback to embedded
libmpv. Selecting a stream renders libmpv beneath Conduit's controls and supports
seek, pause, embedded tracks, and add-on subtitles.

### Playback buffering policy

The device-level **Network read-ahead** preference defaults to 30 seconds and
can be set from 10 to 120 seconds. Desktop network playback enables mpv's
packet cache, targets three buffered seconds before starting or resuming, keeps up
to 150 MiB forward and 75 MiB backward, retries supported FFmpeg-backed streams,
and uses a 30-second network timeout. Cache duration and current throughput are
reported locally in the player controls.

Desktop caching is intentionally memory-only. mpv's built-in disk cache is a
temporary append-only file that is not reusable after the player closes, so it
cannot provide a predictably bounded persistent cache. Conduit must not present
that mode as an offline download or durable cache.

For HLS sources using HLS.js, the preference controls its forward and backward
buffer targets while the byte target remains 60 MiB. Native HLS and progressive
web playback remain subject to the browser, source response headers, CORS, and
device eviction policy. The UI reports the browser's current buffered range but
does not promise durable storage. Media remains client-to-source on every
platform; the Conduit server never proxies video to force caching.

OAuth on desktop is intentionally different from OAuth in the browser build.
`desktop_auth_listen` binds a short-lived random loopback port, and the frontend
opens the Better Auth authorization URL with Tauri's opener plugin. After the
server callback, `/v1/auth/desktop/exchange` validates the one-time code and
PKCE verifier. The returned desktop session is scoped to the selected server
and sent as a bearer token; changing servers never sends it to the new origin.

Changes to `desktop_auth_request` require applying migration `0008` or later.

For development outside Nix:

- macOS: install libmpv, for example with `brew install mpv`
- Linux: install libmpv development headers, GTK 3, WebKitGTK 4.1, EGL, DBus,
  and pkg-config development packages
- Windows: install Git, Node.js LTS, pnpm (through Corepack), Rust's stable
  MSVC toolchain, Visual Studio 2022 Build Tools with **Desktop development
  with C++**, and the WebView2 Runtime. Then use a regular PowerShell:

  ```powershell
  corepack enable
  pnpm install
  pnpm --filter @conduit/desktop setup:windows
  pnpm core:build
  pnpm dev:desktop
  ```

  `setup:windows` downloads Conduit's pinned `libmpv-2.dll`, verifies its
  SHA-256 digest, generates the matching MSVC import library, and places the
  runtime beside debug and release executables. Override
  `CONDUIT_LIBMPV_URL` and `CONDUIT_LIBMPV_SHA256` together when deliberately
  testing a different build. `pnpm --filter @conduit/desktop build` creates an
  NSIS installer with the DLL included.

Linux playback uses libmpv's OpenGL render API. X11 is supported directly.
Wayland sessions use the native backend by default. `CONDUIT_XWAYLAND=1`
enables the XWayland fallback for diagnostic compatibility testing.

### Windows playback test matrix

Run the debug application first, then repeat the core playback cases with the
installed NSIS release. Record the Windows version, GPU, driver version,
display scale, stream/container, and result.

- Windows 10 22H2 and Windows 11 (current supported release)
- 100%, 125%, 150%, and mixed-DPI displays when available
- H.264/AAC MP4 over HTTPS and a representative HLS stream
- Play/pause, exact and relative seek, volume and mute
- Embedded audio/subtitle track switching and add-on subtitle attachment
- Repeated window resize, maximize/restore, and fullscreen enter/exit
- Move between displays with different scale factors
- Lock/unlock and sleep/resume while paused and while playing
- Close during playback, reopen playback, and exit the application

The Windows renderer gives mpv the Tauri window's native HWND. mpv creates a
D3D11 child window and WebView2 renders Conduit's transparent controls above
it. This follows Harbor's proven Tauri/libmpv layout while leaving the existing
frontend command and event contract unchanged.

## Local recovery CLI

During development:

```sh
pnpm admin:recover
```

The CLI reads the same `.env` as the server and prompts for an email. Test links
against the configured `WEB_ORIGIN`.
