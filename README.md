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
embedded libmpv. The Nix shell supplies libmpv and the Tauri CLI:

```sh
pnpm dev:server
pnpm dev:desktop
```

The first command runs the household sync server. The second starts the shared
Vite interface inside the native desktop shell. Selecting a stream renders
libmpv beneath Conduit's controls in the same window; Conduit can seek, pause,
enumerate and select embedded audio/subtitle tracks, and attach subtitles
returned by installed add-ons.

For development outside Nix, install the libmpv development package. macOS
builds can use `brew install mpv`; Linux builds need their distribution's
libmpv development package plus the GTK 3, WebKitGTK 4.1, EGL, DBus, and
pkg-config development packages. Windows release builds will bundle a matching
libmpv DLL and import library.

Linux desktop playback uses libmpv's OpenGL render API in a GTK surface below
the transparent WebKit controls. X11 is supported directly; Wayland sessions
use XWayland by default because native WebKitGTK input and presentation
surfaces become stale when layered over `GtkGLArea`. Set
`CONDUIT_NATIVE_WAYLAND=1` to test the experimental native Wayland path.
Conduit disables WebKit's DMA-BUF renderer on native Wayland and NVIDIA
drivers to avoid explicit-sync and GBM allocation failures. Set
`WEBKIT_DISABLE_DMABUF_RENDERER=0` to override that workaround.

Configured add-on URLs are encrypted in PostgreSQL and synchronized to
authorized household clients. Clients fetch add-on catalogs, metadata, streams,
and subtitles directly; the sync server does not proxy add-on or media traffic.
