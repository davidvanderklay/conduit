#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
version="${1:-}"
build_number="${2:-}"
output_dir="${3:-$repo_root/target/release/bundle/ios}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: $0 <semantic-version> <numeric-build-number> [output-directory]" >&2
  exit 1
fi

if [[ ! "$build_number" =~ ^[0-9]+$ ]]; then
  echo "The iOS build number must be numeric." >&2
  exit 1
fi

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "The iOS IPA must be built on macOS with Xcode installed." >&2
  exit 1
}

command -v xcodegen >/dev/null || {
  echo "XcodeGen is required to generate the iOS project." >&2
  exit 1
}

marketing_version="${version%%-*}"
derived_data="$(mktemp -d "${TMPDIR:-/tmp}/conduit-ios-release.XXXXXX")"
trap 'rm -rf "$derived_data"' EXIT

(
  cd "$repo_root/apps/mobile/iosApp"
  xcodegen generate
  xcodebuild \
    -project ConduitMobileSpike.xcodeproj \
    -scheme ConduitMobileSpike \
    -configuration Release \
    -sdk iphoneos \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    MARKETING_VERSION="$marketing_version" \
    CURRENT_PROJECT_VERSION="$build_number" \
    build
)

app="$derived_data/Build/Products/Release-iphoneos/conduit.app"
info_plist="$app/Info.plist"
executable="$app/conduit"

test -d "$app"
test -f "$info_plist"
test -x "$executable"
test "$(plutil -extract CFBundleIdentifier raw "$info_plist")" = "media.conduit.mobile"
test "$(plutil -extract CFBundleShortVersionString raw "$info_plist")" = "$marketing_version"
test "$(plutil -extract CFBundleVersion raw "$info_plist")" = "$build_number"

case "$(lipo -archs "$executable")" in
  *arm64*) ;;
  *) echo "The packaged iOS application does not contain arm64." >&2; exit 1 ;;
esac

payload="$derived_data/ipa/Payload"
mkdir -p "$payload" "$output_dir"
ditto "$app" "$payload/Conduit.app"

ipa="$output_dir/conduit-${version}-ios-unsigned.ipa"
checksum="$ipa.sha256"
rm -f "$ipa" "$checksum"
ditto -c -k --norsrc --noextattr --noqtn --noacl --keepParent "$payload" "$ipa"
unzip -Z1 "$ipa" | grep -q '^Payload/Conduit.app/Info.plist$'

(
  cd "$output_dir"
  shasum -a 256 "$(basename "$ipa")" > "$(basename "$checksum")"
)

ls -lh "$ipa" "$checksum"
