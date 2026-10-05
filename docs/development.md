# Development guide

## Repository layout

- `apps/web`: React web interface shared with desktop
- `apps/server`: Fastify API, Better Auth, Drizzle, and PostgreSQL
- `apps/desktop`: Electron shell and native libmpv playback
- `apps/mobile`: shared Compose Multiplatform Android/iOS client and native
  playback hosts
- `packages/core`: shared Rust client policy compiled to WebAssembly and native
  mobile libraries
- `packages/mobile-bridge`: Rust C ABI for stateless domain calls and the
  retained mobile architecture fixture
- `docs`: user, operator, format, and roadmap documentation

## Prerequisites

The supported development environment is the repository's Nix flake. Install
Nix with flakes and `nix-command` enabled, then enter the shell from your
checkout:

```sh
nix develop
```

Alternatively, install direnv and enable its shell hook, then allow this
repository's `.envrc` to enter the same shell automatically:

```sh
direnv allow
```

Without Nix, the minimal web/server toolchain is Node.js 22, pnpm 10.14.0,
stable Rust with the `wasm32-unknown-unknown` target, wasm-pack, and Docker
Compose v2 for local PostgreSQL. The root `packageManager` field pins pnpm;
CI uses Node.js 22. Install the Rust target with:

```sh
rustup target add wasm32-unknown-unknown
```

Desktop development additionally needs Electron and libmpv dependencies listed
below. Mobile uses its own Android/iOS toolchains. You do not need those native
client dependencies to work on web or server code. The Nix shell includes the
desktop dependencies but does not install Docker or start its daemon; Docker
must already be available.

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

## Start web and server development

```sh
docker compose -f compose.source.yaml -f compose.dev.yaml up -d postgres
pnpm install --frozen-lockfile
pnpm core:build
pnpm --filter @conduit/updates build
pnpm db:migrate
pnpm dev
```

Open `http://localhost:5173`. The API is at `http://localhost:3000` and
`GET /health` should succeed. Register a disposable local account, create a
household and profile, then install an add-on from its manifest URL to browse
catalogs. The local `first-user` bootstrap mode makes the first account the
owner; OAuth setup is optional for ordinary development.

The updates package is built explicitly because the server's development
command imports its compiled output. Rebuild it after editing that package.

The development overlay publishes PostgreSQL on `localhost:5432`. Running
`docker compose up -d postgres` without `compose.dev.yaml` starts the
production-only database network and does not expose PostgreSQL to host
commands such as `pnpm db:migrate`.

If port 5432 is already in use, change both `POSTGRES_PORT` and the port in
`DATABASE_URL` in `.env`. To isolate a checkout's database from other Conduit
checkouts, add `-p conduit-my-branch` to every Compose command for that checkout.
Use the same project name when stopping it:

```sh
docker compose -p conduit-my-branch -f compose.source.yaml -f compose.dev.yaml stop postgres
```

Stopping preserves the database volume. Avoid `down -v` unless you intend to
delete that project's data.

Run individual applications:

```sh
pnpm dev:server
pnpm dev:web
pnpm dev:desktop
```

The Electron desktop shell uses Chromium for the UI and a native libmpv bridge. On macOS the bridge is an in-process Rust Node-API addon (Cocoa `NSView` pointers cannot cross a process boundary). On Windows it also runs in-process, on Linux it runs as an isolated helper process behind X11. Use `pnpm dev:desktop` for the Electron app (`pnpm dev:electron` is an alias).

macOS uses an in-process OpenGL render view below Chromium, Windows embeds mpv
with the Electron window's HWND, and Linux uses its X11 window ID. Native
Wayland does not expose an X11-compatible window ID, so Linux launches through
X11/Ozone by default. Set `CONDUIT_ELECTRON_OZONE=wayland` only when testing the
UI without embedded playback:

```sh
CONDUIT_ELECTRON_OZONE=wayland pnpm dev:electron
```

If X11/Ozone reproduces a Chromium GPU-process crash on an Nvidia driver,
launch the embedded-player mode with Electron's GPU work kept in-process. This
keeps Chromium accelerated while avoiding the crashing GPU subprocess:

```sh
CONDUIT_ELECTRON_OZONE=x11 CONDUIT_ELECTRON_IN_PROCESS_GPU=1 pnpm dev:electron
```

For GPU-driver diagnosis only, software rendering can still be forced with
`CONDUIT_ELECTRON_OZONE=x11 CONDUIT_ELECTRON_DISABLE_GPU=1`.

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

For web/server work, run the affected package's checks without building desktop:

```sh
pnpm lint
cargo fmt --all -- --check
cargo test -p conduit-core -p conduit-mobile
pnpm --filter @conduit/server check
pnpm --filter @conduit/server test
pnpm --filter @conduit/web check
pnpm --filter @conduit/web test
pnpm --filter @conduit/server build
pnpm --filter @conduit/web build
```

Run the relevant subset for a focused change. Server integration tests use
Testcontainers to start their own disposable PostgreSQL containers, so Docker
must be running and your user must be able to access it. They do not use your
development database. Web tests require the generated `packages/core/pkg`
output from `pnpm core:build`.

The full repository commands below also include desktop/native Rust checks
and tests. They require the desktop dependencies; root task commands use a
POSIX shell, so use Nix or a suitable Linux/WSL environment for those commands
on Windows. The Windows desktop commands below run in PowerShell.

```sh
pnpm check
pnpm test
pnpm build
```

`pnpm check` includes linting, Rust formatting, Clippy, and TypeScript checks.
Use `pnpm lint:fix` for safe JavaScript/TypeScript lint fixes and `pnpm format`
to format the repository. CI only verifies code; it never pushes formatting
changes back to a branch.

Mobile development has platform-specific toolchains and a separate release
path. Use [Mobile development and release](mobile-development.md) for Android
and iOS prerequisites, native library setup, device checks, OAuth testing, and
APK/IPA packaging. The mobile CI workflows are:

- `.github/workflows/mobile-android.yml`, which builds the Android Rust
  libraries, runs unit tests, and assembles a debug APK;
- `.github/workflows/mobile-ios.yml`, which builds the Apple Rust libraries and
  runs the iOS simulator tests; and
- `.github/workflows/release-android.yml` and `release-ios.yml`, which package
  Android and iOS independently from their component tags.

Desktop packaging uses `.github/workflows/release.yml`; server and web use
`container-release.yml`. See [Releases](releases.md) for tag formats and
[Updates](updates.md) for scheduled Nightly builds from `main`.

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

The mobile client has its own secure session vault and profile snapshot cache.
Android uses Android Keystore-backed AES-GCM storage and iOS uses the Keychain.
Do not replace either adapter with ordinary preferences or local files. Mobile
catalog, metadata, stream, and subtitle requests remain direct device-to-source
requests, so mobile changes must preserve the same add-on URL and credential
handling rules as the web client.

## Desktop client

The Electron client reuses the web interface and delegates playback to embedded
libmpv. Selecting a stream renders libmpv beneath Conduit's controls and supports
seek, pause, embedded tracks, and add-on subtitles.

### Playback buffering policy

The device-level **Network read-ahead** preference defaults to 30 seconds and
can be set from 10 to 120 seconds. Desktop network playback enables mpv's
packet cache, targets three buffered seconds before starting or resuming, keeps up
to 150 MiB forward and 75 MiB backward, retries supported FFmpeg-backed streams,
and uses a 30-second network timeout. The seek timeline shows the currently
buffered extent without adding diagnostic text to the player controls.

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
opens the Better Auth authorization URL through the Electron shell. After the
server callback, `/v1/auth/desktop/exchange` validates the one-time code and
PKCE verifier. The returned desktop session is scoped to the selected server
and sent as a bearer token; changing servers never sends it to the new origin.

Changes to `desktop_auth_request` require applying migration `0008` or later.

For development outside Nix:

- macOS: install libmpv, for example with `brew install mpv`
- Linux: install libmpv development headers, EGL, DBus,
  and pkg-config development packages
- Windows: install Git, Node.js LTS, pnpm (through Corepack), Rust's stable
  MSVC toolchain, Visual Studio 2022 Build Tools with **Desktop development
  with C++**, Then use a regular PowerShell:

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

Linux playback uses libmpv's OpenGL render API through X11/Ozone. The packaged
app and development launcher use X11 by default because native Wayland does not
provide the window ID required by the embedded player.
For Electron GPU-driver troubleshooting, use the environment variables in
[Start web and server development](#start-web-and-server-development).

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

The Windows renderer gives mpv the Electron window's native HWND. mpv creates a
D3D11 child window and Electron renders Conduit's transparent controls above
it.

## Local recovery CLI

During development:

```sh
pnpm admin:recover
```

The CLI reads the same `.env` as the server and prompts for an email. Test links
against the configured `WEB_ORIGIN`.

## Documentation

The [documentation site](https://davidvanderklay.github.io/conduit/docs/) is built
with MkDocs and Material from `docs/`. Its layout has topic navigation, an
article, and a page outline, with search and a black background. Keep new pages
in `mkdocs.yml` so they appear in navigation. Python 3.12 is used in CI.

Install and preview locally from the repository root:

```sh
python3 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install -r requirements-docs.txt
python -m mkdocs serve
```

MkDocs serves the documentation at `http://127.0.0.1:8000/conduit/docs/`.
Validate before committing:

```sh
python -m mkdocs build --strict
python -m unittest discover -s scripts -p test_pages_site.py
```

CI builds docs strictly, including page and anchor validation, and tests that
assembling Pages preserves Flatpak files. Links to source files outside `docs/`
should use GitHub URLs, because those files are not part of the site.

`.github/workflows/pages.yml` is the only Pages publisher. Documentation changes
on `main` trigger it; desktop releases call it after updating the signed
`flatpak-repo` branch. It can also be run manually. One concurrency group covers
the checkout, build, and deployment. Each run reads current `main` and
`flatpak-repo`, builds docs under `/conduit/docs/`, and preserves Flatpak files
at their original URLs. It never writes to the signed repository branch.

GitHub Pages must use **GitHub Actions** as its source. The publisher requires
an existing signed `flatpak-repo`; missing required files fail the run rather
than deploying a docs-only site. Fix that input and rerun the publisher if a
release updated the branch but Pages failed. Do not use `mkdocs gh-deploy` or add
a second Pages deployment workflow: either could replace the Flatpak site.
