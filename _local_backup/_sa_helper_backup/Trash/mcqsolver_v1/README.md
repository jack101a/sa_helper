# Sarathi STALL Solver — Chrome Extension (MV3)

Autonomous MCQ solver for the Sarathi Parivahan STALL driving license exam portal.

## Architecture

```
extension/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker (LiteLLM proxy)
├── content.js             # Main solver engine (3-layer pipeline)
├── database.js            # 300 Q&A entries + sign hash dictionary
├── icons/
│   └── icon.svg           # Extension icon
└── assets/                # Tesseract.js local files (user must add)
    ├── tesseract.min.js
    ├── worker.min.js
    ├── tesseract-core-simd.wasm.js
    ├── eng.traineddata.gz
    └── hin.traineddata.gz
```

## Solver Pipeline

| Layer | Method | Speed | Trigger |
|-------|--------|-------|---------|
| **1** | Image Hash (32×32 aHash) | < 5ms | Always runs first |
| **2** | On-device OCR (Tesseract eng+hin) | ~800ms | If Layer 1 misses |
| **3** | LiteLLM multimodal API | ~2-5s | If Layers 1 & 2 miss |

## Setup

### 1. Download Tesseract.js Assets

You can automatically download all required assets using the provided Node.js script:

```powershell
node download_assets.js
```

This will download the following files into `extension/assets/`:
- `tesseract.min.js`
- `worker.min.js`
- `tesseract-core-simd.wasm.js`
- `eng.traineddata.gz`
- `hin.traineddata.gz`

### 2. Generate Extension Icons

Convert `icons/icon.svg` to PNG:
- `icon48.png` (48×48)
- `icon128.png` (128×128)

Or use any PNG icons and place in `extension/icons/`.

### 3. Configure LiteLLM (Optional — Layer 3)

Edit `background.js` and set:
```javascript
const LITELLM_ENDPOINT = 'http://YOUR_SERVER:4000/v1/chat/completions';
const LITELLM_API_KEY  = 'YOUR_KEY';
```

If you don't have a LiteLLM server, Layers 1 & 2 still work fully offline.

### 4. Load Extension

1. Open `chrome://extensions/` (or equivalent in Kiwi/Lemur)
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Navigate to `sarathi.parivahan.gov.in` and start the STALL exam

### 5. Populate Sign Hashes (First Run)

During the first exam run, the extension logs each question's image hash to the console:
```
[MCQ] Q# 1 | Hash: a1b2c3d4e5f6... | 3ms
```

Copy these hashes and add them to `SIGN_HASH_DICT` in `database.js`:
```javascript
const SIGN_HASH_DICT = {
    "a1b2c3d4e5f6...": "sign_compulsory_turn_left",
    "f6e5d4c3b2a1...": "sign_no_parking",
};
```

This makes subsequent runs **instant** (< 5ms) for sign-based questions.

## Floating Panel

A dark-themed HUD appears at the bottom-right corner showing:
- Current question number
- Timer countdown
- Score
- Solver status (Hashing → OCR → AI)
- Matched answer result

The panel uses Shadow DOM for stealth isolation from the page's CSS/JS.

## Anti-Cheat Considerations

- Content script runs in an **isolated world** — invisible to page JS
- Shadow DOM panel is not detectable by page mutation observers
- No DevTools interaction required
- No keyboard/mouse event spoofing — uses native `.click()` on DOM elements
- No tab switching or focus changes
