#!/usr/bin/env bash
set -euo pipefail

test "${BACKEND_RESULT:-}" = success
test "${FRONTEND_RESULT:-}" = success
test "${PUBLICATION_RESULT:-}" = success
