# ADR 0005: Shared Rust domain policy

- Status: accepted
- Date: 2026-08-29

## Context

The web and mobile clients had separate implementations of add-on capability
matching, Stremio resource URLs, stream identity, automatic stream selection,
watch state, Continue Watching, calendar dates, library ordering, playback
completion, and audio-track labels. These implementations had already drifted.
For example, web used a final-two-minutes completion rule for long videos while
mobile used only a 90 percent threshold.

The existing Rust core was available to web through WebAssembly and to mobile
through a stateful C ABI fixture. Live mobile product flows still made most
domain decisions in Kotlin.

## Decision

`conduit-core` owns deterministic client policy. A tagged JSON dispatcher
accepts plain data and returns a value or a stable error. Web calls the
dispatcher through the synchronous `evaluateCore` WebAssembly export after
initializing WASM before React mounts. Android and iOS call the same dispatcher
through `conduit_core_evaluate` in `packages/mobile-bridge`.

The core currently owns:

- add-on resource capability checks and resource request URLs;
- stream source identity, URL token removal, saved-source matching, fallback
  selection, and automatic ranking;
- watch-state and playback-completion rules;
- canonical Continue Watching grouping and next-episode decisions;
- released-video filtering, strict release-day parsing, and library ordering;
  and
- audio codec, channel, sample-rate, and bitrate display normalization.

Hosts still own HTTP execution, authentication, persistence, UI state,
localized date text, player objects, media buffers, secure storage, OS
lifecycle, PiP, and audio-session behavior. The server remains authoritative
for authorization, conflict resolution, and persisted progress.

## Binding and test behavior

The stateless dispatcher is separate from the versioned, stateful mobile engine
fixture. Both use the same C string ownership functions and a 1 MiB mobile
message limit. Domain calls do not move media data or native objects through
the bridge.

Web unit tests initialize the built WASM binary before running adapter tests.
Android unit tests build a host JNI version of `conduit-mobile` and load it into
the test JVM. Kotlin tests therefore execute Rust policy instead of a Kotlin
fallback. Device builds continue to package Android or Apple target libraries.

## Consequences

A product-rule change now lands in Rust and reaches web, desktop, Android, and
iOS through their existing bindings. Client files retain small type and display
adapters, but no longer contain the moved algorithms. The JSON boundary adds
serialization work, so future high-volume projections should use batch actions
instead of per-row calls. Network ownership stays outside Rust until shared I/O
would remove enough code to justify cancellation, TLS, and platform-debugging
costs.
