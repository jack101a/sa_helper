# STATE.md - Use CONFIG_PATH For Host Volumes

## Status
COMPLETE

## Active Task
Switched Docker Compose host volume paths back to the user's required `${CONFIG_PATH}` variable.

## Last Files Modified
- `docker-compose.yml`
- `.env`
- `TASK.md`
- `STATE.md`

## Last Command Run
`python -c "import yaml; c=yaml.safe_load(open('docker-compose.yml', encoding='utf-8')); print('yaml_ok'); print(c['services']['api']['volumes']); print(c['services']['postgres']['volumes'])"`

## Last Output/Error
Completed:
- Replaced all Docker Compose host volume prefixes from `${SA_HELPER_HOST_ROOT:-/srv/ajaxhs/config}` to `${CONFIG_PATH}`.
- Replaced root `.env` `SA_HELPER_HOST_ROOT=/srv/ajaxhs/config` with `CONFIG_PATH=/srv/ajaxhs/config`.
- Kept app service environment `CONFIG_PATH: /app/backend/config/config.yaml` unchanged because the app still needs the container-side config file path.
- Kept PUID/PGID user support unchanged.

Verification:
- Docker Compose YAML parsed successfully.
- API volumes parse as `${CONFIG_PATH}/sa_helper/...`.
- Postgres volume parses as `${CONFIG_PATH}/sa_helper/postgres:/var/lib/postgresql/data`.
- No `SA_HELPER_HOST_ROOT` references remain in `docker-compose.yml` or root `.env`.

## Immediate Next Step
Use `CONFIG_PATH=/srv/ajaxhs/config` in Portainer/root `.env` before deploying.
