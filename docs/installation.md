# Install Conduit

Conduit is under active development. Stable is the default release track;
Nightly is for trying recent changes and may contain regressions. Keep profile
exports and, for self-hosted servers, database and configuration backups.
Android TV and Google TV support is very experimental on either track.

## Choose a release track

Server, web, desktop, Android, and iOS have independent versions. Browse
[all GitHub releases](https://github.com/davidvanderklay/conduit/releases) and
choose the component you need. Do not use GitHub's global latest-release link:
it does not identify the latest release of each component.

- Stable releases have tags such as `desktop/v0.2.0`, with no prerelease suffix.
- Nightly releases have tags such as `desktop/v0.2.0-nightly.20261005.123` and
  are marked as prereleases. Other prereleases, such as `-alpha.1`, are not
  automatically Nightly builds.

Stable and Nightly are release tracks, not separate source branches. The
scheduled Nightly workflow builds changed server, web, and desktop components
from a CI-passing revision of `main`, daily at 07:00 UTC. A component with no
changes does not get a new build. Android and iOS are not included in this
schedule; use their published component releases when available.

## Windows and macOS

Download an installer from the selected `desktop/v<version>` release:

- Windows: the NSIS `.exe` installer.
- macOS: the `.dmg` matching your Mac, Apple Silicon ARM64 or Intel x64.

Run the installer, open Conduit, and select your server on the sign-in screen.
The packaged app's fallback server is `http://localhost:3000`; for the default
Docker stack on the same machine, use `http://localhost:8321` instead. A remote
client needs the server's reachable HTTPS URL.

A fresh stable installation follows Stable; a fresh nightly installation
follows Nightly. Open **Updates** to check releases or opt into Nightly.
Returning to Stable waits for a newer stable version and does not downgrade
silently. Windows and macOS download updates on request and apply them on
restart. Unsigned or ad-hoc-signed macOS builds require manual replacement;
install the first Developer ID signed release manually before using in-app
updates. See [Updates](updates.md) for signing and compatibility limits.

## Linux Flatpak

Add the signed repository once:

```sh
flatpak remote-add --user --if-not-exists conduit \
  https://davidvanderklay.github.io/conduit/conduit.flatpakrepo
```

Install Stable, whose Flatpak branch is named `master`:

```sh
flatpak install --user conduit media.conduit.desktop//master
flatpak run media.conduit.desktop
```

To select Nightly, or return to Stable:

```sh
flatpak install --user conduit media.conduit.desktop//nightly
# Return to Stable:
flatpak install --user conduit media.conduit.desktop//master
```

Flatpak may ask to replace the installed branch. Track changes are managed by
Flatpak, and its update command follows the installed branch:

```sh
flatpak update --user media.conduit.desktop
```

Use the same scope as your original installation; system installations omit
`--user`. See [Flatpak maintenance](releases.md#flatpak) for removal and signature
troubleshooting. AppImage users download the matching desktop release, make it
executable, and replace the old file after closing Conduit. AppImage updates
are manual.

## Docker server and web

Follow [Deployment](deployment.md#docker-compose-quick-start) to download
`compose.yaml` and `.env.docker.example` from a server or web release, set
secrets, and start the stack. Keep the attached template's exact server/web
pins for a repeatable installation with a tested counterpart.

For moving Stable or Nightly image tags and switching tracks, see
[Docker release tracks](deployment.md#stable-and-nightly). The server's update
notice track is separate from the installed images. A desktop client's track
choice never upgrades the server.

## Android phones and tablets

Download `conduit-<version>-android-universal.apk` and its `.sha256` file from
an `android/v<version>` release. On a computer, verify the download with:

```sh
sha256sum -c conduit-<version>-android-universal.apk.sha256
```

Replace `<version>` with the downloaded version in both filenames. Transfer the
APK to your device, allow installation from your chosen file manager or browser
when Android prompts, and open the APK. Android 8.0 / API 26 or newer is required.
The APK includes ARM64, 32-bit ARM (armeabi-v7a), and x86_64 libraries.
Google Play distribution is not available yet.

Install later APKs over the existing app to retain its data. Android updates
require the same app ID, signing key, and an acceptable build counter. There is
no mobile in-app Stable/Nightly switch or scheduled mobile Nightly stream.
Switching to an older APK may be rejected by Android; uninstalling removes
local app data.

## Android TV and Google TV

Use the same signed universal APK as Android phones. Choose an Android release
whose notes include TV support; older releases do not gain it automatically.
Sideload using a TV file manager or, with Android debugging enabled and ADB
connected to your TV:

```sh
adb install -r conduit-<version>-android-universal.apk
```

Open Conduit from the TV launcher. The app selects the TV interface automatically.
Enter a server URL reachable by both the TV and your phone. `localhost` on a TV
refers to the TV itself. A self-hosted server must include the TV authentication
and watch-party handoff endpoints; the old `0.1.4` server does not have them.
Check the Android release notes for its minimum server version.

Choose **Sign in with your phone**, scan the QR code, sign in on the phone, and
approve only when the confirmation code matches your TV. Local-password users
may need to sign in to the web app in that phone browser first, then scan again.
Email/password sign-in is also available on the TV. See
[Television sign-in](authentication.md#television-sign-in).

Use the D-pad to move focus, Select to activate, and Back to close the current
layer. Long-press Select or use Menu for title actions. During playback with
controls hidden, Left/Right seek, Select toggles playback, and Up/Down shows
controls. Watch-party invitations use
[QR handoff](watch-parties.md#joining-from-a-tv).

This support is very experimental. Hardware decoding, HDR, audio passthrough,
and real remotes still need physical-device validation. TV omits touch gestures
and the mini player. Profile import/export uses a document picker if available,
or directs you to the web app on another device. See
[Android TV development](mobile-development.md#android-tv) for validation details.

## iOS

Download `conduit-<version>-ios-unsigned.ipa` and its checksum from an
`ios/v<version>` release. iOS 15 or newer is required. The IPA is unsigned and
cannot be installed directly; import it into LiveContainer or a sideloading
environment that can load or sign unsigned apps. App Store distribution is not
available yet. Updates use that same sideloading method, with no in-app track
switch. See [iOS packaging](releases.md#ios) for checksum verification and the
GPLv3 source-distribution requirements.
