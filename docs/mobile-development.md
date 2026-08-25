# Mobile development and release

Conduit has a shared Compose Multiplatform client for Android and iOS. The
mobile app is no longer an architecture-only spike: it has the product account,
profile, catalog, library, history, and playback flows and is in release
preparation. The current distribution path is a signed universal Android APK
and an unsigned iOS IPA. Neither build is published to Google Play or the App
Store yet.

## Current product scope

The mobile client currently supports:

- first-run server selection with health and authentication-capability checks;
- the default hosted endpoint or a user-provided self-hosted endpoint;
- local sign-in, registration, recovery-code password recovery, and sign-out;
- Google or configured OpenID Connect sign-in through the system browser with
  PKCE and the `conduit://oauth/callback` deep link;
- first-account recovery-code display and household creation;
- household profiles, profile switching, profile creation/editing, kids
  profiles, avatars, and shared primary add-ons;
- synchronized profile state for installed add-ons, library items, watch
  status, history, and continue watching;
- home catalogs, catalog discovery, genre filtering, catalog search, media
  details, seasons, episodes, trailers when supplied by an add-on, stream
  selection, and add-on subtitle discovery;
- native playback with resume position, progress synchronization, seeking,
  playback speed, audio and subtitle selection, subtitle presentation options,
  touch gestures, episode navigation, and lifecycle-safe pause/resume;
- add-on installation, enable/disable, reorder, refresh, and removal;
- device preferences for appearance, navigation, playback, subtitles, and
  diagnostics; and
- an encrypted cached profile snapshot for limited offline access to the
  synchronized library, history, and profile state.

Offline snapshots do not contain media files and do not provide offline
playback. Catalog, metadata, stream, and subtitle requests still go directly
from the device to the installed add-on or media source. The Conduit server
synchronizes account and profile data but does not proxy video.

The following are deliberately outside the current mobile release scope:

- media downloads or durable offline playback;
- casting and remote-control integrations;
- PiP validation across the physical-device matrix;
- P2P playback;
- third-party integrations such as Trakt, debrid providers, Jellyfin, or Plex;
- push notifications and background catalog refresh; and
- store distribution, automated store submission, and production signing for
  iOS.

## Repository layout

- `apps/client/composeApp`: shared Compose UI, account and profile flows,
  networking, state, preferences, and the expect/actual player boundary;
- `apps/client/iosApp`: the small Swift/UIKit host and generated Xcode project;
- `packages/mobile-bridge`: the versioned Rust C ABI used by the retained local
  architecture fixture and native bridge tests;
- `packages/core`: shared Rust add-on parsing and request logic; and
- `apps/client/scripts`: native Rust library and iOS IPA packaging helpers.

The iOS host directory and target retain the historical `ConduitMobileSpike`
name. The product bundle identifier on both platforms is
`media.conduit.mobile`.

The shared app uses Kotlin 2.3.21, Compose Multiplatform 1.10.0, Android Gradle
Plugin 8.10.1, and Ktor 3.5.1. Android playback uses Media3 1.10.1 with an
experimental libmpv fallback. iOS playback uses the pinned NuvioMedia MPVKit
revision in `apps/client/iosApp/project.yml`.

## Platform-neutral checks

Run these from the repository root:

```sh
cargo test -p conduit-core -p conduit-mobile
cargo fmt --all -- --check
cargo clippy -p conduit-mobile --all-targets -- -D warnings
cd apps/client
./gradlew :composeApp:compileCommonMainKotlinMetadata
```

The Gradle tasks require JDK 17. iOS compilation and packaging require macOS
and Xcode. The mobile workflows run common checks in CI through the Android and
iOS-specific workflows:

- `.github/workflows/mobile-android.yml` builds the Rust Android libraries,
  runs JVM tests, and assembles a debug APK;
- `.github/workflows/mobile-ios.yml` builds the Rust Apple libraries and runs
  the iOS simulator test target; and
- `.github/workflows/release.yml` packages the Android APK and iOS IPA on a
  version tag or through its manual `android` and `ios` targets.

## Android development

Install Android Studio, JDK 17, SDK Platform 36, Build Tools 36, NDK
28.2.13676358, Rust through `rustup`, and the pinned `cargo-ndk`:

```sh
cargo install cargo-ndk --version 3.5.4 --locked
rustup target add aarch64-linux-android x86_64-linux-android
ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358" \
  apps/client/scripts/build-rust-android.sh
cd apps/client
./gradlew :composeApp:installDebug
adb shell am start -n media.conduit.mobile/.MainActivity
```

Android supports API 26 and newer. The debug build includes ARM64 and x86_64
native libraries. Keep SDK paths in `local.properties`; do not commit them.

For an emulator connected to a development server on the host, use
`http://10.0.2.2:3000` as the server URL. The app accepts HTTP for local
development addresses and requires HTTPS for non-local servers.

The focused Android checks are:

```sh
cd apps/client
./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug
./gradlew :composeApp:connectedDebugAndroidTest
```

Exercise server validation, local sign-in and registration, recovery codes,
household creation, profile switching, add-on installation, catalog search,
stream selection, playback, watch progress, subtitle and audio selection,
background/foreground transitions, rotation, and the OAuth deep link. Verify
that the cached library and history remain visible after stopping the server,
and that signing out removes access to the cached session.

On NixOS, Android's generic Linux binaries may need an FHS environment. If
AAPT2 or the NDK compiler cannot start, stop existing Gradle daemons and run
the Gradle command inside an appropriate `steam-run` or equivalent FHS shell.

## iOS development

Install Xcode and its command-line tools, XcodeGen, JDK 17, and Rust through
`rustup`:

```sh
apps/client/scripts/build-rust-ios.sh
cd apps/client
./gradlew :composeApp:allTests
cd iosApp
xcodegen generate
open ConduitMobileSpike.xcodeproj
```

The generated project resolves the pinned MPVKit package through Swift Package
Manager. The first Xcode build downloads its package and binary framework
dependencies. The Compose app owns the shared UI and playback controls while
the Swift/UIKit host owns the native player, decoded frames, audio session,
PiP, and orientation handoff.

The app requires iOS 15 or newer. The normal app is portrait-oriented; the
player takes ownership of both landscape orientations and restores portrait
when playback closes. For a device build, select a development team in Xcode.
No signing identity is committed to the repository.

Exercise the same account, profile, add-on, catalog, playback, progress,
subtitle, audio, and OAuth cases as Android. Also test background/foreground,
lock/unlock, rotation, interruptions, repeated player open/close cycles, PiP,
and memory cleanup on a physical iPhone and iPad. The Apple mobile target is
GPLv3; see [`apps/client/iosApp/LICENSE`](../apps/client/iosApp/LICENSE) and
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) before distributing a
release.

## Mobile authentication and storage

The app stores the selected server and device preferences in platform settings.
The bearer session, pending OAuth request, and cached profile snapshot use the
platform secure store:

- Android uses an AES-GCM value encrypted by a non-exportable Android Keystore
  key;
- iOS uses a Keychain item scoped to this device; and
- both platforms keep the server URL with the session, so a token is never
  sent to a different selected server.

Mobile OAuth uses the system browser. The app creates a PKCE verifier, starts a
short-lived request at `/v1/auth/mobile/start`, saves the pending request before
opening the browser, and receives only a one-time code at
`conduit://oauth/callback`. The app verifies the request ID and exchanges the
code and verifier at `/v1/auth/mobile/exchange` for a seven-day mobile bearer
session. A cancelled, mismatched, expired, or replayed callback must not create
a session.

The server-side authentication model is documented in
[Authentication and account recovery](authentication.md).

## Release packaging

Create a semantic version tag to run the complete release workflow:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow publishes these mobile artifacts with the GitHub release:

- `conduit-<version>-android-universal.apk`, a signed APK containing ARM64
  and x86_64 native libraries, plus a SHA-256 checksum;
- `conduit-<version>-ios-unsigned.ipa`, an arm64 device IPA, plus a SHA-256
  checksum.

Android release signing requires the four `ANDROID_KEYSTORE_*` Actions secrets
described in [Releases](releases.md#android). The same keystore must be kept
for every update. iOS packaging intentionally disables code signing and is
useful for sideloading environments or a later signing step. It is not a
store-ready submission.

To build the mobile release targets without publishing a tag, run the release
workflow manually and choose `android` or `ios`. For local IPA packaging, use
the commands in [Releases](releases.md#ios).
