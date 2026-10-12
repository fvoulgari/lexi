#!/bin/sh
set -eu
alembic upgrade head
exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
