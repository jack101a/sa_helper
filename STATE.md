# STATE.md - Docker image plug-and-play packaging

## Status
**READY TO PUSH** - Docker packaging has been updated so the GHCR image contains runtime dependencies and bundled data assets.

## Active Task
Make the SA Helper Docker image self-contained and publish the updated branch to `sa_helper/before-scale`.

## Last Action
Updated Docker packaging to include bundled data seed assets, Hindi/English Tesseract packages, entrypoint volume seeding, GHCR compose usage, and `before-scale` image publishing workflow. Docker is not installed locally, so verification used Python/YAML/static checks instead of a local Docker build.

## Last Files Modified
- `.gitattributes`
- `.github/workflows/docker.yml`
- `Dockerfile`
- `docker-entrypoint.sh`
- `docker-compose.yml`
- `infra/backend/Dockerfile`
- `infra/docker-compose.yml`
- `TASK.md`
- `STATE.md`

## Last Commands Run
- `python -m py_compile backend\app\core\config.py backend\app\main.py backend\app\services\exam_service.py`
- YAML parse check for `docker-compose.yml`, `infra/docker-compose.yml`, `.github/workflows/docker.yml`, and `backend/config/config.yaml`
- Runtime asset existence check for ONNX, question JSON, sign hashes, mappings, tessdata, and automation scripts
- Settings load check for Docker-style env paths and concurrency settings
- `docker --version`
- `docker compose -f docker-compose.yml config`
- `docker compose -f infra\docker-compose.yml config`

## Last Output/Error
- Python compile passed.
- YAML parse checks passed.
- Required bundled assets exist locally:
  - `data/models/model.onnx`
  - `data/questions/questions.json`
  - `data/hashes/sign_hashes.json`
  - `data/hashes/sign_label.json`
  - `data/mappings/index.json`
  - `backend/tessdata/eng.traineddata`
  - `backend/tessdata/hin.traineddata`
  - `backend/app/data/automation_scripts/step3.js`
  - `backend/app/data/automation_scripts/step4.js`
- Settings check loaded `queue.workers=4` and `exam.ocr_concurrency=2`.
- Docker verification could not run locally because `docker` is not installed in this Windows environment.

## Immediate Next Step
Commit the packaging changes and push the current HEAD to `sa_helper` branch `before-scale`, letting GitHub Actions perform the real multi-arch Docker build/publish.

## Task Status
In progress: push pending.
