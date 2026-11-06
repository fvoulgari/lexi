#!/bin/sh
set -eu
alembic upgrade head
if [ "${AUTH_INGRESS_MODE:-direct}" = "cloudflare_tunnel" ]; then
  exec python -m app.tunnel_runtime
fi
# OAuth callback queries contain one-time credentials; do not log raw URLs.
exec uvicorn app.main:create_app --factory --no-access-log --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
