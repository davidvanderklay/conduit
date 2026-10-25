# Media compatibility

Conduit keeps media traffic between each client and the selected source. The
hosted synchronization server is not a video proxy or transcoder.

## Packaged desktop app

The desktop app passes resolved sources directly to its embedded libmpv
player. libmpv provides FFmpeg-backed demuxing, software decoding, audio
downmixing, subtitle rendering, seeking, and safe hardware-decoder fallback.
This already covers the common fallback cases that require a separate
transcoder in browser-only clients, including AVI/Matroska containers and
EAC3 or multichannel audio.

The player reports `Direct Play` because Conduit neither rewrites nor proxies
the source. It also reports the detected video/audio codecs and whether libmpv
selected a hardware decoder. The device hardware-acceleration preference is
passed to libmpv; disabling it forces software decoding.

libmpv is built into the Linux Flatpak, bundled for Windows and macOS releases,
or validated as a development dependency. See the release and development
documentation for the platform-specific source and version.

On Linux, launch Conduit with `CONDUIT_MPV_LOG=1` to print warning-level mpv
output plus detailed video-decoder and FFmpeg diagnostics. For targeted driver
testing, `CONDUIT_MPV_HWDEC` overrides the decoder selection for that process;
for example, `CONDUIT_MPV_HWDEC=vaapi-copy` tests VA-API without automatic
fallback to other APIs. These variables are intended for troubleshooting and
do not alter the saved hardware-acceleration preference.

## Android mobile fallback

Android keeps Media3 as its default playback engine and can retry a stream with
the bundled libmpv adapter when Media3 reports a playback error or does not
render a first frame within the bounded startup timeout. The fallback reuses
the direct source URL, request headers, external subtitle URLs, and the latest
known playback position. It does not proxy or transcode the source.

Android playback settings expose `Automatic`, `Media3`, and experimental
`libmpv` modes. Automatic fallback is limited to one libmpv attempt per
playback attempt and never loops between engines. The active engine and
fallback reason are included in playback diagnostics and combined errors.

Android libmpv is currently supplied by the pinned
`io.github.abdallahmehiz:mpv-android-lib:0.1.12` artifact. Its native bundle
and transitive media-library notices must be reviewed before a release that
ships the fallback to users. See `THIRD_PARTY_NOTICES.md` for provenance.

## Hosted web app

The web player uses the browser's `<video>` element and hls.js when the browser
can play a source. Before playing a direct file, it reads the container and
track headers with HTTP range requests. When the browser cannot play the
container or the primary codecs, or the video is HDR and WebGPU is available,
it plays the source with its own engine instead:

- Mediabunny demuxes MP4, Matroska/WebM, MPEG-TS, and other containers.
- WebCodecs decodes H.264, HEVC, VP9, and AV1 where the browser supports them.
- WebAssembly builds of FFmpeg decode what browsers cannot: AC-3 and E-AC-3,
  DTS (including DTS-HD Master Audio), TrueHD, and MLP audio; MPEG-1 and
  MPEG-2, MPEG-4 Part 2 (XviD, DivX), DivX 3, and VC-1/WMV3 video; and HEVC
  Main and Main 10 video on browsers without an HEVC decoder. They run in a
  worker. The HEVC decoder keeps up with 1080p on a desktop CPU but not 4K, and
  a seek decodes from the previous keyframe, so it can take a few seconds.
  Interlaced video is not deinterlaced.
- WebGPU draws frames. PQ and HLG video is tone mapped to SDR with the BT.2390
  curve and converted from BT.2020 to BT.709. The curve targets the source's
  peak brightness, read from HDR10+ scene metadata (HEVC SEI or AV1 metadata
  OBUs), Dolby Vision profile 8 RPUs,
  MaxCLL or mastering display SEI, or the Matroska Colour element, in that
  order. Without WebGPU, frames are drawn with Canvas 2D and the browser
  handles color.
- Dolby Vision profile 5, whose base layer is in Dolby's IPT color space, gets
  the RPU's reshaping curves and matrices in WebGPU, following libplacebo, and
  is tone mapped with the scene's peak brightness. Profile 7, as Blu-ray remuxes
  carry it, also gets its enhancement layer: FFmpeg decodes it in a worker and
  WebGPU adds its residual before the RPU's matrices. Profile 8 plays from its
  HDR10 or HLG base layer. AV1 profile 10 gets the same reshaping from the
  RPUs in its metadata OBUs; HDR AV1 decodes in software so the engine reads
  exact samples.
- HDR and Dolby Vision HEVC up to 1080p decode in software, so the engine reads
  exact samples. Larger frames use the browser's hardware decoder: the engine
  rewrites the stream's color description so the browser hands WebGPU values it
  can undo, and parses Dolby Vision RPUs separately. Browsers expose hardware
  frames at 8 bits per channel, so this path can band slightly, tint grays a
  little, and shift very saturated Dolby Vision colors.
- Chrome on Linux only decodes video in hardware through VA-API. On NVIDIA GPUs
  that needs `nvidia-vaapi-driver` and Chrome flags; without them, 4K HEVC falls
  back to software decoding, which does not keep up.
- Surround audio plays as is on outputs with enough channels, and otherwise is
  downmixed to stereo.
- Embedded Matroska subtitles (SRT, ASS/SSA as plain text, WebVTT, and PGS
  images) are read from the file with range requests on both routes, so the
  browser does not need to understand the container.
- If a decoder or the GPU fails mid-playback, the engine rebuilds it and
  resumes from the current position, up to twice a minute.

If an audio track still cannot be decoded, the engine plays another decodable
track in the same language, or plays the video alone. VP9 HDR10+
metadata in Matroska BlockAdditions is not read, and the engine plays at normal
speed only.
If either route fails before playback starts, the player tries the other one
once.

The engine needs a secure context (HTTPS or localhost) and a source host that
allows cross-origin reads. Other sources play through `<video>` as before.
Codec support therefore still depends on the browser and device. When neither
route can play a source, Conduit gives a compatibility error and suggests
choosing another stream or using the desktop app.

A web page cannot safely or silently install a loopback media service. Conduit
also does not send unsupported sources through the hosted API, because doing so
would change its privacy, bandwidth, abuse, and operating-cost model.

## External players

Direct HTTP and HTTPS sources can be played outside Conduit. On the web and
desktop source lists, the external player button next to Play hands the source
off as a one-entry M3U playlist. Browsers download the playlist; the desktop app
opens it with the system's default playlist app, such as VLC or mpv.

On Android and Android TV, **Use external player** under Playback settings sends
every direct source to Android's app picker instead of Conduit's player, with
the title, resume position, and add-on request headers as intent extras. P2P
sources and watch parties still play in Conduit. iOS does not offer this.

External players do not report progress back, so watch history is not updated.

## Future remote transcoding

Remote transcoding remains useful for self-hosters who need browser or
low-power-device compatibility. It should be a separate, explicitly configured
media-worker deployment with authenticated source handoff, bounded resources,
session cleanup, segmented seeking, and a declared FFmpeg codec/license policy.
It should not be enabled on the public demo or coupled to the synchronization
API by default.
