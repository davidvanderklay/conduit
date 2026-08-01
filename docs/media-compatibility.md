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

## Hosted web app

The web player uses the browser media APIs and hls.js. Codec, container, audio,
and CORS support therefore depend on the browser and device. When the browser
rejects a source, Conduit gives a compatibility error and suggests choosing
another stream or using the desktop app.

A web page cannot safely or silently install a loopback media service. Conduit
also does not send unsupported sources through the hosted API, because doing so
would change its privacy, bandwidth, abuse, and operating-cost model.

## Future remote transcoding

Remote transcoding remains useful for self-hosters who need browser or
low-power-device compatibility. It should be a separate, explicitly configured
media-worker deployment with authenticated source handoff, bounded resources,
session cleanup, segmented seeking, and a declared FFmpeg codec/license policy.
It should not be enabled on the public demo or coupled to the synchronization
API by default.
