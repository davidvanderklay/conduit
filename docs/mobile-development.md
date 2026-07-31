# Mobile architecture spike

This guide covers issue #41's vertical slice only. It is not the product mobile
UI. The fixture resolves locally through Rust and plays the Creative Commons
licensed **Big Buck Bunny** MP4 from the Internet Archive directly in the
platform player.

Issue #49 extends the same project with the shared application foundation:
first-run server selection, responsive primary navigation, reducer-style local
state, platform preference/device adapters, and CI. Authentication and live
connection probing intentionally remain later roadmap work.

## Repository layout

- `apps/mobile/composeApp`: shared Compose UI plus Android/iOS adapters
- `apps/mobile/iosApp`: small SwiftUI host, generated with XcodeGen
- `packages/mobile-bridge`: opaque Rust C ABI and versioned JSON protocol
- `packages/core`: existing Conduit add-on parsing and request logic

Important pins are Kotlin 2.3.0, Compose Multiplatform 1.10.0, Android Gradle
Plugin 8.10.1, Media3 1.10.1, and cargo-ndk 3.5.4.

## Platform-neutral checks (Linux or macOS)

```sh
cargo test -p conduit-core -p conduit-mobile
cargo fmt --all -- --check
cargo clippy -p conduit-mobile --all-targets -- -D warnings
cd apps/mobile
./gradlew :composeApp:compileCommonMainKotlinMetadata
```

The Gradle task needs JDK 17. iOS compilation tasks need macOS/Xcode even when
common tests run on Linux.

## Android on Linux or macOS

Install Android Studio, JDK 17, SDK Platform 36, Build Tools 36, NDK 28.2.13676358,
Rust with `rustup`, and the pinned cargo-ndk:

```sh
cargo install cargo-ndk --version 3.5.4 --locked
rustup target add aarch64-linux-android x86_64-linux-android
apps/mobile/scripts/build-rust-android.sh
cd apps/mobile
./gradlew :composeApp:installDebug
adb shell am start -n media.conduit.mobile.spike/media.conduit.mobile.MainActivity
```

Use an API 26+ emulator or device. Keep SDK paths in `local.properties`, never
in Git.

Android smoke test:

1. Launch and confirm the connection/catalog card renders.
2. Resolve; confirm the add-on name, title, and encoded resource URL appear.
3. Play; confirm Media3 renders video and the 500 ms progress text advances.
4. Background/foreground during playback; confirm playback pauses safely and
   the app resumes without a crash.
5. Rotate twice, close the player, reopen it ten times, then inspect `adb
   shell dumpsys meminfo media.conduit.mobile.spike`.
6. Close the app and confirm no player/network activity remains in Logcat.

Record device, OS/API, ABI, first-frame time, memory delta, and each result.

On NixOS, Android's generic Linux binaries need an FHS environment. If AAPT2
or NDK Clang reports that it cannot start a dynamically linked executable, stop
existing Gradle daemons and run the build with:

```sh
./gradlew --stop
NIXPKGS_ALLOW_UNFREE=1 nix shell --impure nixpkgs#steam-run nixpkgs#jdk17 \
  --command steam-run ./gradlew --no-daemon \
  :composeApp:testDebugUnitTest :composeApp:assembleDebug
```

## iOS on macOS

Install Xcode, its command-line tools, XcodeGen, JDK 17, and Rust through rustup:

```sh
apps/mobile/scripts/build-rust-ios.sh
cd apps/mobile
./gradlew :composeApp:allTests
cd iosApp
xcodegen generate
open ConduitMobileSpike.xcodeproj
```

Select an iOS 15+ simulator. For a device, choose a development team in Xcode;
no signing identity is committed. Xcode's pre-build step creates the Compose
framework for the selected SDK.

iOS smoke test:

1. Launch and exercise the same resolve/play/progress/close flow.
2. Background/foreground, lock/unlock, rotate, and simulate an interruption.
3. Close/reopen playback ten times and use Xcode's memory graph to check that
   AVPlayer/player layers are released.
4. Stop the app and confirm Instruments shows no continuing network task.

Record model, iOS version, architecture, first-frame time, memory delta, and
simulator/real-device status.

## Known scope limits

The spike does not fetch a third-party manifest, authenticate, synchronize
progress, select tracks, enable PiP/casting, or implement P2P. The mobile engine
boundary now uses protocol v2 with correlated work and cancellation messages,
bounded inputs, and serialized access to opaque handles. See
[ADR 0003](adr/0003-mobile-engine-protocol-v2.md) for the ownership contract.
Host dispatch tasks must finish before destroying an engine. The iOS and
Android device matrices must be completed before accepting ADR 0001 or closing
issue #41.

## Server connection checkpoint

With the development server on port 3000, enter `http://10.0.2.2:3000` in the
emulator. The app calls `/health` and `/v1/auth/config` and saves the endpoint
only after both succeed. Run the platform security test on a running emulator:

```sh
cd apps/mobile
./gradlew :composeApp:connectedDebugAndroidTest
```

See [ADR 0004](adr/0004-mobile-server-session-foundation.md) for token scoping,
Android Keystore ownership, and the intentionally deferred mobile OAuth and iOS
Keychain work.

After validation, sign in with a local server account or create one when the
server permits registration. The app stores the bearer session in Android
Keystore-backed ciphertext, loads households and profiles from `/v1/bootstrap`,
and restores the session after restart. Sign out from Settings and verify that
the login screen returns.

Library, history, and installed add-on summaries refresh for the selected
profile. After one successful refresh, stop the local server and reopen the app;
the same profile should render its encrypted cached snapshot with an Offline
label. A newly registered account must show its one-time recovery codes before
household creation.
