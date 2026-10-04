# Updates

Conduit keeps desktop, server and web versions independent. Each component has a
Stable track and a Nightly track. Android phones and TV share the Android release
stream. Mobile installation remains managed by its store or sideloading method.

## Using the app

Open **Updates** from the desktop navigation, account menu, or Settings. The page
shows this device's client and its connected server separately. Routine releases
add a navigation count. Dismissing the notice clears that count for the current
account, server and release combination; version details remain available.

Stable is the default for stable installers. A fresh Nightly installation follows
Nightly. Choosing Nightly inside the app requires explicit opt-in. Preferences
persist across restarts and updates. Switching tracks invalidates a downloaded
installer and immediately checks the selected feed when automatic checks are on.
Returning to Stable waits for a newer stable release and never downgrades silently.

Windows and Mac download only after the user requests it. Restart applies the
verified installer. Automatic installation on quit is disabled. Close playback
and leave the watch party before restarting. Starting native playback cancels an
active update download; restart the download later. Pending playback checkpoints
are flushed before restart and retain their persisted outbox if the server is
unavailable.

An unavailable server or a server without version reporting cannot establish
compatibility for a new native installer. Reconnect or update the legacy server
before downloading. Existing playback remains usable. Checks never label a
failed request as up to date, and show the last successful check time.

### Linux

Flatpak owns installation and track changes. Stable retains the existing `master`
branch; Nightly publishes to `nightly`. Use your original installation scope:

```sh
flatpak update --user media.conduit.desktop
flatpak install --user conduit media.conduit.desktop//nightly
flatpak install --user conduit media.conduit.desktop//master
```

The install commands select a branch and Flatpak may ask to replace the installed
branch. System installations use their system scope instead of `--user`. The
client displays an upstream release notice, not a promise that a package has
already reached your configured remote. AppImage users download the matching
release and replace their file after closing the app. Unknown package sources
use their original package manager.

## Server operators

Container builds embed their own release version and revision. Source deployments
must set `CONDUIT_RELEASE_VERSION` to their exact built version or show as a
development build. Server track selection is deployment configuration:

```dotenv
CONDUIT_UPDATE_TRACK=stable
CONDUIT_UPDATE_CHECKS=true
```

`nightly` opts the server's notices into Nightly. It does not deploy anything.
Client track selection never changes the server. Checks run on startup and every
12 hours with jitter, conditional HTTP requests and a shared in-memory cache.
Manual owner checks have a one-minute cooldown. Set checks to `false` to disable
outbound release requests, including manual checks.

Authenticated users can read `/v1/system/info`. Owners can read
`/v1/admin/updates` and POST `/v1/admin/updates/check`. Owner authorization runs on
the server. `/health` remains a health endpoint. A stale successful result remains
visible with its failure notice after an upstream outage.

For a server upgrade, back up PostgreSQL and configuration, read migration notes,
set `CONDUIT_SERVER_VERSION` to the exact target version, then run:

```sh
docker compose pull server
docker compose up -d server
```

Keep `CONDUIT_WEB_VERSION` independently pinned. Update web only when its release
or compatibility requirements call for it. Migrations run on server startup; an
incompatible migration may require restoring the matching backup before rollback.
The app never executes deployment commands or mounts a Docker socket.

## Publishing updates

Component tags stay independent: `desktop/v0.1.5`, `server/v0.1.5`, `web/v0.1.5`.
Nightlies use tags such as `desktop/v0.1.5-nightly.20261004.123`.

After a component release succeeds, a reusable workflow commits only that
component's metadata to the `update-feeds` branch. Clients read public HTTPS feeds
at `raw.githubusercontent.com/davidvanderklay/conduit/update-feeds/COMPONENT/TRACK`.
No access token ships in the app. Each component serializes its releases. Bounded retries preserve concurrent
feed changes from other components, reject older candidates, and keeps payloads in immutable GitHub releases.

Stable metadata never contains prereleases. The Nightly feed accepts Nightly
builds and a stable release that supersedes its current candidate by SemVer. When
Stable supersedes Nightly, both feeds reference the same signed stable payloads.

Desktop publication waits for its Windows installer, Intel and Apple Silicon
DMGs/ZIPs, AppImage and Flatpak. Mac YAML is preserved per architecture before
merging, and a feed cannot publish without both ZIP payloads. Server/web
publication waits only for its own image and counterpart compatibility test.
Desktop and container releases upload into drafts, then become public only after
all their uploads finish. Updater feed publication follows release verification.
Existing release assets cannot be replaced. A changed artifact requires a new
version; manual packaging runs produce workflow artifacts without publishing.

The scheduled Nightly workflow runs daily at 07:00 UTC and supports a manual run.
It selects changed server, web and desktop components against their last published
feed revision. Failed or unpublished tags do not count as a successful build.
Each component's next planned version is in `releases/nightly-versions.json`.
Advance its base after promoting that version to Stable. Skip unchanged components.
Mobile nightly scheduling and mobile updater UI remain outside this first version.

### Required repository secrets

Before tagged desktop publication, configure:

- `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for the Windows signing certificate.
- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` for an Apple Developer ID certificate.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.
- The existing `FLATPAK_GPG_PRIVATE_KEY` and `FLATPAK_GPG_PASSPHRASE` for Flatpak.
- `NIGHTLY_RELEASE_TOKEN` with permission to push repository tags and trigger their
  workflows. The default workflow token does not trigger workflows from its tag
  pushes. Fine-grained tokens need repository Contents write; classic tokens for
  a private repository need the appropriate repo scope. Do not put this token in
  app builds.

Tagged Windows/Mac builds require credentials and force code signing. Both tracks
use the same signing identities. Old unsigned/ad-hoc-signed installations need
one manual installation of the first signed updater-enabled release. Verify N to
N+1 installation on Windows and both Mac architectures in native CI before
announcing the feature as available.

The feed and application currently declare API compatibility level 1. When making
an API break, update `API_LEVEL` in the shared updates package and the corresponding
`apiLevel` / `minimumApiLevel` fields in the feed publisher together. Backward
compatible releases retain the level. Compatibility does not compare component
version strings.

## Validation

```sh
pnpm test:releases
pnpm test:updates
pnpm --filter @conduit/web test
pnpm --filter @conduit/server test
pnpm --filter @conduit/desktop electron:main:build
pnpm check:flatpak
```

Focused tests cover feed isolation, partial Mac publication, prerelease ordering,
track switching, stale checks, authorization, Nightly opt-in and deployment pins.
Native installer/signature verification needs packaged Windows and Mac builds.
