# Unified Platform — README

## Three Services in One

| Service | Extension Module | Backend Endpoint |
|---|---|---|
| Text Captcha | `CaptchaModule` | `POST /v1/solve` |
| MCQ Exam Solver | `ExamModule` | `POST /v1/exam/solve` |
| Form Autofill | `AutofillModule` | `POST /v1/autofill/fill` |

## Quickstart

### 1. Backend Setup

```bash
cd platform/
cp .env.example .env
# Edit .env — set AUTH_HASH_SALT, ADMIN_TOKEN, ADMIN_PASSWORD
# Place your ONNX text captcha model at: backend/models/model.onnx

cd backend/
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Or with Docker:
```bash
cd platform/
docker-compose up -d
```

### 2. Create a User API Key

Access the admin dashboard at `http://your-server:8080/admin/`
- Login with your `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- Go to **API Keys → Create Key**
- Set name, expiry, and rate limits
- Share the `sk-...` key with the user

### 3. Load Extension

**Chrome:**
1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" → select `platform/extension/`

**Firefox:**
1. Open `about:debugging`
2. Click "This Firefox → Load Temporary Add-on"
3. Select `platform/extension/manifest_firefox.json`

**Kiwi Browser (Android):**
1. Same as Chrome (Kiwi supports unpacked extensions)

### 4. User Configuration

1. Click extension icon → **Settings**
2. Enter the API key and server URL
3. Click **Save & Verify**
4. Fill in the **My Profile** tab with personal information
5. Enable desired services

## Architecture

```
Extension (lightweight)
    ↓ HTTPS + x-api-key header
Backend (FastAPI)
    ├── /v1/solve          → ONNX text captcha OCR
    ├── /v1/exam/solve     → Hash → Tesseract OCR → LLM
    ├── /v1/autofill/fill  → Rule engine (profile stays on-device)
    └── /admin/*           → Admin dashboard
```

## Two-Server Setup

Use `nginx.conf` with Server A as primary and Server B as cold backup.
If Server A fails, Nginx automatically routes to Server B within 5s.

```
User → Nginx (your-server.com)
         ├── Server A :8080  ← primary
         └── Server B :8080  ← backup (auto-failover)
```

## User Data Privacy

- Personal profile data (name, phone, etc.) is stored **only** in the browser's local storage
- The server stores **field routing rules** only — it never sees personal values
- API keys are stored as bcrypt hashes — the plaintext key is shown once at creation

## Adding Users

1. Admin logs into `/admin/` dashboard
2. Creates a new API key (name it after the user)
3. Optionally sets rate limits and domain restrictions
4. Sends the `sk-...` key to the user via WhatsApp/email
5. If WhatsApp alerts are configured (`.env`), admin is notified of key events automatically
