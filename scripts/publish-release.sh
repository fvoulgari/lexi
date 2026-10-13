#!/usr/bin/env bash
# Caller must serialize SHA writes with main publication for the same commit.
set -euo pipefail
: "${IMAGE:?IMAGE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
resolved_sha=$(bash "$script_directory/release-source.sh")
if [[ "$resolved_sha" != "$SOURCE_SHA" || "$(git rev-parse HEAD)" != "$SOURCE_SHA" ]]; then
  echo 'Checkout must match the resolved release commit.' >&2
  exit 1
fi

sha_image="$IMAGE:sha-$SOURCE_SHA"
if output=$(docker pull --platform linux/amd64 "$sha_image" 2>&1); then
  revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$sha_image")
  platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$sha_image")
  if [[ "$revision" != "$SOURCE_SHA" || "$platform" != linux/amd64 ]]; then
    echo 'Existing SHA image has incorrect source or platform metadata.' >&2
    exit 1
  fi
elif [[ "$output" = *'manifest unknown'* || "$output" = *"$sha_image: not found"* ]]; then
  docker build --platform linux/amd64 \
    --label org.opencontainers.image.source=https://github.com/fvoulgari/lexi \
    --label "org.opencontainers.image.revision=$SOURCE_SHA" \
    -t "$sha_image" .
  docker push "$sha_image"
else
  echo "$output" >&2
  exit 1
fi

# Reusing SHA images preserves main ordering metadata and avoids concurrent rebuilds.
docker tag "$sha_image" "$IMAGE:$RELEASE_TAG"
docker push "$IMAGE:$RELEASE_TAG"
