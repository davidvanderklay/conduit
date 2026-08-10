# ADR 0004: Mobile server and session foundation

- Status: accepted as an Android-first issue #43 checkpoint
- Date: 2026-07-31

This ADR records the Android-first checkpoint. The later product implementation
also completed the iOS Keychain and deep-link adapters described in the current
[mobile guide](../mobile-development.md); the checkpoint wording below is kept
to preserve the original decision history.

## Context

The application foundation previously accepted a syntactically valid URL
without contacting it. Account work requires proving that a selected origin is
a compatible Conduit server before any credential can be associated with it.
The existing server exposes `/health`, `/v1/auth/config`, PKCE bearer-session
exchange, and authenticated `/v1/bootstrap` contracts.

## Decision

Use a shared Ktor client with pinned 3.5.1 dependencies and native OkHttp and
Darwin engines. A connection is persisted only after both health and
authentication discovery succeed. Requests have bounded connection, socket,
and total timeouts. Android permits cleartext only for `localhost`, `127.0.0.1`,
and the emulator host alias `10.0.2.2`; every other configured origin requires
HTTPS.

Bearer sessions are represented by a server origin, opaque token, and expiry.
The session vault returns a token only for the exact selected origin. Changing
or forgetting a server clears the vault before another origin can be selected.
Android encrypts the serialized session with AES-GCM and a non-exportable key
in Android Keystore; preferences contain only IV and ciphertext.

Local email sign-in and registration use Better Auth's `set-auth-token` bearer
header, not persisted cookies. After authentication, mobile loads
`/v1/bootstrap`, creates the first household/profile when needed, and persists
only the selected profile identifier in ordinary settings. A 401 clears an
expired session; network and server failures retain the encrypted token and
offer retry or server recovery paths.

The selected profile synchronizes add-ons, library, and progress concurrently
from the existing server endpoints. Its offline snapshot is stored in the same
Keystore-encrypted store as sessions because configured add-on URLs may contain
secrets. A refresh failure renders cached state with an explicit offline label;
it never substitutes cached data from another profile. New local accounts show
fresh one-time recovery codes before household setup.

The existing desktop OAuth endpoint remains loopback-only. Mobile deep links
must receive a separate server contract and callback validator rather than
weakening desktop's security assumptions. At this checkpoint, iOS networking
and authentication were still pending; the current implementation has since
added the Keychain-backed session vault and the matching deep-link callback
adapter.

## Consequences

Connection probing is now real and can fail with an actionable error without
persisting a bad endpoint. Unit tests use Ktor's deterministic mock engine, and
an Android instrumentation test exercises Keystore encryption on an emulator.
Android OAuth uses a dedicated server handoff, the system browser, an exact
custom-scheme callback, PKCE, correlated single-use codes, and encrypted pending
state that survives activity recreation. Desktop and mobile endpoints validate
their callback type at every stage even though their temporary rows share a
table.

The Android-first checkpoint did not accept iOS Keychain or deep-link evidence.
Those adapters now exist in the product client, but real-device validation
remains part of mobile release hardening.
