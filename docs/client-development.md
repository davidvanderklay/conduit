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

Run it from a shell containing JDK 17, `pkg-config`, a C++17 compiler, and mpv
development headers:

```sh
cd apps/client
./gradlew :composeApp:run
```

The Linux bridge creates an X11 child surface and passes its window ID to mpv.
It prefers `x11egl` with `hwdec=auto-safe`, then retries with `x11vk` and
`nvdec-copy`. Override those choices with `CONDUIT_MPV_GPU_CONTEXT` and
`CONDUIT_MPV_HWDEC` when diagnosing a driver-specific failure.

This is an alpha path. The heavyweight video surface is in place, but the
GTK/WebKitGTK/XComposite controls overlay used by the reference Linux
architecture is not implemented yet. Compose controls can therefore be hidden
behind video on Linux. Desktop tokens also use an in-memory store until native
credential-store adapters are added.

## Web

The browser target uses Kotlin/Wasm and Compose HTML canvas rendering. It shares
the product UI and API model with the native clients. Browser OAuth, persistent
progress storage, and browser video playback remain migration work.

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
