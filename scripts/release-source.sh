#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?RELEASE_TAG is required}"

# Exact stable SemVer, also bounded by Docker's image-tag length limit.
if [[ ! "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ || ${#RELEASE_TAG} -gt 128 ]]; then
  echo 'Release tag must be a canonical stable vMAJOR.MINOR.PATCH version.' >&2
  exit 1
fi
if [[ "${1:-}" = --check-tag ]]; then
  exit 0
fi
sha=$(git rev-parse --verify "refs/tags/$RELEASE_TAG^{commit}")
if ! git merge-base --is-ancestor "$sha" refs/remotes/origin/main; then
  echo 'Release commit must belong to origin/main.' >&2
  exit 1
fi
if [[ -n "${EXPECTED_SHA:-}" ]]; then
  if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || [[ "$(git rev-parse --verify "$EXPECTED_SHA^{commit}")" != "$sha" ]]; then
    echo 'Release tag no longer matches the triggering event.' >&2
    exit 1
  fi
fi
printf '%s\n' "$sha"
