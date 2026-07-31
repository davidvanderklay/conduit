# ADR 0004: Mobile server and session foundation

- Status: accepted as an Android-first issue #43 checkpoint
- Date: 2026-07-31

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

The existing desktop OAuth endpoint remains loopback-only. Mobile deep links
must receive a separate server contract and callback validator rather than
weakening desktop's security assumptions. iOS networking source is present,
but its session vault intentionally remains memory-only and authentication must
not be enabled there until a Keychain adapter is implemented and tested.

## Consequences

Connection probing is now real and can fail with an actionable error without
persisting a bad endpoint. Unit tests use Ktor's deterministic mock engine, and
an Android instrumentation test exercises Keystore encryption on an emulator.
This checkpoint does not claim mobile OAuth/deep links, recovery-code display,
offline data caches, or library/progress/add-on synchronization; those remain
within issue #43.
