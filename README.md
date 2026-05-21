# Unified MCQ Solver — Modernized Monorepo

Standardized monorepo with clear separation of concerns, inspired by the high-quality `refactor` architecture.

## Repository Structure
- **backend/**: FastAPI application core (Captcha + Exam + Autofill).
- **frontend/**: React/Vite admin dashboard source.
- **extension/**: Cross-browser extension source (Manifest V3).
- **config/**: Runtime configuration (Single source of truth: `.env`, `config.yaml`).
- **infra/**: Deployment assets (Docker, Nginx, Systemd).
- **scripts/**: Local tooling and lifecycle scripts.

## Setup & Running

### 1. Backend
- Go to `backend/` and setup your venv.
- Copy `config/backend.env` to `config/.env` and fill in secrets.
- Run `.\scripts\start.bat` to start or `.\scripts\stop.bat` to stop (Windows).
- Or use `./scripts/start_backend.sh` / `./scripts/stop_backend.sh` (Linux).

### 2. Frontend (Admin Dashboard)
- Go to `frontend/` and run `npm install && npm run build`.
- The backend serves the built assets from `frontend/dist`.

### 3. Extension
- Load `extension/` as an unpacked extension in Chrome/Edge.
- Configure the Server URL and API Key in the options page.

## Canonical Paths
- **Config**: `config/`
- **Models**: `data/models/`
- **Data/DB**: `backend/logs/app.db`
- **Extension Builds**: `scripts/package_extensions.ps1` (planned)

---
*Maintained by Antigravity AI.*
