# Project roadmap

This roadmap communicates direction, not release guarantees. Security,
portability, reliable playback, and a coherent film/television experience take
priority over feature count.

## Current: mobile release hardening

### iOS and Android

The shared iOS and Android clients now provide the first mobile product
surface. The near-term work is release hardening rather than a new foundation:

- Device-matrix testing across real Android hardware, emulators, and supported
  iOS versions
- Production crash, playback, lifecycle, and memory validation
- App signing, store metadata, sideloading, and distribution decisions
- Accessibility, localization, and release-quality polish
- Clear user-facing handling for unsupported streams and unavailable add-ons

The current client already includes shared browsing, profiles, library,
history, progress synchronization, secure session storage, OAuth callbacks,
native playback, track controls, deep-link return from OAuth, and encrypted
offline profile snapshots. The snapshots do not include media downloads.

The mobile client remains a native product surface rather than a wrapped web
page. Playback, lifecycle, orientation, and secure storage use platform-native
adapters behind shared Compose presentation.

## Next: TV experiences

tvOS is a planned target after the mobile foundations. Broader TV work may
include Android TV and other practical living-room platforms.

Key requirements:

- Remote/focus-driven navigation
- Large-screen layouts and accessibility
- Profile selection
- Reliable long-form playback
- Continue-watching synchronization
- Pairing or device-code authentication that avoids typing passwords on a TV

## Public access

An optional default public Conduit instance is a longer-term goal. It requires
substantial operational work before launch:

- Abuse prevention and rate limits
- Capacity planning
- Privacy and retention policies
- Moderation and legal review
- Reliable account recovery
- Observability without logging sensitive add-on or authentication data
- Clear separation from independent add-ons and media sources

Self-hosting will remain a core deployment model.

## Jellyfin and Plex

Jellyfin and Plex integration is a high-value future direction because it keeps
Conduit focused on film and television while unifying personal and add-on-based
libraries.

Potential capabilities:

- Browse personal server libraries alongside add-on catalogs
- Resolve duplicate titles across sources
- Synchronize watch state and continue-watching progress
- Choose between local-server and add-on streams
- Send supported downloads into a user's own Jellyfin/Plex library workflow
- Preserve a single Conduit progress view while respecting source ownership

Downloading from add-on sources into a media server requires careful technical,
security, and legal design. Any implementation must be explicit, user-controlled,
compatible with the source, and must not imply that Conduit supplies content.

Local-file support may arrive through the same personal-media abstraction rather
than as an unrelated file browser.

## Supporting platform work

- Invitations and account approval
- Multiple carefully scoped instance administrators
- Improved linked-account and OAuth-rotation controls
- Passkeys
- Better deployment images and release automation
- Backup/restore tooling and audit events
- Performance and accessibility work across clients

## Explicitly outside the current scope

Conduit is not currently planning to become a general-purpose media inbox or
personal knowledge application. These are intentionally outside the roadmap:

- YouTube subscriptions
- RSS reading
- Podcast management
- Audiobook libraries
- General music playback

Those areas have different metadata, playback, queue, discovery, and rights
models. Expanding into them would dilute the film/television experience without
enough shared value. The scope can be reconsidered only if a future use case
fits Conduit's core model rather than adding an unrelated product.
