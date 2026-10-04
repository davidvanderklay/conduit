# Releases

Conduit has independent server, web, desktop, Android, and iOS release streams.
Only the component named in a tag builds and publishes. Historical `v*` tags and
artifacts remain available, but new `v*` tags no longer trigger releases.

| Component | Tag                  | Artifacts                                                     |
| --------- | -------------------- | ------------------------------------------------------------- |
| Server    | `server/v<version>`  | Server container, deployment files                            |
| Web       | `web/v<version>`     | Web container, deployment files                               |
| Desktop   | `desktop/v<version>` | Windows NSIS, AppImage, Flatpak, Apple Silicon and Intel DMGs |
| Android   | `android/v<version>` | Signed universal APK and checksum                             |
| iOS       | `ios/v<version>`     | Unsigned IPA and checksum                                     |

For example, after choosing a reviewed commit on main and the next Android
version:

```sh
git tag android/v0.2.0
git push origin android/v0.2.0
```

This builds Android only. Versions must be SemVer without build metadata.
Prerelease tags such as `android/v0.2.0-alpha.1` create prereleases. Choose each
stream's initial version above the last version shipped in its artifacts, not
its checked-in manifest. The last combined release before this split was
`v0.1.5-alpha.1`.

Tags are the release version source. Desktop CI stamps the package, native
crate, and Flatpak metadata; mobile builds receive their version directly.
Container tags omit the component prefix, such as `conduit-server:0.2.0`.
Image labels record the version, full release tag, and source revision. Private
Rust libraries have no separate public releases.

### Choosing what to release

Compare each component to its own previous release tag. A server-only fix
usually needs only a server release. Changes to `apps/web` can affect web and
desktop because desktop embeds the web build. Changes to `packages/core` can
affect all four clients. Shared Kotlin and `packages/mobile-bridge` changes
can affect Android and iOS. Platform-specific mobile changes need only that
platform's release. Inspect shared lockfile and build changes for their actual
consumers instead of bumping every app automatically.

Keep server APIs compatible with supported installed clients. Add endpoints
before clients require them, and document minimum server requirements when
they change. App versions do not need to match. The mobile bridge's protocol
version remains a separate internal FFI contract.

Android TV support in `feat/android-tv-kmp` extends the existing `composeApp`
and keeps `media.conduit.mobile` as its application ID. Once that implementation
lands, the same universal APK serves phones, tablets, Android TV, and Google TV.
Use `android/v<version>` for all of them, with one signing key and build counter.
There is no separate TV build target or `android-tv/v*` release stream. A
TV-only source change still requires a new Android APK because it is one app.

Android release verification checks the packaged app ID, version, both native
ABIs, and phone launcher. When the source manifest enables TV, it also requires
the packaged Leanback launcher, banner, and optional touchscreen and Leanback
features. This permits releases before the TV work lands without pretending
those APKs contain TV support.

For the first TV-capable release, publish the server changes for television
phone pairing and party handoff before publishing Android, and state the minimum
server version in the release notes. Those endpoints are absent from the old
`0.1.4` baseline. The existing server/web container smoke test does not validate
TV pairing, so run the TV endpoint tests from that change as well.

### Manual builds and rebuilds

Run **Desktop release**, **Android release**, or **iOS release** manually for
build-only validation. With an empty `release_tag`, they build the selected ref
as `0.0.0-ci.<run>`. An existing component tag checks out that exact tag and uses
its version. The container workflow requires an existing server or web tag.
Manual runs do not create releases, publish images, or update the Flatpak remote.

Desktop retains explicit replacement of macOS or Flatpak assets when a manual
run selects that target and an existing desktop tag. It replaces only those
assets on an existing release. The `all` target remains build-only on manual
runs. macOS verification still downloads the published DMGs and checks them.

Every stream has independent publication and concurrency. Desktop releases
remain serialized to protect signed Flatpak repository history. A failed mobile
build cannot block a desktop release.

### Containers and tested deployment pairs

`releases/container-pair.json` records exact counterpart versions for release
smoke tests. It starts at the existing stable `0.1.4` server/web pair. Update it
in a reviewed change after publishing and validating a newer pair. Do not put
`latest` in this file.

A server release builds only the server image and pulls the pinned web image.
A web release builds only web and pulls the pinned server image. The workflow
checks startup, health, web delivery, and the auth configuration endpoint through
Compose. These checks do not prove every API feature is compatible; run the
relevant client/API tests for contract changes.

The release's attached `.env.docker.example` pins the new image and its tested
counterpart. Stable releases update aliases for their image only; prereleases
do not move `latest`. Version-zero releases do not publish a broad `0` alias.
Manual container builds can supply `counterpart_version` to test another exact
published version. To ship a feature across both images, preserve compatibility
with the old counterpart first, publish the server, update the tested pair, then
publish web against the new server.

### Release notes and downloads

Notes list commits affecting that component since its previous published tag.
The first release in each stream uses the last ancestor legacy release as its
baseline. Other streams' intervening tags are not used as the baseline. Shared
code changes appear in every affected stream's notes.

Preview notes without publishing from the intended release checkout:

```sh
COMPONENT=android RELEASE_TAG=android/v0.2.0 \
  GITHUB_REPOSITORY=davidvanderklay/conduit \
  node scripts/publish-component-release.mjs --dry-run
```

Component releases do not change GitHub's global latest-release marker. Browse
[all releases](https://github.com/davidvanderklay/conduit/releases) and select the
component you need, rather than using `/releases/latest` for downloads.
Compose files belong to server and web releases, not desktop or mobile releases.
The hosted demo still deploys from main through its separate workflow.

### Mobile build counters

Android `versionCode` and iOS numeric build numbers use
`1000000 + github.run_number`. The old combined release workflow had reached
run 143 when this split was implemented, so the new counters start above all
its builds. Keep the new workflow identities stable. If a future workflow reset
is necessary, set the repository variable `MOBILE_BUILD_NUMBER_OFFSET` to a
larger value before shipping. Never lower it or exceed Android's 2100000000
limit. Rerunning the same Actions run retains its build number; start a new run
for a new installable build. App IDs and signing keys remain unchanged.

## iOS

Tagged builds publish `conduit-<version>-ios-unsigned.ipa` and its SHA-256
checksum. The IPA contains an arm64 device build with the semantic version from
the tag and the offset Actions run number described above as its numeric build
number. It is unsigned
by design, so the workflow does not require an Apple Developer certificate or
repository secrets.

The IPA cannot be installed directly by iOS. Import it into LiveContainer or
another sideloading environment that can load or sign unsigned applications.
The bundle identifier is `media.conduit.mobile`, and the app requires iOS 15 or
newer. The Apple mobile
application is GPLv3, so every distributed IPA must be accompanied by the
corresponding source and build instructions described in
[`apps/mobile/iosApp/LICENSE`](../apps/mobile/iosApp/LICENSE) and
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

To exercise the same packaging path without creating a release, run the
**iOS release** workflow manually. Its IPA is available from the workflow
run's `conduit-ios` artifact. On a Mac with the prerequisites from
`mobile-development.md`, reproduce the package locally with:

```sh
apps/mobile/scripts/build-rust-ios.sh
apps/mobile/scripts/package-ios-ipa.sh 0.2.0 1
```

Verify a downloaded package before importing it:

```sh
shasum -a 256 -c conduit-0.2.0-ios-unsigned.ipa.sha256
```

## Android

The release APK contains both ARM64 and x86_64 native libraries. One APK is
therefore sufficient for physical Android devices and the development
emulator. Tagged builds use the tag as `versionName`, use the offset Actions
run number described above as `versionCode`, and publish both the APK and
its SHA-256 checksum. Android releases use the application ID
`media.conduit.mobile`.

Release builds must use the same signing key forever so users can install
updates over previous versions. Generate and securely back up a key once:

```sh
keytool -genkeypair \
  -keystore conduit-android-release.jks \
  -alias conduit \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Configure these repository Actions secrets before creating the first tag:

- `ANDROID_KEYSTORE_BASE64`: the base64-encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password
- `ANDROID_KEY_ALIAS`: the alias, `conduit` in the example above
- `ANDROID_KEY_PASSWORD`: the key password

With the GitHub CLI authenticated for this repository, the keystore can be
uploaded without writing its encoded form to another file:

```sh
base64 --wrap=0 conduit-android-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

Store an encrypted offline backup of the keystore and its passwords. Losing
them makes it impossible to publish an update that existing installations will
accept. Do not commit the keystore or its encoded contents.

Tagged Windows and macOS releases now require code-signing credentials. Mac builds
also require notarization and publish ZIPs for in-app updates alongside DMGs.
Both update tracks use the same signing identities. Legacy unsigned or ad-hoc
signed installations need one manual installation of an updater-enabled release.
The AppImage remains a manual replacement; the Flatpak repository and its
application commits remain signed with the dedicated release key.

See [Updates](updates.md) for Stable/Nightly behavior, feed publication, signing
secrets and the first-install transition.

## Flatpak

The release workflow builds the Flatpak directly from source using the GNOME
runtime. JavaScript and Rust dependencies are vendored from the lockfiles for
an offline build, and libmpv is compiled as a native Flatpak module. The
Flatpak does not contain or launch the AppImage.

### Install and maintain

Add the signed Conduit repository and install the application for the current
user:

```sh
flatpak remote-add --user --if-not-exists conduit \
  https://davidvanderklay.github.io/conduit/conduit.flatpakrepo
flatpak install --user conduit media.conduit.desktop
flatpak run media.conduit.desktop
```

The repository descriptor contains the public key used to verify repository
metadata and application commits. New releases are available without re-adding
the remote:

```sh
flatpak update --user media.conduit.desktop
```

Remove the application and repository with:

```sh
flatpak uninstall --user media.conduit.desktop
flatpak remote-delete --user conduit
```

To inspect the configured remote or diagnose an update:

```sh
flatpak remotes --user --show-details
flatpak remote-ls --user conduit
flatpak update --user --verbose media.conduit.desktop
```

If the repository cannot be reached, check the
[`conduit.flatpakrepo`](https://davidvanderklay.github.io/conduit/conduit.flatpakrepo)
URL and the repository's GitHub Pages deployment. Do not bypass a signature
failure with `--no-gpg-verify`; verify the published signing-key fingerprint
with a maintainer first. The workflow publishes the current full fingerprint at
[`conduit-flatpak-signing-key.txt`](https://davidvanderklay.github.io/conduit/conduit-flatpak-signing-key.txt).

The standalone bundle remains a fallback. Download `conduit.flatpak` from the
GitHub release and install it with:

```sh
flatpak install --user ./conduit.flatpak
flatpak run media.conduit.desktop
```

### Repository publishing

Tagged releases publish a signed OSTree repository through GitHub Pages. The
workflow restores the previous repository from the dedicated `flatpak-repo`
branch, appends the new release, validates signatures and AppStream metadata,
then pushes the history and deploys the same snapshot atomically. The branch
is workflow-owned: do not edit it manually, delete it, or force-push it.

Before the first repository release:

1. In the repository's **Settings → Pages**, set the source to **GitHub
   Actions**.
2. Create a dedicated long-lived GPG signing key on a trusted offline machine.
   Its identity should make clear that it signs Conduit Flatpak releases.
3. Export the private key in ASCII-armored form and save it as the Actions
   secret `FLATPAK_GPG_PRIVATE_KEY`.
4. Save its passphrase as `FLATPAK_GPG_PASSPHRASE`.
5. Record the full fingerprint in two independent secure locations and keep an
   encrypted offline backup of the private key and revocation certificate.

For example, after creating the key:

```sh
gpg --armor --export-secret-keys KEY_FINGERPRINT > conduit-flatpak-private.asc
gpg --armor --export KEY_FINGERPRINT > conduit-flatpak-public.asc
gpg --output conduit-flatpak-revocation.asc --gen-revoke KEY_FINGERPRINT
```

Treat the exported private key and revocation certificate as secrets. Remove
the temporary private-key export after storing its encrypted backup and Actions
secret.

The workflow creates `flatpak-repo` automatically on its first successful
tagged release. Later releases fail rather than silently replacing that branch
if its OSTree configuration or object history is invalid. Publishing is
serialized so concurrent tags cannot race and discard history.

### Signing-key recovery and rotation

Losing the signing key prevents existing installations from trusting new
releases. Restore the exact backed-up key to the Actions secrets; never create
a replacement with the same label and silently update the repository
descriptor.

For planned rotation, retain the old key, add the new public key to the
repository configuration, and publish transition metadata signed by the old
key before using the new key for releases. Test an update from an installation
that trusts only the old descriptor. If the old private key is irrecoverably
lost or compromised, stop publishing, disclose the fingerprint and incident,
and provide explicit instructions for users to remove and re-add the remote.
Existing clients cannot securely infer that an unrelated replacement key
belongs to Conduit.

### Flathub

The manifest remains structured as a source build suitable for a future
Flathub submission. That path still requires screenshots, complete store
metadata, stable release sources, and a pull request to Flathub, and is not a
prerequisite for the self-hosted repository.
