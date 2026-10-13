#!/usr/bin/env bash
# Caller must serialize promotions for this image across all main runs.
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${MAIN_RUN_NUMBER:?MAIN_RUN_NUMBER is required}"
if [[ ! "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ || ! "$MAIN_RUN_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Invalid source SHA or main run number.' >&2
  exit 1
fi

label='io.github.fvoulgari.lexi.main-run-number'
latest_number=0
if output=$(docker pull --platform linux/amd64 "$IMAGE:latest" 2>&1); then
  latest_number=$(docker image inspect --format "{{ index .Config.Labels \"$label\" }}" "$IMAGE:latest")
  if [[ ! "$latest_number" =~ ^[1-9][0-9]*$ ]]; then
    echo 'Existing latest has no valid main run number; refusing to overwrite it.' >&2
    exit 1
  fi
elif [[ "$output" != *'manifest unknown'* && "$output" != *"$IMAGE:latest: not found"* ]]; then
  echo "$output" >&2
  exit 1
fi

if (( MAIN_RUN_NUMBER <= latest_number )); then
  echo "Keeping latest from main run $latest_number; candidate is $MAIN_RUN_NUMBER."
  exit 0
fi

candidate="$IMAGE:sha-$SOURCE_SHA"
docker pull --platform linux/amd64 "$candidate"
candidate_number=$(docker image inspect --format "{{ index .Config.Labels \"$label\" }}" "$candidate")
candidate_sha=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$candidate")
if [[ "$candidate_number" != "$MAIN_RUN_NUMBER" || "$candidate_sha" != "$SOURCE_SHA" ]]; then
  echo 'Candidate image metadata does not match this main run.' >&2
  exit 1
fi
docker tag "$candidate" "$IMAGE:latest"
docker push "$IMAGE:latest"
echo "Promoted main run $MAIN_RUN_NUMBER ($SOURCE_SHA) to latest."
