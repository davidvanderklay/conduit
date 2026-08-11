# ADR 0001: Compose Multiplatform with an opaque Rust engine

- Status: proposed, pending Android and iOS device evidence
- Date: 2026-07-31
- Scope: issue #41 only

## Context

Conduit already uses Rust for Stremio-compatible manifest validation and
resource URL construction, React for web/desktop presentation, and native
libmpv behind a command/event contract in the Electron desktop shell. Mobile
needs shared presentation without moving media bytes, decoded frames, lifecycle,
or player objects through a language bridge.

The spike exercises a local manifest and streams fixture. Rust validates the
manifest with `conduit-core`, checks stream capability, constructs the resource
request, and deterministically selects the first direct URL. Compose passes the
URL to Media3 on Android or MPVKit/libmpv on iOS. The player reports
low-frequency state to Compose.

## Decision

Use Compose Multiplatform for the shared Android/iOS application layer and a
stable C ABI over opaque Rust engine handles. Versioned JSON actions and states
cross the bridge. Android wraps the ABI with three JNI entry points; iOS calls
it using Kotlin/Native cinterop.

The initial protocol is intentionally coarse:

```text
Compose -> resolveFixture/cancel/close -> opaque Rust engine
Compose <- resolved/cancelled/closed/error <- Rust
Compose -> stream URL -> Media3 or MPVKit/libmpv
Compose <- playing/position/duration/error <- native player
```

Rust owns portable parsing, validation, request planning, and deterministic
media decisions. Kotlin owns mobile presentation and effect orchestration.
Platform code owns playback surfaces, lifecycle, audio behavior, networking
capabilities, and future secure storage/casting. The synchronization server
continues to own authenticated shared data. Media payloads and frames never
cross this boundary.

Implementation will proceed Android-first while the shared protocol and source
sets remain platform-neutral. This gives one native host a short build/test
loop before equivalent iOS adapters are completed. It does not make Android
behavior the shared contract: platform-independent behavior stays covered by
Rust and Kotlin protocol tests, and iOS remains a required architecture and
release gate before issue #41 can be accepted as a two-platform proof.

## Binding comparison

| Option | Debuggability | API stability | Generated surface | Result |
| --- | --- | --- | --- | --- |
| Stable C ABI; JNI + cinterop | High: five exported functions and JSON logs | Explicit ABI/protocol versions | Handwritten adapters only | Chosen |
| Generated Swift/Kotlin bindings (UniFFI) | Good, but generated build inputs and runtime enter both hosts | Strong typed API, generator-coupled | Larger object-shaped surface | Revisit when message volume justifies it |
| Opaque handles + serialized protocol | High and fixture-testable | Additive messages can evolve independently | Minimal | Chosen on top of C ABI |

Generated bindings alone do not solve ownership or protocol design. Exposing
the Rust object graph would encourage chatty calls and couple Kotlin state to
Rust implementation details. JSON has modest serialization overhead but these
messages occur on user actions and coarse state changes, never per frame.

## Packaging and builds

`conduit-mobile` produces `cdylib`, `staticlib`, and `rlib` artifacts. Android
packages ABI-specific `.so` files in `jniLibs`; iOS links target-specific static
archives into the Compose framework. Generated binaries are ignored and rebuilt
from Cargo sources and the lockfile. The public C header is a reproducible
source input.

Linux can build/test Rust, common Kotlin, and Android. Apple SDK licensing and
Xcode require the iOS archive, framework, simulator, and device steps on macOS.

## Cancellation and lifetime

Each engine action advances a generation. `cancel` invalidates the current
generation and `close` is terminal. This fixture has no asynchronous Rust I/O;
future effects must attach cancellation to the generation and never publish a
stale result. Compose disposal sends `close` and frees the handle. Each native
player stops, removes its media item, and releases native resources on disposal.
Android pauses outside the started lifecycle. iOS keeps libmpv and its
CAMetalLayer inside a Swift/UIKit controller, pauses it on background, and
uses an AVAudioSession for playback audio. Interruption/audio-session policy
remains later playback scope.

## Evidence and measurements

Automated evidence in this repository covers manifest validation, request URL
construction, version rejection, terminal closure, FFI-safe error responses,
and Kotlin protocol decoding. Device evidence must record launch, time to first
frame, close/reopen behavior, background/foreground behavior, memory before and
after ten opens, and absence of playback/network work after closure.

Android was subsequently verified on a Pixel 8 x86_64 emulator running API 35:
the APK cold-launched in 695 ms on a warm emulator, loaded
`libconduit_mobile.so`, resolved the fixture through Rust, decoded H.264/AAC
through Media3 1.10.1, rendered the first frames, and reported advancing
position plus a 596-second duration to Compose. Closing playback logged one
Media3 initialization and one clean release with no dead-thread warning after
the disposal ordering was corrected. Post-close total PSS was approximately
101 MiB. Rotation completed without a fatal exception. These are emulator
measurements, not representative device performance.

iOS and a real Android device remain unverified. The ADR therefore remains
`proposed` until the iOS smoke-test table is completed and the Android flow is
spot-checked on physical hardware.

## Risks and follow-up

- JSON schema drift is controlled by protocol tests and explicit versions, but
  needs compatibility fixtures before version 2.
- JNI symbol names couple the Android adapter package to the Rust wrapper.
- Static archive orchestration is intentionally simple and should move into CI
  only after the spike is accepted.
- The remote legal fixture still depends on internet access; resolution itself
  is deterministic and offline.
- MPVKit and Media3 expose different codec and hardware-decoder behavior.
  Later stream ranking needs host capability input, not platform logic hidden
  in Rust.

If device evidence shows Compose/native-view lifecycle leaks or unacceptable
startup/binary cost, retain the Rust protocol and evaluate separate SwiftUI and
Compose Android hosts. That is a concrete fallback with no media-engine rewrite.
