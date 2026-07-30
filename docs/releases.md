# Desktop releases

Pushing a semantic version tag creates a GitHub release with a Windows NSIS
installer, Linux AppImage, Linux Flatpak, and macOS DMGs for Apple Silicon and
Intel:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow takes the application version from the tag, builds on native
Windows, Ubuntu, Apple Silicon macOS, and Intel macOS runners, and generates
release notes from the commits since the previous release. Run the workflow
manually to test packaging without publishing a GitHub release.

The Windows installer is currently unsigned. Windows will therefore show an
unrecognized-publisher warning until a code-signing certificate is configured.
The macOS applications receive an ad-hoc signature so their bundled libraries
are internally consistent, but they are not notarized with an Apple Developer
ID; Gatekeeper will warn users. The Linux artifacts are also unsigned.

## Flatpak

The release workflow builds the Flatpak directly from source using the GNOME
runtime. JavaScript and Rust dependencies are vendored from the lockfiles for
an offline build, and libmpv is compiled as a native Flatpak module. The
Flatpak does not contain or launch the AppImage. Install a downloaded bundle
with:

```sh
flatpak install --user ./conduit.flatpak
flatpak run media.conduit.desktop
```

This bundle is suitable for direct release downloads and the manifest is
structured like a Flathub source build. A Flathub submission still requires
screenshots, complete AppStream metadata, stable release sources, and a pull
request to Flathub's repository.
