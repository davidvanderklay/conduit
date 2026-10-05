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
  touch gestures, episode navigation, background audio, and lock-screen media
  controls;
- add-on installation, enable/disable, reorder, refresh, and removal;
- profile JSON export and import with server preview, merge, and confirmed replacement;
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

- `apps/mobile/composeApp`: shared Compose UI, account and profile flows,
  networking, state, preferences, and the expect/actual player boundary;
- `apps/mobile/iosApp`: the small Swift/UIKit host and generated Xcode project;
- `packages/mobile-bridge`: the Rust C ABI used by live domain calls, the
  retained local architecture fixture, and native bridge tests;
- `packages/core`: shared Rust add-on, stream selection, progress, episode,
  library, calendar, and track policy; and
- `apps/mobile/scripts`: native Rust library and iOS IPA packaging helpers.

The iOS host directory and target retain the historical `ConduitMobileSpike`
name. The product bundle identifier on both platforms is
`media.conduit.mobile`.

The shared app uses Kotlin 2.3.0, Compose Multiplatform 1.10.0, Android Gradle
Plugin 8.10.1, and Ktor 3.5.1. Android playback uses Media3 1.10.1 with an
experimental libmpv fallback. iOS playback uses the pinned NuvioMedia MPVKit
revision in `apps/mobile/iosApp/project.yml`.

## Platform-neutral checks

Run these from the repository root:

```sh
cargo test -p conduit-core -p conduit-mobile
cargo fmt --all -- --check
cargo clippy -p conduit-mobile --all-targets -- -D warnings
cd apps/mobile
./gradlew :composeApp:compileCommonMainKotlinMetadata
```

The Gradle tasks require JDK 17. iOS compilation and packaging require macOS
and Xcode. The mobile workflows run common checks in CI through the Android and
iOS-specific workflows:

- `.github/workflows/mobile-android.yml` builds the Rust Android libraries,
  runs JVM tests, and assembles a debug APK;
- `.github/workflows/mobile-ios.yml` builds the Rust Apple libraries and runs
  the iOS simulator test target; and
- `.github/workflows/release-android.yml` packages the universal Android APK;
- `.github/workflows/release-ios.yml` packages the iOS IPA. Each accepts its own
  component tag or a manual build-only run.

## Android development

Install Android Studio, JDK 17, SDK Platform 36, Build Tools 36, NDK
28.2.13676358, Rust through `rustup`, and the pinned `cargo-ndk`:

```sh
cargo install cargo-ndk --version 3.5.4 --locked
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358" \
  apps/mobile/scripts/build-rust-android.sh
cd apps/mobile
./gradlew :composeApp:installDebug
adb shell am start -n media.conduit.mobile/.MainActivity
```

Android supports API 26 and newer. The debug build includes ARM64, 32-bit
ARM, and x86_64 native libraries. Keep SDK paths in `local.properties`; do not
commit them.

For an emulator connected to a development server on the host, use
`http://10.0.2.2:3000` as the server URL. The app accepts HTTP for local
development addresses and requires HTTPS for non-local servers.

If the emulator cannot reach the host through `10.0.2.2`, forward the local API
port over adb and use `http://localhost:3000` in the app:

```sh
adb -s emulator-5554 reverse tcp:3000 tcp:3000
```

Replace the serial with the device from `adb devices` and both ports with your
API port if different. Each emulator needs its own forwarding rule. Remove it
when finished with `adb -s emulator-5554 reverse --remove tcp:3000`.

The focused Android checks are:

```sh
cd apps/mobile
./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug
./gradlew :composeApp:connectedDebugAndroidTest
```

Exercise server validation, local sign-in and registration, recovery codes,
household creation, profile switching, add-on installation, catalog search,
stream selection, playback, watch progress, subtitle and audio selection,
background audio and notification controls, rotation, and the OAuth deep link. Verify
that the cached library and history remain visible after stopping the server,
and that signing out removes access to the cached session.

On NixOS, Android's generic Linux binaries may need an FHS environment. If
AAPT2 or the NDK compiler cannot start, stop existing Gradle daemons and run
the Gradle command inside an appropriate `steam-run` or equivalent FHS shell.

## Android TV

Android TV and Google TV support is very experimental. For installation and
phone sign-in, see [TV setup](installation.md#android-tv-and-google-tv).

The same APK runs on Android TV and Google TV. `MainActivity` detects the
television UI mode and installs the TV presentation
(`composeApp/src/androidMain/kotlin/media/conduit/mobile/tv`); phones and tablets
keep the mobile interface. The manifest declares the Leanback launcher entry, a
home-screen banner, and optional touch input.

The TV screens are a separate presentation over the shared logic. Account,
profile sync, stream resolution, and the playback session stay in the shared
composables, which hand their state to `TvPresentation` at a few render points
(`TvPresentation.kt` in `commonMain`). Add TV behavior there rather than
forking the shared logic.

Every control must work with a remote:

- D-pad moves focus, Select activates, Back closes the top layer first.
- A long press of Select, or the Menu key, opens the action menu for a title.
- In the player, with controls hidden, Left and Right seek, Select toggles
  playback, and Up or Down shows the controls.
- Text fields open the on-screen keyboard on Select and release focus on Up
  and Down.

Test with real key events, not accessibility clicks:

```sh
adb shell input keyevent KEYCODE_DPAD_DOWN
adb shell input keyevent KEYCODE_DPAD_CENTER
adb shell input keyevent --longpress KEYCODE_DPAD_CENTER
adb shell input keyevent KEYCODE_BACK
```

Events injected this way come from a virtual keyboard, so TV code must not
depend on the input device reporting a D-pad source.

A TV usually has no browser, clipboard, or share sheet. Sign-in with a phone
uses the pairing flow in [Authentication](authentication.md#television-sign-in),
and watch-party invitations are shared and received through QR codes
([Watch parties](watch-parties.md#joining-from-a-tv)). The mini player, touch
gestures, and hold-to-speed are not offered on TV. Profile import and export
use a system document picker when available, with a phone/browser handoff
otherwise. See [Profile import and export](#profile-import-and-export).
Web-only preferences are not offered on TV.

Hardware decoding, HDR, audio passthrough, and real remotes still need a
physical-device pass; the emulator covers navigation and ordinary playback.

## iOS development

Install Xcode and its command-line tools, XcodeGen, JDK 17, and Rust through
`rustup`:

```sh
apps/mobile/scripts/build-rust-ios.sh
cd apps/mobile
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
lock-screen and Control Center commands, rotation, interruptions, repeated
player open/close cycles, PiP, and memory cleanup on a physical iPhone and iPad. The Apple mobile target is
GPLv3; see [`apps/mobile/iosApp/LICENSE`](https://github.com/davidvanderklay/conduit/blob/main/apps/mobile/iosApp/LICENSE) and
[`THIRD_PARTY_NOTICES.md`](https://github.com/davidvanderklay/conduit/blob/main/THIRD_PARTY_NOTICES.md) before distributing a
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

Create a component tag to release one mobile app:

```sh
git tag android/v0.2.0
git push origin android/v0.2.0
# Use ios/v0.2.0 for an independent iOS release.
```

The very experimental TV implementation uses the same Android module, app ID,
signing key, and universal APK as phones. `android/v*` releases cover both
phone and TV support. There is no separate TV flavor to
package. Publish its server pairing endpoints first and document the required
server version before shipping the first TV-capable Android release.

Each component workflow publishes its artifact with its own GitHub release:

- `conduit-<version>-android-universal.apk`, a signed APK containing ARM64,
  32-bit ARM, and x86_64 native libraries, plus a SHA-256 checksum;
- `conduit-<version>-ios-unsigned.ipa`, an arm64 device IPA, plus a SHA-256
  checksum.

Android release signing requires the four `ANDROID_KEYSTORE_*` Actions secrets
described in [Releases](releases.md#android). The same keystore must be kept
for every update. iOS packaging intentionally disables code signing and is
useful for sideloading environments or a later signing step. It is not a
store-ready submission.

To build without publishing a tag, run **Android release** or **iOS release**
manually. For local IPA packaging, use
the commands in [Releases](releases.md#ios).

### Previous-session diagnostics

Mobile diagnostics retain the current process session and two previous sessions,
up to 128 KiB each. Copy Logs, Share Logs, and Copy Reproduction include previous
sessions without applying the current screen's filters. Clear Logs clears the
current buffer and both retained sessions. Android stores these files outside
app backups; iOS stores them in Application Support. Logs are local and redacted
before persistence.

The serial writer publishes an atomic snapshot at most every 250 ms during
continuous logging. A crash may lose the most recent pending events, but cannot
partially overwrite the last completed snapshot. Previous sessions have an
unknown termination cause: force-stop, OS eviction, and a crash are not
distinguished. Verbose events still require Debug logging. Native iOS events
include player identity and whether they originated on the main thread.

To verify on a device, generate logs, force-stop and reopen the app, then export
logs from Settings. Repeat through four launches to check that only two previous
sessions remain. Clear Logs, wait for the writer, and reopen to confirm old
events are gone. Check playback replacement with Debug logging enabled; the
export should contain native player create/load/destroy markers.

## Profile import and export

Open Settings > Profile data, then choose Export profile or Import profile.
Android and iOS use their system document pickers. Imports accept UTF-8 JSON
up to 10 MiB and show the server preview before applying changes. Merge is
the default. Replace requires confirmation because it removes the target
profile's library, history, and add-ons. Both modes update the profile name
and kids setting. Device preferences remain local.

Add-on URLs are excluded from exports unless explicitly selected because they
can contain credentials. Mobile clients preserve optional archive fields when
sending a selected file to the server. See [Portable profile format](portable-profile-format.md).

Android TV checks for document picker activities and excludes the stock TV
framework stubs. TVs without a picker show a phone/browser handoff with the
web address advertised by `/v1/auth/config`. Sign in on that device, select
the same profile, and open profile data in Settings. Older servers without
`webUrl` still show these instructions. TV users can also choose this route
when their installed file picker is difficult to use with a remote.
