#!/usr/bin/env bash

set -euo pipefail

release_tag="${1:?release tag is required}"
shift
test "$#" -gt 0

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

# Newly created drafts can take a few seconds to appear in the release listing.
for attempt in {1..5}; do
  release_id="$(gh api \
    --paginate \
    "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
    --jq ".[] | select(.tag_name == \"$release_tag\") | .id" | head -n 1)"
  if [ -n "$release_id" ]; then
    break
  fi
  if [ "$attempt" -lt 5 ]; then
    sleep 2
  fi
done
if [ -z "$release_id" ]; then
  echo "Release did not appear in the API listing: $release_tag" >&2
  exit 1
fi

upload_url="$(gh api \
  "repos/$GITHUB_REPOSITORY/releases/$release_id" \
  --jq '.upload_url')"
upload_url="${upload_url%\{*}"

for asset in "$@"; do
  test -f "$asset"
  name="$(basename "$asset")"
  case "$name" in
    *[!A-Za-z0-9._-]*)
      echo "Unsupported release asset name: $name" >&2
      exit 1
      ;;
  esac

  existing_id="$(gh api \
    --paginate \
    "repos/$GITHUB_REPOSITORY/releases/$release_id/assets?per_page=100" \
    --jq ".[] | select(.name == \"$name\") | .id" | head -n 1 || true)"
  if [ -n "$existing_id" ]; then
    echo "Release assets are immutable: $name already exists. Publish a new version." >&2
    exit 1
  fi

  curl --fail --location --silent --show-error \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'Content-Type: application/octet-stream' \
    --data-binary "@$asset" \
    "$upload_url?name=$name" \
    --output /dev/null
done
