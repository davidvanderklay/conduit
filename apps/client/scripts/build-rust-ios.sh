#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
native="$repo_root/apps/client/native/ios"

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "iOS Rust libraries must be built on macOS with Xcode installed." >&2
  exit 1
}

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
cargo build --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --release --target aarch64-apple-ios
cargo build --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --release --target aarch64-apple-ios-sim
cargo build --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --release --target x86_64-apple-ios

mkdir -p "$native/iosArm64" "$native/iosSimulatorArm64" "$native/iosX64"
cp "$repo_root/target/aarch64-apple-ios/release/libconduit_mobile.a" "$native/iosArm64/"
cp "$repo_root/target/aarch64-apple-ios-sim/release/libconduit_mobile.a" "$native/iosSimulatorArm64/"
cp "$repo_root/target/x86_64-apple-ios/release/libconduit_mobile.a" "$native/iosX64/"
