# SA Helper

Production-focused monorepo for:
- FastAPI backend (`backend/`)
- React admin dashboard (`frontend/`)
- Browser extension (`extension/`)
- Shared runtime data (`data/`)

## Repository Layout
- `backend/`: API, services, migrations, scheduler, tests.
- `frontend/`: Admin UI (Vite + React).
- `extension/`: MV3 extension source (loaded unpacked for development).
- `data/`: models, mappings, automation scripts, question/hashing datasets.
- `config/`: environment templates.
- `infra/`: deployment assets.
- `scripts/`: packaging and helper scripts.

## Local Development

### 1. Backend
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp config/.env.example config/.env
PYTHONPATH=backend python -m app.main
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Extension
Load `extension/` as an unpacked extension in Chromium browsers.

## Validation
- Backend tests:
```bash
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests
```
- Frontend production build:
```bash
cd frontend && npm run build
```
- Extension syntax checks:
```bash
node --check extension/background.js
node --check extension/modules/autofill.js
node --check extension/popup/popup.js
```

## Deployment Notes
- Primary runtime compose: `docker-compose.yml`
- Production overrides: `docker-compose.prod.yml`
- CI validates compose configuration for both files merged.
