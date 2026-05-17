# TASK.md - Use CONFIG_PATH For Host Volumes

## Goal
Switch Docker Compose host volume paths back to the user's required `${CONFIG_PATH}` variable.

## Status
COMPLETE

## Scope Included
- Replace `${SA_HELPER_HOST_ROOT:-/srv/ajaxhs/config}` volume prefixes with `${CONFIG_PATH}`.
- Add `CONFIG_PATH=/srv/ajaxhs/config` to the root `.env`.
- Keep container environment `CONFIG_PATH: /app/backend/config/config.yaml` for the app config file.

## Scope Excluded
- Renaming the container app config environment key.
- Changing PUID/PGID support.

## Plan
- [x] Read AGENTS/STATE/TASK and Compose/env files.
- [x] Patch Compose and root `.env`.
- [x] Validate YAML and update `STATE.md`.

## Verification Approach
- Parse `docker-compose.yml`.
- Confirm volume paths use `${CONFIG_PATH}`.
