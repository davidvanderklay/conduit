# Desktop releases

Pushing a semantic version tag creates a GitHub release with a Windows NSIS
installer, Linux AppImage, and Linux Flatpak:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow takes the application version from the tag, builds on native
Windows and Ubuntu runners, and generates release notes from the commits since
the previous release. Run the workflow manually to test packaging without
publishing a GitHub release.

The Windows installer is currently unsigned. Windows will therefore show an
unrecognized-publisher warning until a code-signing certificate is configured.
The Linux artifacts are also unsigned.

## Flatpak

The release workflow wraps the AppImage's staged runtime files in a Flatpak
bundle using `media.conduit.desktop`. Install a downloaded bundle with:

```sh
flatpak install --user ./conduit.flatpak
flatpak run media.conduit.desktop
```

This bundle is suitable for direct release downloads. Publishing on Flathub is
a separate submission: the manifest must be adapted into a reproducible,
network-isolated source build, screenshots and complete AppStream metadata must
be added, and a pull request must be submitted to Flathub's repository.
