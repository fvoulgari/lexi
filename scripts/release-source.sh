#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?RELEASE_TAG is required}"

# Preserve the exact release tag; reject Docker-incompatible or reserved names.
if [[ ! "$RELEASE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ || "$RELEASE_TAG" = latest || "$RELEASE_TAG" = sha-* ]]; then
  echo 'Release tag is not a valid, unreserved Docker image tag.' >&2
  exit 1
fi
git rev-parse --verify "refs/tags/$RELEASE_TAG^{commit}"
