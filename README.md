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
The browsing window stays opaque, while the WebView itself becomes transparent
over libmpv only during playback. Native Wayland and NVIDIA drivers disable
WebKit's DMA-BUF renderer to avoid explicit-sync and GBM allocation failures;
set `WEBKIT_DISABLE_DMABUF_RENDERER=0` to override that workaround.

Configured add-on URLs are encrypted in PostgreSQL and synchronized to
authorized household clients. Clients fetch add-on catalogs, metadata, streams,
and subtitles directly; the sync server does not proxy add-on or media traffic.

## Instance authentication

The first local account created after installation becomes the instance owner.
Later local registration is closed by default. The owner can open registration
or configure Google login directly—or a custom OpenID Connect provider—at `/admin`. OAuth client secrets are
encrypted with `ADDON_ENCRYPTION_KEY` and are never returned to the browser
after being saved. Restart the server after changing authentication settings.

For Google, create an OAuth 2.0 Web application in Google Cloud and paste its
client ID and client secret into Conduit; no separate identity server is
required. Configure Google with the callback URL shown on the admin page.
Custom OIDC discovery, PKCE, and account creation are handled by Better Auth.
Automatic OAuth registration remains off unless the owner explicitly enables it.

Conduit does not require an account name and does not send password-reset email.
Local users receive ten one-time recovery codes during account creation. Losing
both the password and every recovery code means the instance owner must assist
outside the application. Profile exports are a separate safeguard: users should
export them regularly to preserve profiles, libraries, and watch history even
when an account cannot be recovered.

The `/admin` page and `/v1/admin/*` endpoints require the instance-owner role.
Hosts that want network-level isolation can additionally restrict both paths
through their reverse proxy or VPN.
