#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="$repo_root/apps/client/composeApp/src/androidMain/jniLibs"

command -v cargo >/dev/null
command -v cargo-ndk >/dev/null || {
  echo "cargo-ndk is required: cargo install cargo-ndk --version 3.5.4 --locked" >&2
  exit 1
}

mkdir -p "$out"
cargo ndk \
  --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --platform 26 \
  --target arm64-v8a \
  --target x86_64 \
  --output-dir "$out" \
  build --release
