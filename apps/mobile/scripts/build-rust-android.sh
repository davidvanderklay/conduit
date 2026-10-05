#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="$repo_root/apps/mobile/composeApp/src/androidMain/jniLibs"

command -v cargo >/dev/null
command -v cargo-ndk >/dev/null || {
  echo "cargo-ndk is required: cargo install cargo-ndk --version 3.5.4 --locked" >&2
  exit 1
}

# Android 15+ devices may use 16 KB memory pages. NDK r28 aligns to that by
# default; setting it here keeps older NDKs producing compatible libraries.
page_size_flags="-C link-arg=-Wl,-z,max-page-size=16384"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="$page_size_flags"
export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_RUSTFLAGS="$page_size_flags"
export CARGO_TARGET_X86_64_LINUX_ANDROID_RUSTFLAGS="$page_size_flags"

mkdir -p "$out"
cargo ndk \
  --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --platform 26 \
  --target arm64-v8a \
  --target armeabi-v7a \
  --target x86_64 \
  --output-dir "$out" \
  build --release
