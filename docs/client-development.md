# Shared client development

`apps/client` is Conduit's Compose Multiplatform client for Android, iOS,
desktop, and the web. The existing React web app and Electron desktop app stay
in the repository while this rewrite reaches feature parity.

The shared source set owns navigation, account and profile flows, catalogs,
library and history, details, preferences, and playback state. Platform source
sets own HTTP engines, storage, browser integration, and native video surfaces.

## Desktop

The JVM desktop target currently supports the shared product interface,
desktop navigation rail, SQLite progress storage, browser-based authentication,
and an embedded libmpv surface on Linux.

Inside the repository's Nix shell, run it from the repository root. The shell
also supplies the Linux OpenGL, X11, GTK, WebKitGTK, and Secret Service runtime
libraries required by Skiko and the native adapters:

```sh
nix develop
cd apps/client
./gradlew :composeApp:run
```

Only enter the commands inside the code block. The opening and closing fence
markers are Markdown, not shell input. Outside Nix, the same command requires
JDK 17, `pkg-config`, a C++17 compiler, mpv development headers, and the
desktop runtime libraries.

The Linux bridge creates an X11 child surface and passes its window ID to mpv.
It prefers `x11egl` with `hwdec=auto-safe`, then retries with `x11vk` and
`nvdec-copy`. Override those choices with `CONDUIT_MPV_GPU_CONTEXT` and
`CONDUIT_MPV_HWDEC` when diagnosing a driver-specific failure.

Desktop OAuth opens the system browser, listens on a random loopback port, and
uses the `/v1/auth/desktop/*` endpoints. The browser returns to the local
listener, not to the mobile `conduit://` deep link.

This is an alpha path. The heavyweight video surface is in place, but the
GTK/WebKitGTK/XComposite controls overlay used by the reference Linux
architecture is not implemented yet. Compose controls can therefore be hidden
behind video on Linux. Linux desktop tokens use Secret Service through
`secret-tool` when a user keyring is available. Minimal or headless sessions
fall back to memory and must not be treated as durable authentication.

## Web

The browser target uses Kotlin/Wasm and Compose HTML canvas rendering. It shares
the product UI and API model with the native clients. Browser OAuth uses the
configured `WEB_ORIGIN/oauth/callback`, bearer tokens stay in session storage,
and playback checkpoints stay in local storage. Browser video uses an HTML
video element behind the Compose canvas and remains subject to browser codec
and CORS limits.

The web host must serve the Wasm app's `index.html` for `/oauth/callback` and
the server's `WEB_ORIGIN` must match that public origin exactly.

Kotlin's Wasm tooling uses the Node and Yarn installations already available on
the host:

```sh
cd apps/client
./gradlew :composeApp:wasmJsBrowserDevelopmentExecutableDistribution
```

The development bundle is written under
`composeApp/build/dist/wasmJs/developmentExecutable`.

## Verification

```sh
cd apps/client
./gradlew \
  :composeApp:testDebugUnitTest \
  :composeApp:desktopTest \
  :composeApp:buildLinuxPlayerBridge \
  :composeApp:desktopJar \
  :composeApp:wasmJsBrowserDevelopmentExecutableDistribution
```

iOS builds still require macOS and Xcode. Android builds require the SDK values
documented in [Mobile development and release](mobile-development.md).
