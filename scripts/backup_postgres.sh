#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/backup_postgres.sh
# Required env:
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
# Optional env:
#   BACKUP_DIR (default: ./runtime/sa_helper/postgres-backups)
#   INCLUDE_GLOBALS (default: true)
#   RCLONE_REMOTE (example: remote:sa-helper-backups)

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB is required}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
BACKUP_DIR="${BACKUP_DIR:-./runtime/sa_helper/postgres-backups}"
INCLUDE_GLOBALS="${INCLUDE_GLOBALS:-true}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

mkdir -p "${BACKUP_DIR}"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="${BACKUP_DIR}/sa_helper_${ts}.dump"
globals_file="${BACKUP_DIR}/sa_helper_globals_${ts}.sql"

export PGPASSWORD="${POSTGRES_PASSWORD}"

pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -Fc \
  -f "${dump_file}"

if [[ "${INCLUDE_GLOBALS}" == "true" ]]; then
  pg_dumpall \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    --globals-only \
    > "${globals_file}"
fi

if [[ -n "${RCLONE_REMOTE}" ]]; then
  rclone copy "${BACKUP_DIR}" "${RCLONE_REMOTE}" --progress
fi

echo "Backup complete:"
echo "  ${dump_file}"
if [[ -f "${globals_file}" ]]; then
  echo "  ${globals_file}"
fi
