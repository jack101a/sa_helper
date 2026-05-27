# Distributed Solver Worker

The API can run captcha solves through a Redis-backed queue instead of its
in-process queue. This makes it possible to add solver workers on the same host
or on another machine, including a home PC connected through a private
Pangolin/Newt route.

## Main Server

`docker-compose.yml` starts:

- `redis`: shared job/result queue.
- `sa-helper`: API, configured with `SOLVER_QUEUE_BACKEND=redis`.
- `worker`: local solver worker, configured with `python -m app.worker`.

The API resolves the model filename before enqueueing each job. Remote workers
therefore need the referenced model files under their configured `ONNX_PATH` or
`/app/data/models`, but they do not need to own the API routing database for
normal captcha routing.

`SOLVER_QUEUE_FALLBACK_LOCAL=true` is enabled by default in compose. If Redis or
all workers are unavailable, the API falls back to the old local solver path
instead of failing the request. Disable it only if you want strict worker-only
operation.

If you do not deploy any extra home/mini-PC worker, the VPS `worker` service is
still enough. Extra workers are only capacity add-ons; they are not required for
normal operation.

## Add More Workers

On another machine, run the same image with:

```bash
docker run -d --name sa-helper-worker-home --restart unless-stopped \
  -e APP_ENV=production \
  -e AUTH_HASH_SALT="$AUTH_HASH_SALT" \
  -e ADMIN_TOKEN="$ADMIN_TOKEN" \
  -e ADMIN_USERNAME="${ADMIN_USERNAME:-admin}" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e SOLVER_QUEUE_BACKEND=redis \
  -e SOLVER_WORKER_CONCURRENCY=2 \
  -e REDIS_URL="redis://YOUR-PANGOLIN-REDIS-HOST:6379/0" \
  -e REDIS_PREFIX="sa_helper:" \
  -e SQLITE_PATH=/app/backend/logs/app.db \
  -e CONFIG_PATH=/app/backend/config/config.yaml \
  -e ONNX_PATH=/app/data/models/model.onnx \
  -v /your/sa_helper/logs:/app/backend/logs \
  -v /your/sa_helper/data:/app/data \
  -v /your/sa_helper/config:/app/backend/config \
  ghcr.io/jack101a/sa-helper:latest \
  python -m app.worker
```

For best security, expose Redis only on a private tunnel/network and protect
that route. Do not publish Redis openly to the internet.

## Rollback

Set this on the API and stop worker/Redis if you want the old behavior:

```env
SOLVER_QUEUE_BACKEND=inprocess
```
