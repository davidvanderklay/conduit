# Watch parties

Start a party from **Watch together** on Home or in the player. Household parties appear to other profiles in the household. **Invite guests** creates a single-use invitation for another signed-in account on the same Conduit server. Invitations expire after 24 hours; creating another revokes the previous invitation. Up to eight profiles can join.

The host selects content and controls play, pause, seek, speed, and episode changes. Each guest resolves a source through their own add-ons. Stream URLs, cookies, and credentials are never broadcast. Local audio, subtitles, and volume remain independent. A browser may need a Play tap to allow autoplay.

The connection belongs to the selected profile, so closing the sheet or player does not leave the party. Guests can leave; the host can end the party. Disconnected guests pause and reconnect with a fresh ticket. A disconnected host pauses everyone and has 30 seconds to reconnect before the party ends. Parties expire after 24 hours. Signing out or revoking a session removes its socket access.

## Deployment

Apply migration `0021_unusual_dagger.sql` with the normal migration command. The API exposes `/v1/watch-parties/capabilities` and the authenticated party endpoints. `/v1/watch-parties/socket` requires a short-lived, single-use ticket obtained through the authenticated API. The bundled nginx configuration forwards WebSocket upgrades.

Run a single API replica for watch parties. Playback state and sockets are held in that process; database records retain membership and invitations, but restarting the API resets the live timeline. Multiple replicas need shared state and fan-out before they can synchronize a party reliably.

## Platform validation

Browser, Linux Electron/libmpv, and Android playback have been exercised against an isolated server and local media fixture. Shared Kotlin tests cover timeline projection, invite endpoint validation, and guest transport restrictions. iOS uses the shared session and native player bridge, but its build and runtime require verification on macOS and an iOS device.

## Joining from a TV

A TV cannot paste an invitation link. In the Watch together panel it can show a
QR code instead: the signed-in TV calls `POST /v1/watch-parties/handoff`, a
phone opens the returned link and pastes the invitation, and the TV collects it
with `POST /v1/watch-parties/handoff/:id/collect` and accepts it as usual. The
request lasts five minutes, can be filled once, and is collected only by the
account that created it. Like the live party timeline, pending requests live in
the API process.

A TV host shares an invitation the same way in reverse: the panel shows the
invitation link as a QR code for a guest to scan.

