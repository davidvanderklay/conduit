#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$repo_root/apps/mobile/scripts/p2p-build.sh"
native="$repo_root/apps/mobile/native/ios/$conduit_p2p_mode"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo_root/target}/mobile/$conduit_p2p_mode"

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "iOS Rust libraries must be built on macOS with Xcode installed." >&2
  exit 1
}

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
cargo build --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --release --locked --no-default-features "${conduit_p2p_features[@]}" --target aarch64-apple-ios
cargo build --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --release --locked --no-default-features "${conduit_p2p_features[@]}" --target aarch64-apple-ios-sim
cargo build --manifest-path "$repo_root/packages/mobile-bridge/Cargo.toml" \
  --release --locked --no-default-features "${conduit_p2p_features[@]}" --target x86_64-apple-ios

mkdir -p "$native/iosArm64" "$native/iosSimulatorArm64" "$native/iosX64"
cp "$CARGO_TARGET_DIR/aarch64-apple-ios/release/libconduit_mobile.a" "$native/iosArm64/"
cp "$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libconduit_mobile.a" "$native/iosSimulatorArm64/"
cp "$CARGO_TARGET_DIR/x86_64-apple-ios/release/libconduit_mobile.a" "$native/iosX64/"

conduit_p2p_swift_condition=""
[[ "$conduit_p2p_mode" != p2p ]] || conduit_p2p_swift_condition=CONDUIT_P2P

# Xcode passes these settings to its Gradle phase and selects the matching archive.
cat > "$repo_root/apps/mobile/native/ios/build-mode.xcconfig" <<EOF
CONDUIT_P2P = ${CONDUIT_P2P:-0}
CONDUIT_STORE_BUILD = ${CONDUIT_STORE_BUILD:-0}
CONDUIT_NATIVE_MODE = $conduit_p2p_mode
SWIFT_ACTIVE_COMPILATION_CONDITIONS = \$(inherited) $conduit_p2p_swift_condition
EOF
