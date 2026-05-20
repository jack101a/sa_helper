# TASK.md - Fix GHCR Docker Rclone Build Failure

## Goal
Fix GitHub Actions Docker build failure caused by direct rclone `.deb` download returning curl exit code 22.

## Status
COMPLETE

## Scope Included
- Replace fragile direct rclone download in Dockerfile with package-manager install.
- Keep multi-arch Buildx compatibility for amd64 and arm64.
- Run lightweight verification that does not require Docker daemon access.
- Commit the fix for pushing.
- Update STATE.md.

## Scope Excluded
- Full local Docker build, because Docker socket access is denied for this user.
- Changing application runtime behavior.

## Plan
- [x] Read AGENTS.md, STATE.md, TASK.md, and Dockerfile.
- [x] Patch Dockerfile rclone install.
- [x] Validate Dockerfile syntax/path expectations with static checks.
- [x] Commit fix.
- [x] Update STATE.md.

## Verification
- Dockerfile now installs `rclone` via Debian apt package.
- Direct `downloads.rclone.org/current/*.deb` URL is removed.
- `git diff --check Dockerfile TASK.md` passed.
- `docker build -t sa-helper-docker-audit:latest .` still cannot run locally because Docker socket access is denied.
