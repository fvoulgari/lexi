#!/usr/bin/env bash
# Caller must serialize both version writes and SHA writes shared with main.
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

registry_digest() {
  docker buildx imagetools inspect "$1" --format '{{json .}}' |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["manifest"]["digest"])'
}

release_image="$IMAGE:$RELEASE_TAG"
release_exists=false
if output=$(docker pull --platform linux/amd64 "$release_image" 2>&1); then
  release_exists=true
  revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$release_image")
  platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$release_image")
  if [[ "$revision" != "$SOURCE_SHA" || "$platform" != linux/amd64 ]]; then
    echo 'Published release has a different source or platform; refusing to overwrite it.' >&2
    exit 1
  fi
elif [[ "$output" != *'manifest unknown'* && "$output" != *"$release_image: not found"* ]]; then
  echo "$output" >&2
  exit 1
fi

release_digest=''
if [[ "$release_exists" = true ]]; then
  release_digest=$(registry_digest "$release_image")
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
  if [[ "$release_exists" = true ]]; then
    docker tag "$release_image" "$sha_image"
  else
    docker build --platform linux/amd64 --load --provenance=false \
      --label org.opencontainers.image.source=https://github.com/fvoulgari/lexi \
      --label "org.opencontainers.image.revision=$SOURCE_SHA" \
      -t "$sha_image" .
  fi
  docker push "$sha_image"
else
  echo "$output" >&2
  exit 1
fi

# Compare registry manifest identity, not merely matching revision labels.
sha_digest=$(registry_digest "$sha_image")
if [[ ! "$sha_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo 'Registry did not return a valid SHA image digest.' >&2
  exit 1
fi
if [[ "$release_exists" = true ]]; then
  if [[ "$release_digest" != "$sha_digest" ]]; then
    echo 'Published release differs from the SHA image; refusing to overwrite it.' >&2
    exit 1
  fi
else
  docker tag "$sha_image" "$release_image"
  docker push "$release_image"
  release_digest=$(registry_digest "$release_image")
  if [[ "$release_digest" != "$sha_digest" ]]; then
    echo 'Published release digest does not match the verified SHA image.' >&2
    exit 1
  fi
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'digest=%s\nimage=%s@%s\n' "$release_digest" "$IMAGE" "$release_digest" >> "$GITHUB_OUTPUT"
fi
printf 'Verified release %s at %s@%s\n' "$RELEASE_TAG" "$IMAGE" "$release_digest"
