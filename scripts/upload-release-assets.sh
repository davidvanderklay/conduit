#!/usr/bin/env bash

set -euo pipefail

release_tag="${1:?release tag is required}"
shift
test "$#" -gt 0

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

release_id="$(gh api \
  --repo "$GITHUB_REPOSITORY" \
  --paginate \
  "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
  --jq ".[] | select(.tag_name == \"$release_tag\") | .id" | head -n 1)"
test -n "$release_id"

upload_url="$(gh api \
  --repo "$GITHUB_REPOSITORY" \
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
    --repo "$GITHUB_REPOSITORY" \
    --paginate \
    "repos/$GITHUB_REPOSITORY/releases/$release_id/assets?per_page=100" \
    --jq ".[] | select(.name == \"$name\") | .id" | head -n 1 || true)"
  if [ -n "$existing_id" ]; then
    gh api --repo "$GITHUB_REPOSITORY" \
      --method DELETE \
      "repos/$GITHUB_REPOSITORY/releases/assets/$existing_id" >/dev/null
  fi

  curl --fail --location --silent --show-error \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'Content-Type: application/octet-stream' \
    --data-binary "@$asset" \
    "$upload_url?name=$name" \
    --output /dev/null
done
