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
app-specific GPLv3 boundary is documented in [`apps/mobile/iosApp/LICENSE`](apps/mobile/iosApp/LICENSE),
with the complete terms in
[`apps/mobile/iosApp/LICENSE-GPL-3.0.txt`](apps/mobile/iosApp/LICENSE-GPL-3.0.txt).

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

## Mediabunny

The web player's WebCodecs engine demuxes and decodes sources with the pinned
`mediabunny` and `@mediabunny/ac3` npm packages:
<https://github.com/Vanilagy/mediabunny>.

Both packages are distributed under the Mozilla Public License 2.0:
<https://www.mozilla.org/MPL/2.0/>. Their source is available from the
repository above and from the published npm packages.

`@mediabunny/ac3` bundles a WebAssembly build of FFmpeg's AC-3 and E-AC-3
decoders. FFmpeg is licensed under the GNU Lesser General Public License 2.1
or later: <https://ffmpeg.org/legal.html>. The package README documents how
that build is produced from FFmpeg source.

## FFmpeg WebAssembly decoders

`apps/web/src/lib/web-engine/wasm/ffmpeg-audio.wasm` (DTS, TrueHD, MLP) and
`ffmpeg-video.wasm` (HEVC) are built from the unmodified FFmpeg 8.1.3 release,
<https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz>, configured without GPL,
version 3, or nonfree components. They are licensed under the GNU Lesser
General Public License 2.1 or later. `apps/web/wasm/build.sh` pins the release
by SHA-256 and rebuilds both modules with `apps/web/wasm/ffmpeg_bridge.c`.

`ffmpeg_bridge.c` is adapted from the decoder bridges of WebGPU Player:
<https://github.com/alchemyyy/WebGPU-Player>.

Copyright (c) 2026 iZack

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
