#!/bin/sh
set -eu

seed_dir="/opt/sa-helper-seed"

seed_path() {
  src="$1"
  dst="$2"

  if [ -d "$src" ]; then
    mkdir -p "$dst"
    cp -an "$src/." "$dst/"
  fi
}

mkdir -p /app/backend/logs /app/backend/app/static/extensions /app/backend/app/templates /app/data /app/import

seed_path "$seed_dir/backend/config" "/app/backend/config"

if [ "${RUN_ALEMBIC_MIGRATIONS:-false}" = "true" ]; then
  cd /app/backend
  alembic upgrade head
fi

exec "$@"
