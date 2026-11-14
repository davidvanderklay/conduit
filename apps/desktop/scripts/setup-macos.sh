#!/usr/bin/env bash
# Downloads the pinned libmpv dylib set for this Mac's architecture into
# apps/desktop/libmpv. build.rs links the native addon against it and
# install.mjs ships it beside the addon, so packaged apps need no Homebrew mpv.
set -euo pipefail

desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
libmpv_dir="$desktop_dir/libmpv"

# Conduit mirrors IINA's prebuilt per-architecture libmpv set
# (https://iina.io/dylibs/<arch>, mpv 0.42.0, macOS 12+) as release assets so
# the pin cannot change underneath us. Every library uses an @rpath install
# name. Override both values together when intentionally updating the runtime.
release_url="https://github.com/davidvanderklay/conduit/releases/download/deps/libmpv-macos-0.42.0-iina"
case "$(uname -m)" in
  arm64)
    default_url="$release_url/libmpv-macos-arm64.tar.gz"
    default_sha256="43d3aaafe057d613bc754fbb3534067b2e3388afb995c82e54d01deeff39c725"
    ;;
  x86_64)
    default_url="$release_url/libmpv-macos-x64.tar.gz"
    default_sha256="ac68fc0a79ceab81481f0efe2dd9c4256ae6801e8e12af4af8dfc57dd3ca7d71"
    ;;
  *)
    echo "[libmpv] Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac
download_url="${CONDUIT_LIBMPV_URL:-$default_url}"
expected_sha256="${CONDUIT_LIBMPV_SHA256:-$default_sha256}"

stamp="$libmpv_dir/.sha256"
if [ -f "$libmpv_dir/libmpv.2.dylib" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$expected_sha256" ]; then
  echo "[libmpv] Ready: $libmpv_dir"
  exit 0
fi

archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT
echo "[libmpv] Downloading $download_url"
curl --fail --location --silent --show-error "$download_url" --output "$archive"

actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
if [ "$actual_sha256" != "$expected_sha256" ]; then
  echo "[libmpv] Checksum mismatch (expected $expected_sha256, got $actual_sha256)" >&2
  exit 1
fi

mkdir -p "$libmpv_dir"
find "$libmpv_dir" -maxdepth 1 -name '*.dylib' -delete
tar -xzf "$archive" -C "$libmpv_dir"
# `-lmpv` resolves libmpv.dylib; the linked addon still records the library's
# install name, @rpath/libmpv.2.dylib. install.mjs skips this link.
ln -sf libmpv.2.dylib "$libmpv_dir/libmpv.dylib"
echo "$expected_sha256" > "$stamp"
echo "[libmpv] Ready: $libmpv_dir"
