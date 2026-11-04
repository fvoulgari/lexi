#!/bin/sh
set -eu
alembic upgrade head
# OAuth callback queries contain one-time credentials; do not log raw URLs.
exec uvicorn app.main:create_app --factory --no-access-log --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
