#!/usr/bin/env bash
# Builds the web player's FFmpeg WebAssembly decoders from a pinned FFmpeg release.
#
#   nix shell nixpkgs#emscripten --command apps/web/wasm/build.sh
#
# Any recent Emscripten works. Outputs go to apps/web/src/lib/web-engine/wasm/ and
# are committed, so normal builds do not need Emscripten. FFmpeg is configured
# without GPL, version 3, or nonfree parts, so the decoders stay LGPL 2.1+.
set -euo pipefail

FFMPEG_VERSION=8.1.3
FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3

here="$(cd "$(dirname "$0")" && pwd)"
output="$here/../src/lib/web-engine/wasm"
work="${WORK_DIR:-$(mktemp -d)}"
jobs="$(nproc 2>/dev/null || echo 4)"
mkdir -p "$output"

archive="$work/ffmpeg-$FFMPEG_VERSION.tar.xz"
if [ ! -f "$archive" ]; then
  curl -sSfL "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" -o "$archive"
fi
echo "$FFMPEG_SHA256  $archive" | sha256sum -c -

exports='["_malloc","_free","_decoder_open","_decoder_packet","_decoder_send","_decoder_drain","_decoder_receive","_decoder_reset","_decoder_close","_frame_pixel_layout","_frame_sample_layout","_frame_data","_frame_linesize","_frame_timestamp","_frame_duration","_frame_width","_frame_height","_frame_color_primaries","_frame_color_transfer","_frame_color_matrix","_frame_full_range","_frame_samples","_frame_sample_rate","_frame_channels","_frame_channel_mask","_frame_dovi","_rpu_parse","_frame_hdr_peaks","_sei_hdr_peaks","_t35_hdr_peaks"]'

# $1: module name, $2: FFmpeg arch flags, $3: optimization, $4: maximum memory, $5...: decoders
build() {
  local name="$1" arch="$2" optimize="$3" memory="$4"
  shift 4
  local tree="$work/$name/ffmpeg-$FFMPEG_VERSION"
  rm -rf "$work/$name"
  mkdir -p "$work/$name"
  tar -xf "$archive" -C "$work/$name"
  local decoders=()
  for decoder in "$@"; do decoders+=("--enable-decoder=$decoder"); done
  (
    cd "$tree"
    # shellcheck disable=SC2086
    emconfigure ./configure --target-os=none $arch --enable-cross-compile \
      --disable-x86asm --disable-inline-asm --disable-programs --disable-doc \
      --disable-debug --disable-all --disable-everything --disable-autodetect \
      --disable-pthreads --disable-runtime-cpudetect --disable-iconv --disable-gpl \
      --disable-version3 --disable-nonfree --enable-avcodec --enable-avutil \
      "${decoders[@]}" \
      --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=llvm-nm \
      --extra-cflags="$optimize -flto -msimd128 -DNDEBUG -ffile-prefix-map=$tree=ffmpeg" \
      --extra-ldflags="$optimize -flto -msimd128"
    grep -q '^#define CONFIG_GPL 0$' config.h
    # The WebAssembly arch keeps FFmpeg's simd128 HEVC transforms; fail if configure dropped them.
    [ "$arch" != "--arch=wasm" ] || grep -q '^#define HAVE_SIMD128 1$' config.h
    emmake make -j"$jobs" libavcodec/libavcodec.a libavutil/libavutil.a
  )
  emcc "$here/ffmpeg_bridge.c" "$tree/libavcodec/libavcodec.a" "$tree/libavutil/libavutil.a" \
    -I"$tree" "$optimize" -flto -msimd128 -ffile-prefix-map="$here"=wasm \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sFILESYSTEM=0 \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY="$memory" \
    -sSTACK_SIZE=5242880 -sMALLOC=emmalloc -sASSERTIONS=0 \
    -sEXPORTED_FUNCTIONS="$exports" -sEXPORTED_RUNTIME_METHODS='["HEAPU8","stringToNewUTF8"]' \
    -o "$output/$name.mjs"
  chmod 644 "$output/$name.wasm"
}

# The audio decoders are portable C sized for download; the video decoders are tuned for speed.
build ffmpeg-audio "--arch=x86_32 --disable-asm" -Oz 268435456 dca truehd mlp
build ffmpeg-video "--arch=wasm" -O3 4294967296 hevc
build ffmpeg-legacy "--arch=x86_32 --disable-asm" -O3 4294967296 mpeg1video mpeg2video mpeg4 msmpeg4v3 vc1 wmv3
ls -l "$output"
