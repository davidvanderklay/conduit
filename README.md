# Conduit

Conduit is an open-source, self-hostable media system built around a shared
client engine. Clients contact Stremio-compatible add-ons directly, while a
Conduit server synchronizes household state, profiles, configured add-ons,
libraries, and watch progress.

## Development

Prerequisites are supplied by Nix:

```sh
direnv allow
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm core:build
pnpm db:migrate
pnpm dev
```

The web client runs at `http://localhost:5173` and the sync server at
`http://localhost:3000`.

### Desktop client

The Tauri 2 desktop client reuses the web interface and delegates playback to
mpv over a private local IPC connection. The Nix shell supplies both mpv and
the Tauri CLI:

```sh
pnpm dev:server
pnpm dev:desktop
```

The first command runs the household sync server. The second starts the shared
Vite interface inside the native desktop shell. Selecting a stream opens mpv's
native playback window; Conduit can seek, pause, enumerate and select embedded
audio/subtitle tracks, and attach subtitles returned by installed add-ons.

For development outside Nix, install mpv and ensure it is available on `PATH`,
or set `CONDUIT_MPV_PATH` to its executable. The current sidecar backend is the
first desktop milestone and intentionally sits behind a player abstraction; a
later libmpv render backend can embed video in the Conduit window without
changing catalog, add-on, or playback UI contracts.

Configured add-on URLs are encrypted in PostgreSQL and synchronized to
authorized household clients. Clients fetch add-on catalogs, metadata, streams,
and subtitles directly; the sync server does not proxy add-on or media traffic.
