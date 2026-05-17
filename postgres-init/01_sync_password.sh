#!/bin/bash
# This script runs on every Postgres container startup.
# It ensures the application user's password always matches
# the POSTGRES_PASSWORD environment variable from .env.
# This prevents auth failures when the data volume was initialized
# with a different password.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';
EOSQL

echo "✅ Password for user '${POSTGRES_USER}' synced from environment."
