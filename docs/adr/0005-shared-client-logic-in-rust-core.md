# ADR 0005: Shared client logic in the Rust core

- Status: accepted
- Date: 2026-08-21
- Scope: desktop, web, mobile, and planned TV clients

## Context

Domain behavior now lives twice: TypeScript under `apps/web/src/lib` (stream
selection, add-on handling, metadata, continue watching, progress) serves the
web and Electron desktop clients, while Kotlin `commonMain` reimplements the
same decisions for mobile. Each divergence is a bug class that must be fixed on
both sides, and the TV roadmap adds a third consumer before any fix lands.

Three strategies were considered. Rewriting the desktop in Compose
Multiplatform would unify UI stacks but costs a rewrite of a working React
desktop, re-solves native playback packaging, and still leaves the browser app
on React. Doing nothing keeps drift cheap only until TV work starts. Expanding
the Rust engine follows the direction set in ADR 0001 and ADR 0003 at a
fraction of the cost.

## Decision

The Rust core (`packages/core`) becomes the single owner of cross-client
domain logic. Desktop stays Electron with its React UI; the browser app stays
React. Two presentation stacks are permanent; there is exactly one brain.

Scope, sequenced by purity:

1. stream selection;
2. add-on manifest validation and metadata normalization;
3. playback queueing;
4. continue watching and progress computation.

Rules the core must keep:

- Stateless compute only. Clients fetch, pass JSON in, and receive decisions,
  matching the existing `resolveStreams` pattern. No database, timers, or
  network sockets in core; an async ABI is out of scope.
- One canonical serde type definition per operation. The wasm-bindgen surface
  and the versioned JSON C ABI derive from it, and breaking changes bump the
  protocol version.
- Golden-vector conformance fixtures live in `packages/core/fixtures/` and run
  against the same JSON in Vitest (through a dedicated NodeJS WASM build) and
  in the Android unit-test suite, which pins the Kotlin wire format to the
  canonical requests and responses while Rust's own suite pins behavior.
- Device constraints enter as an explicit input to stream selection so a TV
  client is another profile rather than a protocol break.

The web app consumes the engine through the `@conduit/core` workspace package,
whose export map selects the browser WASM glue for bundling and the NodeJS
glue for tests.

Execution proceeds in vertical slices ordered by the list above: each area
moves into core, both TS and Kotlin call it, the duplicates are deleted, and
the slice lands as one PR before the next begins. Mobile is released, so
rewiring its Kotlin implementations is in scope immediately. The first slice
calibrates effort; remaining slices are re-estimated against it before
continuing.

## Alternatives

A Compose Multiplatform desktop rewrite was rejected: months of work to reach
parity in playback, packaging, and updates while the web app remains React
regardless. Deferring all unification until TV work starts was rejected
because the conformance-fixture groundwork is what makes TV cheap, and drift
is already costing double fixes today.

## Consequences

Clients become thin orchestration layers over the engine; per-client logic is
limited to presentation and platform concerns. Protocol changes require
fixtures updated in all three test suites. The first slice gates the rest:
if its true cost implies the remaining five exceed available appetite, scope
shrinks to the areas with demonstrated drift.
