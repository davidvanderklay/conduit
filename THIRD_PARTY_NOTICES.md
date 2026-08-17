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

The iOS mobile player keeps MPVKit available as a compatibility-testing option
through the local Swift package at
`apps/mobile/iosApp/MPVKitCompat/`. That package pins the MPVKit 0.39.0
`Libmpv` binary, the companion libbluray 1.3.4 and libuchardet 0.0.8 binaries,
and shares the FFmpegKit 6.1.4 dependency used by KSPlayer:
<https://github.com/mpvkit/MPVKit/releases/tag/0.39.0-n7.1.1>.

Review each upstream binary's license and bundled-library notices before
shipping an iOS distribution. The compatibility package exists only to retain
the old player during feature-parity testing; KSPlayer is the default iOS
engine.

## KSPlayer

The iOS mobile player links the pinned KSPlayer package through Swift Package
Manager:
<https://github.com/kingslay/KSPlayer/tree/25c923b70d3d7881275e8f3d917e1e9752416e27>.

KSPlayer is distributed under GPLv3. The pinned package also links its
FFmpegKit dependency from the 6.1.4 line:
<https://github.com/kingslay/FFmpegKit/tree/6.1.4>.
Review the pinned package's license files and all bundled FFmpeg, codec, and
support-library notices when producing an Apple release. The app-specific
GPLv3 boundary is documented in [`apps/mobile/iosApp/LICENSE`](apps/mobile/iosApp/LICENSE),
with the complete terms in
[`apps/mobile/iosApp/LICENSE-GPL-3.0.txt`](apps/mobile/iosApp/LICENSE-GPL-3.0.txt).

The Apple mobile application must be distributed with the corresponding
source and build instructions, including the pinned Swift package revisions.
The root repository MIT license does not relicense the GPL-covered Apple
mobile application.

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
