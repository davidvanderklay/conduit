# ADR 0002: Shared mobile application foundation

- Status: accepted for Android-first development
- Date: 2026-07-31
- Scope: issue #49

## Context

The architecture spike proved shared Compose presentation, an opaque Rust
engine, and Android native playback. The next phase needs a product-shaped
application foundation without prematurely implementing authentication,
synchronization, catalogs, or the final design.

## Decision

Use a small reducer-style `AppStore` as the owner of application navigation and
connection-selection state. UI functions render immutable `AppState` and send
`AppAction` values. Dependencies enter through `PlatformServices`; common code
does not access Android contexts, Apple defaults, or device APIs directly.

The initial navigation model is an enum with Discover, Library, and Settings.
Phones use bottom navigation and widths of 720 dp or greater use a navigation
rail. This deliberately avoids selecting a navigation framework before nested
details, authentication callbacks, and deep links establish real requirements.

Server selection stores a versioned JSON value in platform preferences. It is
device configuration, not an authenticated session. HTTPS is required except
for localhost, `127.0.0.1`, and Android-emulator host alias `10.0.2.2`. URLs
containing credentials are rejected. Connectivity probing, TLS policy,
credential storage, and account state remain issue #43 scope.

The issue #41 fixture remains in Discover as an architecture demo so every
foundation change retains an end-to-end Rust/player regression path. Empty
Library and Settings surfaces establish layout and navigation only; they do not
claim later product functionality.

## Platform sequencing

Implementation and emulator verification proceed on Android first. Shared
state, validation, and protocols remain in `commonMain` with common tests, and
platform access remains behind expect/actual adapters. iOS source adapters stay
present but are not treated as verified until work resumes on macOS.

This sequencing shortens the daily feedback loop without authorizing Android
framework types in common code or removing iOS from the eventual release gate.

## Testing and delivery

Pure endpoint and store behavior is covered by common tests executed as Android
JVM unit tests. CI installs pinned SDK/NDK components, rebuilds both Rust JNI
ABIs, runs tests, and assembles a debug APK. Emulator smoke testing covers setup,
navigation, persistence, responsive rotation, and the retained player demo.

## Consequences

- The state store is intentionally synchronous while it owns only local state.
  Network effects will require scoped coroutines and explicit loading/error
  actions rather than hidden work inside the reducer.
- Platform preferences are suitable for a server URL but never for session
  secrets; issue #43 must introduce secure storage.
- Navigation may migrate to a library once nested routes and deep links justify
  it. Destination identity must remain independent of a chosen library.
- The design tokens are minimal and expected to evolve without copying another
  application's visual identity.
