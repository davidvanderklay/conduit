# ADR 0003: Mobile engine protocol v2

- Status: accepted for Android-first development
- Date: 2026-07-31
- Scope: issue #42 and issue #38

This ADR records the shared native-boundary decision made during Android-first
development. The current product client keeps this stateful ABI for the
retained architecture fixture and contract tests. Live add-on networking stays
in Kotlin, while add-on request planning, stream selection, and other portable
domain rules now use the stateless Rust call recorded in ADR 0005.

## Context

The architecture spike exposed one synchronous fixture operation through an
opaque Rust handle. It proved packaging but named a product operation after its
test fixture, had global cancellation, and did not correlate responses with
requests. Those properties do not scale to catalog, metadata, and stream work.

## Decision

Keep the stable C ABI and opaque engine handle selected in ADR 0001. Continue
using tagged, versioned JSON for low-frequency control messages. Protocol v2:

- renames `resolveFixture` to the domain operation `resolveStreams`;
- requires a caller-generated `requestId` on work and cancellation actions;
- echoes the identifier in resolved, cancelled, and operation-error states;
- marks errors recoverable or terminal;
- caps an action at 1 MiB, a request ID at 128 bytes, and queued cancellation
  identifiers at 256; and
- serializes dispatch against a handle with a Rust mutex so concurrent foreign
  calls cannot mutate engine state concurrently.

The current operation accepts already-fetched manifest and stream-response JSON.
Rust parses the manifest, verifies capability, constructs the resource URL, and
selects the first direct URL deterministically. Networking remains owned by the
mobile application until a later milestone establishes an async Rust runtime
and cancellation evidence. Video bytes and decoded frames never use this API.

## Ownership and lifecycle

`conduit_engine_new` transfers one opaque handle to the host. Each returned
string belongs to the host until `conduit_string_free`. Dispatch calls may come
from multiple threads and are serialized. The host must stop and join its own
dispatch tasks before calling `conduit_engine_free`; freeing a handle during an
active foreign call is invalid. Android and iOS wrappers make close idempotent.

Cancellation is cooperative and request-scoped. In v2 it suppresses queued work
with the same identifier and lets hosts reject stale responses by correlation.
The current CPU-only operation is intentionally synchronous and short. Before
Rust owns network or P2P work, the handle must gain an async task registry whose
cancel action interrupts in-flight I/O without holding the state mutex.

## Alternatives

Generated object-graph bindings remain rejected because they couple mobile code
to Rust implementation details and complicate version negotiation. A binary
protocol is not justified by these low-frequency messages. Platform-specific
Swift and Kotlin domain implementations would duplicate selection behavior.

## Consequences

Protocol v1 and v2 are deliberately incompatible and the ABI reports version 2.
This is acceptable before release and is covered by Rust and Kotlin contract
tests. Future protocol changes require fixtures for old-message rejection and
new-message round trips. The iOS player and packaging path now exist, while
real-device validation remains part of mobile release hardening.
