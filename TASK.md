# TASK.md - Make Docker Image Plug and Play

## Goal
Make the SA Helper Docker image self-contained so users can run it without installing Tesseract, ONNX models, question JSON, sign hashes, or userscript mappings on the host. Publish the updated image from GHCR on the `before-scale` branch.

## Scope
- Bundle required runtime assets in the root Docker image.
- Keep Tesseract Hindi/English OCR available inside the image.
- Update Docker Compose to use the GHCR image and persist only mutable runtime data.
- Keep concurrency defaults from the previous task: 2 uvicorn workers, 4 captcha workers, MCQ OCR concurrency 2.
- Update GHCR workflow so pushes to `before-scale` build/publish multi-arch images.
- Verify config loading and container build path as far as practical locally.

## Excluded
- No Redis/distributed queue.
- No new model training or data regeneration.
- No unrelated app refactor.

## Plan
1. [done] Read current Dockerfiles, compose files, workflow, and runtime asset paths.
2. [done] Patch Dockerfile/compose/workflow for bundled assets and plug-and-play runtime.
3. [done] Verify syntax/config and Docker build health where possible.
4. [in-progress] Update STATE.md.
5. [pending] Commit and push to `sa_helper` `before-scale`.

## Verification
- Run backend py_compile for touched Python if any.
- Confirm settings resolve bundled `/app/data` and `/app/backend/tessdata` paths.
- Run Docker Compose config validation.
- Build Docker image if local Docker is available.

## Result
Docker image now seeds bundled `/app/data` assets from `/opt/sa-helper-seed`, includes Hindi/English Tesseract packages and traineddata, and exposes `/health` for container health checks. Compose files use the GHCR image with named volumes for logs/config/data so users do not have to install or mount ONNX, question JSON, sign hashes, userscript mappings, or tessdata manually. Local Docker is not installed in this environment, so Docker build/compose execution must be verified by GitHub Actions.
