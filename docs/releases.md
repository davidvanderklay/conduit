# Releases

Pushing a semantic version tag creates a GitHub release with a Windows NSIS
installer, Linux AppImage, Linux Flatpak, macOS DMGs for Apple Silicon and
Intel, a signed universal Android APK, and an unsigned iOS IPA:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow takes the application version from the tag, builds on native
Windows, Ubuntu, Apple Silicon macOS, and Intel macOS runners, and generates
release notes from the commits since the previous release. Run the workflow
manually to test packaging without publishing a GitHub release.

## iOS

Tagged builds publish `conduit-<version>-ios-unsigned.ipa` and its SHA-256
checksum. The IPA contains an arm64 device build with the semantic version from
the tag and the Actions run number as its numeric build number. It is unsigned
by design, so the workflow does not require an Apple Developer certificate or
repository secrets.

The IPA cannot be installed directly by iOS. Import it into LiveContainer or
another sideloading environment that can load or sign unsigned applications.
The bundle identifier is `media.conduit.mobile`, and the app requires iOS 15 or
newer. The Apple mobile
application is GPLv3, so every distributed IPA must be accompanied by the
corresponding source and build instructions described in
[`apps/client/iosApp/LICENSE`](../apps/client/iosApp/LICENSE) and
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

To exercise the same packaging path without creating a release, run the
workflow manually with the `ios` target. Its IPA is available from the workflow
run's `conduit-ios` artifact. On a Mac with the prerequisites from
`mobile-development.md`, reproduce the package locally with:

```sh
apps/client/scripts/build-rust-ios.sh
apps/client/scripts/package-ios-ipa.sh 0.2.0 1
```

Verify a downloaded package before importing it:

```sh
shasum -a 256 -c conduit-0.2.0-ios-unsigned.ipa.sha256
```

## Android

The release APK contains both ARM64 and x86_64 native libraries. One APK is
therefore sufficient for physical Android devices and the development
emulator. Tagged builds use the tag as `versionName`, use the monotonically
increasing Actions run number as `versionCode`, and publish both the APK and
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

The Windows installer is currently unsigned. Windows will therefore show an
unrecognized-publisher warning until a code-signing certificate is configured.
The macOS applications receive an ad-hoc signature so their bundled libraries
are internally consistent, but they are not notarized with an Apple Developer
ID; Gatekeeper will warn users. The AppImage remains unsigned; the Flatpak
repository and its application commits are signed with the dedicated release
key.

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
