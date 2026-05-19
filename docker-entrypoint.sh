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

# Seed default data and config (no-clobber)
seed_path "$seed_dir/data" "/app/data"
seed_path "$seed_dir/backend/config" "/app/backend/config"

# Ensure all required directories exist
mkdir -p /app/backend/logs \
         /app/backend/logs/backups/system \
         /app/backend/logs/backups/users \
         /app/backend/logs/backups/full \
         /app/backend/app/static/extensions \
         /app/backend/app/templates \
         /app/data/payment_screenshots \
         /app/data/exam_offline

# Run Alembic migrations (skip in test mode)
if [ "${APP_ENV:-production}" != "test" ]; then
  echo "Running Alembic migrations..."
  cd /app/backend && python -m alembic upgrade head 2>&1 || echo "WARNING: Alembic migration failed — continuing with existing schema"
  cd /app
fi

exec "$@"
