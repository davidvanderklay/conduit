# Third-party notices

## Harbor

The macOS libmpv rendering structure in
`apps/desktop/electron-native/src/render_macos.rs` is adapted from Harbor:
<https://github.com/harborstremio/harbor>.

Copyright (c) 2026 Harbor

Licensed under the MIT License. Permission is hereby granted, free of charge,
to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom
the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## MPVKit

The iOS mobile player links the pinned NuvioMedia MPVKit fork through Swift
Package Manager:
<https://github.com/NuvioMedia/MPVKit/tree/d5cf091c80368bbbc1bbf2d195fbc55d926df888>.

The fork pins the Nuvio-built `Libmpv` 0.41.0 binary (mpv 0.41.0 with
FFmpeg n8.1.2) plus its companion codec, rendering, and support-library
binaries:
<https://github.com/NuvioMedia/MPVKit/releases/tag/0.41.0-n8.1.2-nuvio.2>.

libmpv and the bundled FFmpeg are GPL-licensed. Review each upstream binary's
license and bundled-library notices before shipping an iOS distribution. The
app-specific GPLv3 boundary is documented in [`apps/client/iosApp/LICENSE`](apps/client/iosApp/LICENSE),
with the complete terms in
[`apps/client/iosApp/LICENSE-GPL-3.0.txt`](apps/client/iosApp/LICENSE-GPL-3.0.txt).

The Apple mobile application must be distributed with the corresponding
source and build instructions, including the pinned Swift package revisions.
The root repository MIT license does not relicense the GPL-covered Apple
mobile application.

## Noto Sans CJK SC

The iOS player bundles `NotoSansCJKsc-Regular.otf` for CJK subtitle fallback.
It is Copyright 2022 Google LLC and is distributed under the SIL Open Font
License 1.1: <https://scripts.sil.org/OFL>.

## Android libmpv

The Android mobile player uses the pinned `mpv-android-lib` AAR during the
libmpv fallback implementation:
`io.github.abdallahmehiz:mpv-android-lib:0.1.12`.

Artifact metadata and source:
<https://central.sonatype.com/artifact/io.github.abdallahmehiz/mpv-android-lib>
<https://github.com/abdallahmehiz/mpv-android>

The published AAR contains native media libraries and declares MIT metadata
for the wrapper. Review the licenses and notices for libmpv, FFmpeg, and every
bundled native dependency before shipping an Android release. This entry does
not by itself settle Conduit's application-license decision.
