# Violentmonkey Engine Integration Plan

## Overview

This document analyzes both codebases and provides a plan for integrating Violentmonkey's core user script engine into our extension (Sarathi STALL Solver) without breaking existing functionality.

---

## Part 1: Our Extension Codebase Analysis

### 1.1 Current Architecture (`/workspace/Trash/mcqsolver_v1/`)

**Type:** Manifest V3 (MV3) Chrome Extension  
**Purpose:** Autonomous MCQ solver for Sarathi Parivahan STALL exam  
**Size:** ~5 files + assets

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, service worker, content script on specific sites |
| `background.js` | Service worker — LiteLLM API proxy, message handler |
| `content.js` | Main solver engine — 3-layer pipeline (Hash→OCR→AI) |
| `database.js` | 300 Q&A entries + sign hash dictionary |
| `popup.html` | Popup UI with toggle switches |
| `popup.js` | Popup logic — communicates with content script via storage |
| `assets/` | Tesseract.js OCR engine files |

### 1.2 Key Design Characteristics

1. **MV3 Service Worker** (background.js):
   - Stateless — dies when not in use
   - No DOM access, no `chrome.webRequest` blocking
   - Uses `chrome.runtime.onMessage` for LiteLLM proxy
   - Minimal: only 2 message types (`LITELLM_SOLVE`, `LOG_HASH`, `ABORT_TAB`)

2. **Content Script** (content.js):
   - Runs in **isolated world** on `*://sarathi.parivahan.gov.in/*` and `*://sarathi.nic.in/*`
   - Injects a Shadow DOM panel for HUD
   - Uses `chrome.storage.local` for settings persistence
   - Image hashing, OCR (Tesseract.js), AI fallback pipeline
   - Self-contained 893-line IIFE

3. **Persistence**: Uses `chrome.storage.local` (not IndexedDB)

4. **No existing user script engine** — tightly coupled to specific exam portal

### 1.3 What Must NOT Break

- The 3-layer solver pipeline (Hash→OCR→AI)
- The floating Shadow DOM HUD panel
- Score/wrong tracking and pass/fail guardian
- Popup toggle UI and settings
- Timing gates and auto-refresh logic
- LiteLLM fallback via background service worker

---

## Part 2: Violentmonkey Codebase Analysis

### 2.1 Violentmonkey Architecture (v2.37.0)

**Type:** Manifest V2 (MV2)  
**Repository:** https://github.com/violentmonkey/violentmonkey  
**Build:** Webpack + Babel + Gulp + Vue.js  
**Size:** ~80+ source files

### 2.2 Three-Layer Injection Architecture

```
┌──────────────────────────────────────────────────┐
│                BACKGROUND PAGE                    │
│  (src/background/)                               │
│  - Persistent MV2 background page                │
│  - Script CRUD, storage (IDB), sync              │
│  - Injection preparation (preinject.js)          │
│  - URL matching (tester.js)                      │
│  - Request proxying (requests.js)                │
└──────────────┬───────────────────────────┬───────┘
               │                           │
               ▼                           ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  CONTENT SCRIPT         │   │  WEB/INJECTED SCRIPT    │
│  (injected/content/)    │   │  (injected/web/)        │
│  - Bridge to background │   │  - Runs in PAGE context │
│  - Script injection     │   │  - GM_* API impl        │
│  - Content-realm GM API │   │  - Safe globals wrapper │
│  - CSP bypass           │   │  - Request delegation   │
└─────────────────────────┘   └─────────────────────────┘
          ↕ (postMessage bridge)          ↕
┌──────────────────────────────────────────────────┐
│                WEB PAGE                           │
│  - User script executes here                     │
│  - Has access to GM_* API                        │
│  - Sandboxed via safe-globals.js                 │
└──────────────────────────────────────────────────┘
```

### 2.3 Critical Source Files for Core Engine

#### Script Parsing & Metadata
| File | Purpose | Size |
|------|---------|------|
| `src/common/consts.js` | `METABLOCK_RE` regex, GM API names, constants | 3.5K |
| `src/common/script.js` | Script metadata extraction, name/icon/URL helpers | 3.5K |
| `src/common/string.js` | String utilities, i18n | 3K |

#### URL Matching
| File | Purpose | Size |
|------|---------|------|
| `src/background/utils/tester.js` | `@match`, `@include`, `@exclude` pattern matching | 12.6K |

#### Script Injection Engine
| File | Purpose | Size |
|------|---------|------|
| `src/background/utils/preinject.js` | Injection preparation — prepares scripts for injection | 25.3K |
| `src/injected/content/inject.js` | Content script — injects scripts into page DOM | 14.7K |
| `src/injected/content/index.js` | Content script entry — listens for GetInjected | 4K |
| `src/injected/content/util.js` | DOM utilities for injection | 3.5K |
| `src/injected/content/bridge.js` | postMessage bridge between content and web | 3K |

#### GM API Implementation
| File | Purpose | Size |
|------|---------|------|
| `src/injected/web/gm-api.js` | GM_* API methods (GM_setValue, GM_xmlhttpRequest, etc.) | 8.2K |
| `src/injected/web/gm-global-wrapper.js` | Safe window proxy to sandbox user scripts | 8.9K |
| `src/injected/web/gm-values.js` | Value serialization/deserialization | 3K |
| `src/injected/web/gm-api-wrapper.js` | GM API wrapper with context binding | 3.9K |
| `src/injected/web/requests.js` | GM_xmlhttpRequest implementation in page context | 8.9K |
| `src/injected/web/bridge.js` | Web-side bridge for communication | 1.5K |
| `src/injected/web/safe-globals.js` | Safe globals initialization for page context | 8.2K |

#### Storage Layer
| File | Purpose | Size |
|------|---------|------|
| `src/background/utils/db.js` | IndexedDB storage for scripts and values | 29.4K |
| `src/background/utils/storage.js` | Storage abstraction layer | 3.4K |
| `src/common/browser.js` | Chrome/Firefox API abstraction with Proxy | 8.3K |

#### Background Script Infrastructure
| File | Purpose | Size |
|------|---------|------|
| `src/background/utils/index.js` | Background utils entry — exports commands | 150B |
| `src/background/index.js` | Background main — command handler setup | 2.8K |
| `src/common/index.js` | Common module exports, sendCmd, message passing | 5.3K |

### 2.4 How User Scripts Are Parsed

The `METABLOCK_RE` regex in `consts.js`:
```javascript
const METABLOCK_RE = /((?:^|\n)(.*?)\/\/([\x20\t]*)==UserScript==)([\s\S]*?\n)((.*?)\/\/([\x20\t]*)==\/UserScript==)/;
```

This extracts the metadata block between `// ==UserScript==` and `// ==/UserScript==`. Individual directives like `@grant`, `@match`, `@require`, `@resource` are then parsed from the captured group.

### 2.5 How Scripts Are Injected

1. **Background prepares injection data** (`preinject.js`):
   - Queries all scripts matching the URL via `tester.js`
   - Prepares script code with wrappers, requires, metadata
   - Sends `GetInjected` command to content script

2. **Content script receives injection data** (`inject.js`):
   - Creates `<script>` elements with the prepared code
   - Injects into page DOM at correct timing (`document-start`, `document-body`, `document-end`, `document-idle`)
   - Handles CSP restrictions via nonce detection or `FORCE_CONTENT` mode

3. **Web/page script executes** (`gm-api.js`):
   - Receives GM API implementations
   - User script code runs with `GM` object available
   - Global scope is sandboxed via `SafeProxy` in `gm-global-wrapper.js`

### 2.6 GM API Architecture

Violentmonkey implements these GM_* APIs:
- `GM_getValue` / `GM_setValue` / `GM_deleteValue` / `GM_listValues`
- `GM_xmlhttpRequest`
- `GM_notification`
- `GM_openInTab`
- `GM_setClipboard`
- `GM_addStyle` / `GM_addElement`
- `GM_registerMenuCommand`
- `GM_getResourceText` / `GM_getResourceURL`
- `GM_log`
- `GM_info`
- `unsafeWindow`

The API is split across:
- **Web context** (`injected/web/`): User-facing API, communicates via postMessage bridge
- **Content context** (`injected/content/`): Receives API calls, forwards to background
- **Background** (`background/utils/`): Executes privileged operations (storage, requests, tabs)

---

## Part 3: Integration Strategy

### 3.1 Core Design Decision: MV3 Adaptation

Violentmonkey is MV2. Our extension is MV3. Key differences that affect integration:

| Aspect | MV2 (Violentmonkey) | MV3 (Our Extension) |
|--------|---------------------|---------------------|
| Background | Persistent page | Non-persistent service worker |
| WebRequest | Blocking API supported | Only observational (`webRequest` without `blocking`) |
| executeScript | `tabs.executeScript()` | `scripting.executeScript()` (needs `scripting` permission) |
| Content scripts | Injected on all URLs via manifest | Injected on all URLs via manifest `"matches": ["<all_urls>"]` |
| Eval/inline | Allowed | Blocked by default, needs `'unsafe-eval'` in CSP |

**Critical Adaptation Needed:**
- Cannot use `webRequestBlocking` for CSP bypass → Must rely on content script injection only
- Service worker is stateless → Must use `chrome.storage` or IndexedDB from extension context
- Script injection must use `chrome.scripting.executeScript()` or the content script injects `<script>` elements into the page DOM (which **does** work in MV3 content scripts)

### 3.2 Integration Philosophy: Borrow, Don't Port

**DO NOT** port Violentmonkey wholesale. Instead:

1. **Extract the metadata parser** (regex + directive parser) — small, standalone
2. **Extract the URL matcher** (`tester.js`) — standalone utility
3. **Adapt the injection mechanism** — content script creates `<script>` elements (works in MV3 content scripts)
4. **Implement GM_* API subset** — the most commonly used APIs
5. **Use chrome.storage.local** for script/value storage (simpler than IDB, works in service workers)
6. **Content script bridge** — simple `chrome.runtime.sendMessage` for background communication

### 3.3 What We Take From Violentmonkey (Core Engine ONLY)

We want ONLY the core engine — NO UI, NO options page, NO sync, NO editor, NO popup logic.

#### Must Have (Core Engine):
```
common/
├── consts.js        → METABLOCK_RE, GM_API_NAMES, constants
├── script.js        → Metadata parsing helpers
├── util.js          → memoize, debounce, request, dataUri2text
├── string.js        → String utilities

background/utils/
├── tester.js        → URL @match/@include/@exclude pattern matching

injected/web/
├── gm-api.js        → GM_* API implementation
├── gm-values.js     → Value serialization
├── gm-api-wrapper.js → Context binding
├── safe-globals.js  → Security sandbox
├── bridge.js        → Communication bridge

injected/content/
├── inject.js        → Script injection into page DOM
├── bridge.js        → Content-side bridge
├── util.js          → DOM injection utilities
```

#### Should Have (Infrastructure):
```
common/
├── object.js        → deepCopy, deepEqual, mapEntry
├── browser.js       → Chrome API abstraction (simplified for MV3)

background/utils/
├── storage.js       → Storage abstraction (adapt to chrome.storage)
├── values.js        → Value change listeners
```

#### Skip (UI / Not Needed):
- `src/options/` — Options page
- `src/popup/` — Popup (we have our own)
- `src/confirm/` — Install confirmation dialog
- `src/common/ui/` — UI components
- `src/background/sync/` — Cloud sync
- `src/background/utils/cache.js` — Memory cache (simplify)
- `src/background/utils/icon.js` — Badge/icon
- `src/background/utils/notifications.js` — Desktop notifications
- `src/background/utils/page-menu-commands.js` — Context menu
- `src/background/utils/patch-db.js` — DB migrations
- `src/background/utils/clipboard.js` — Clipboard
- `src/background/utils/cookies.js` — Cookie API
- `src/background/utils/update.js` — Script update checking
- `src/background/utils/tabs.js` — Tab management
- `src/background/utils/popup-tracker.js` — Popup state
- `src/background/utils/storage-fetch.js` — Storage-fetch pattern
- `src/background/utils/storage-cache.js` — Storage cache
- `src/background/utils/ua.js` — User agent
- `src/background/utils/url.js` — URL utilities
- `src/background/utils/options.js` — Options

### 3.4 Architecture for New User Script Module

```
Trash/mcqsolver_v1/
├── manifest.json         ← EXTEND with new permissions & content scripts
├── background.js         ← KEEP existing logic, ADD user script commands
├── content.js            ← KEEP existing solver, ADD user script injection
├── database.js           ← KEEP
├── popup.html            ← KEEP, ADD user script management toggle
├── popup.js              ← KEEP, ADD user script messaging
├── assets/               ← KEEP
│
├── userscript/           ← NEW — User script engine module
│   ├── __init__.js       ← Module loader (if using ES modules)
│   ├── parser.js         ← Metadata block parser (adapted from VM common/)
│   ├── matcher.js        ← URL pattern matcher (adapted from VM tester.js)
│   ├── injector.js       ← Script injection into page DOM (adapted from VM inject.js)
│   ├── bridge.js         ← postMessage bridge content↔web
│   ├── storage.js        ← chrome.storage wrapper for scripts/values
│   │
│   ├── gm-api/           ← GM_* API implementations
│   │   ├── index.js      ← GM API registry
│   │   ├── values.js     ← GM_getValue, GM_setValue, etc.
│   │   ├── requests.js   ← GM_xmlhttpRequest
│   │   ├── tabs.js       ← GM_openInTab
│   │   ├── notifications.js ← GM_notification
│   │   └── safe-globals.js  ← unsafeWindow, GM_info
│   │
│   └── lib/              ← Utility libraries
│       ├── object.js     ← deepCopy, etc.
│       ├── util.js       ← Utility functions
│       └── safe-window.js ← Window sandbox proxy
│
├── background/           ← NEW — Background user script handler
│   └── us-script.js      ← Script CRUD + injection dispatch
│   └── us-commands.js    ← Command handlers for GM API
│   └── us-storage.js     ← Script + value storage management
│
└── test/                 ← NEW — Tests
    ├── parser.test.js
    ├── matcher.test.js
    └── ...
```

---

## Part 4: Detailed Implementation Plan

### Phase 1: Foundation — Script Parsing & Storage

**Goal:** Parse user script metadata blocks and store/retrieve scripts.

#### Step 1.1: Create parser.js

Adapted from `common/consts.js` (METABLOCK_RE) + `common/script.js`.

```javascript
// userscript/parser.js

const METABLOCK_RE = /((?:^|\n)(.*?)\/\/([\x20\t]*)==UserScript==)([\s\S]*?\n)((.*?)\/\/([\x20\t]*)==\/UserScript==)/;
const DIRECTIVE_RE = /@(\w+)\s+(.*?)(?:\r?\n|$)/g;

function parseMetaBlock(code) {
  const match = METABLOCK_RE.exec(code);
  if (!match) return null;
  
  const block = match[4];
  const meta = {};
  let m;
  
  while ((m = DIRECTIVE_RE.exec(block))) {
    const key = m[1];
    const value = m[2].trim();
    
    if (['match', 'include', 'exclude', 'exclude-match', 'grant', 'require', 'resource'].includes(key)) {
      meta[key] = meta[key] || [];
      meta[key].push(value);
    } else {
      meta[key] = value;
    }
  }
  
  return { meta, code, metaStr: match[0] };
}
```

**Files affected:** NEW `userscript/parser.js`

#### Step 1.2: Create storage.js

Wrapper around `chrome.storage.local` for scripts and values.

```javascript
// userscript/storage.js

const SCRIPTS_KEY = 'userscripts';
const VALUES_PREFIX = 'us_values_';

async function getAllScripts() {
  const data = await chrome.storage.local.get(SCRIPTS_KEY);
  return data[SCRIPTS_KEY] || [];
}

async function saveScript(script) { ... }
async function deleteScript(id) { ... }
async function getValue(scriptId, key) { ... }
async function setValue(scriptId, key, val) { ... }
```

**Files affected:** NEW `userscript/storage.js`

---

### Phase 2: URL Matching Engine

**Goal:** Determine which scripts to run on the current page.

#### Step 2.1: Create matcher.js

Adapted from `background/utils/tester.js`. This is a self-contained module that tests URLs against `@match`, `@include`, `@exclude` patterns.

```javascript
// userscript/matcher.js

function matchScript(url, script) { ... }
function getMatchingScripts(url, scripts) { ... }
```

Key patterns to support:
- `@match <pattern>` — wildcard/glob matching (like Chrome's match patterns)
- `@include <url>` — URL/glob matching
- `@exclude <url>` — exclusion patterns
- `@exclude-match <pattern>` — match pattern exclusion
- `<all_urls>` — special keyword

**Files affected:** NEW `userscript/matcher.js`

---

### Phase 3: Script Injection Engine

**Goal:** Inject matched user scripts into web pages at the correct timing.

#### Step 3.1: Create injector.js

Adapted from `injected/content/inject.js` and `injected/content/util.js`.

Violentmonkey's injection approach:
1. Content script receives injection data from background
2. Creates `<script>` elements with prepared code
3. Appends to DOM at correct timing point
4. Handles CSP restrictions

Our adaptation:
```javascript
// userscript/injector.js

function injectScript(code, { runAt = 'end', wrap = true } = {}) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.textContent = code;
    
    // Handle CSP: try to add nonce if present
    const nonce = getNonce();
    if (nonce) script.nonce = nonce;
    
    const target = getTargetNode(runAt);
    target.appendChild(script);
    script.remove();
    resolve();
  });
}
```

**Key challenge:** Violentmonkey uses timing-based injection (document-start, -body, -end, -idle). In MV3 content scripts, we can still inject at these points. We use `run_at` in the manifest for the content script itself, then fine-tune user script injection via DOM observation.

**Files affected:** NEW `userscript/injector.js`, NEW `userscript/bridge.js`

---

### Phase 4: GM API Implementation (Subset)

**Goal:** Implement the most commonly used GM_* APIs.

#### Step 4.1: Core API — Value Storage
- `GM_getValue(key, default)` — Read from chrome.storage
- `GM_setValue(key, value)` — Write to chrome.storage
- `GM_deleteValue(key)` — Delete from chrome.storage
- `GM_listValues()` — List all keys
- `GM_addValueChangeListener(key, callback)` — Listen for changes
- `GM_removeValueChangeListener(listenerId)` — Remove listener

#### Step 4.2: Network API
- `GM_xmlhttpRequest(details)` — Proxied through background service worker

#### Step 4.3: Utility API
- `GM_log(message)` — console.log wrapper
- `GM_info` — Script metadata object
- `unsafeWindow` — Raw window object reference

#### Step 4.4: DOM API
- `GM_addStyle(css)` — Inject CSS into page
- `GM_addElement(parent, tag, attrs)` — Add element bypassing CSP

#### Step 4.5: Other API
- `GM_notification(details)` — Chrome notifications
- `GM_openInTab(url)` — Open URL in new tab
- `GM_setClipboard(data, type)` — Copy to clipboard
- `GM_getResourceText(name)` — Get @resource content
- `GM_getResourceURL(name)` — Get @resource as data URL

**Implementation pattern:**
```javascript
// Web context (page) → postMessage → Content context → chrome.runtime.sendMessage → Background → Response
```

**Files affected:** NEW `userscript/gm-api/index.js`, `userscript/gm-api/values.js`, `userscript/gm-api/requests.js`, etc.

---

### Phase 5: Background Service Worker Adaptation

**Goal:** Add user script command handling to our existing service worker.

Extend `background.js` with:
```javascript
// Handle user script commands
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Existing: LITELLM_SOLVE, LOG_HASH, ABORT_TAB
  // NEW:
  if (msg.type === 'US_GET_VALUE') { ... }
  if (msg.type === 'US_SET_VALUE') { ... }
  if (msg.type === 'US_XMLHTTP_REQUEST') { ... }
  if (msg.type === 'US_GET_SCRIPTS') { ... }
  if (msg.type === 'US_SAVE_SCRIPT') { ... }
});
```

**Files affected:** `background.js` (MODIFY)

---

### Phase 6: Content Script Integration

**Goal:** Add user script injection logic to our existing content script.

In `content.js`, add a new module that:
1. Reads stored user scripts from `chrome.storage.local`
2. Matches against current URL using matcher.js
3. Injects matching scripts at correct timing
4. Provides GM API bridge

**Integration point:**
```javascript
// content.js — after existing boot() logic

async function initUserScriptEngine() {
  const scripts = await getAllScripts();
  const matches = getMatchingScripts(location.href, scripts);
  
  for (const script of matches) {
    injectUserScript(script);
  }
}
```

**Files affected:** `content.js` (MODIFY)

---

### Phase 7: Popup UI Extension

**Goal:** Add user script management toggles to our popup (optional/minimal).

**Files affected:** `popup.html`, `popup.js` (MODIFY — add "User Scripts" section)

---

## Part 5: Files Change Summary

### Files to CREATE:

```
userscript/
├── parser.js              (~150 lines)
├── matcher.js             (~400 lines, adapted from VM tester.js)
├── injector.js            (~300 lines, adapted from VM inject.js)
├── bridge.js              (~100 lines, postMessage bridge)
├── storage.js             (~200 lines, chrome.storage wrapper)
├── gm-api/
│   ├── index.js           (~100 lines, API registry)
│   ├── values.js          (~200 lines, GM_getValue etc.)
│   ├── requests.js        (~300 lines, GM_xmlhttpRequest)
│   ├── tabs.js            (~80 lines, GM_openInTab)
│   ├── notifications.js   (~100 lines, GM_notification)
│   ├── safe-globals.js    (~200 lines, unsafeWindow/GM_info)
│   └── add-style.js       (~50 lines, GM_addStyle)
└── lib/
    ├── object.js          (~150 lines, deepCopy etc.)
    ├── util.js            (~200 lines, utilities)
    └── safe-window.js     (~300 lines, window sandbox)
```

### Files to MODIFY:

| File | Change |
|------|--------|
| `manifest.json` | Add `"scripting"` permission, expand host_permissions to `"<all_urls>"`, add `"web_accessible_resources"` for injected scripts |
| `background.js` | Add GM API command handlers, user script storage management |
| `content.js` | Add user script engine initialization alongside existing solver |
| `popup.html` | Add user script toggle/status section |
| `popup.js` | Add user script messaging |

### Files to KEEP UNCHANGED:

- `database.js` — No changes needed
- `assets/` — No changes needed

---

## Part 6: Key Technical Challenges & Solutions

### Challenge 1: MV3 → No Persistent Background
**Solution:** Use `chrome.storage.session` (MV3 feature) for in-memory state that survives service worker restarts. Use `chrome.storage.local` for persistent script/value storage. Script injection decisions are made in the content script, not background.

### Challenge 2: MV3 → No webRequestBlocking for CSP Bypass
**Solution:** Violentmonkey uses CSP nonce detection and forced content mode to handle CSP-restricted pages. In MV3, we rely on:
1. Content script injection always works (isolated world)
2. `<script>` element injection from content script into page DOM works for page-mode scripts
3. For pages with strict CSP, scripts run in content mode (not page mode) — which means `unsafeWindow` and some GM APIs are limited
4. We detect CSP via `meta` tags in the page and fall back accordingly

### Challenge 3: Script Timing (document-start, etc.)
**Solution:** Violentmonkey injects at different timing points. In our content script:
- `document-start`: Run synchronously at top of content script
- `document-body`: Wait for `<body>` to exist
- `document-end`: Wait for DOMContentLoaded
- `document-idle`: Wait for window.onload
We use MutationObserver and DOM readystate checks.

### Challenge 4: postMessage Bridge Security
**Solution:** Use a shared secret (random session ID) passed via injected script to authenticate bridge messages. This prevents page scripts from impersonating the GM bridge.

### Challenge 5: Code Size
Violentmonkey is ~80 files. Our integration should be ~15-20 files. Keep it lean by:
- Only implementing the 10 most-used GM APIs
- Using simple chrome.storage instead of IndexedDB
- No UI for script editor/installer (scripts can be added programmatically or via drag-drop)
- No sync, no update checking, no context menus

---

## Part 7: User Script Engine Feature Scope

### Must Have (Launch)
- [x] Parse `// ==UserScript==` metadata blocks
- [x] Match scripts to URLs (`@match`, `@include`, `@exclude`)
- [x] Inject scripts into page context
- [x] `GM_getValue` / `GM_setValue` / `GM_deleteValue` / `GM_listValues`
- [x] `GM_log`
- [x] `GM_info`
- [x] `unsafeWindow`
- [x] `GM_addStyle`
- [x] `GM_xmlhttpRequest` (proxied through background)

### Should Have (v2)
- [ ] `GM_notification`
- [ ] `GM_openInTab`
- [ ] `GM_setClipboard`
- [ ] `GM_getResourceText` / `GM_getResourceURL`
- [ ] `GM_addValueChangeListener` / `GM_removeValueChangeListener`
- [ ] `@require` support
- [ ] `@resource` support
- [ ] Script enable/disable toggle

### Nice to Have (v3)
- [ ] `GM_registerMenuCommand` / `GM_unregisterMenuCommand`
- [ ] `GM_addElement`
- [ ] `@grant none` optimization
- [ ] Drag-and-drop `.user.js` install
- [ ] Script update checking
- [ ] Script editor (basic)

---

## Part 8: Recommended Implementation Order

### Phase 1 — Foundation (2-3 days)
1. Create `userscript/parser.js` — metadata block parsing
2. Create `userscript/storage.js` — chrome.storage wrapper for scripts
3. Create `userscript/lib/object.js` + `util.js` — utility helpers
4. Update `manifest.json` with new permissions

### Phase 2 — Matching + Injection (2-3 days)
5. Create `userscript/matcher.js` — URL pattern matching
6. Create `userscript/injector.js` — script injection
7. Create `userscript/bridge.js` — postMessage bridge
8. Update `content.js` — integrate user script engine startup

### Phase 3 — GM API: Storage (1-2 days)
9. Create `userscript/gm-api/values.js` — value storage API
10. Create `userscript/gm-api/safe-globals.js` — GM_info, unsafeWindow
11. Update `background.js` — value storage command handlers

### Phase 4 — GM API: Network + DOM (2-3 days)
12. Create `userscript/gm-api/requests.js` — GM_xmlhttpRequest
13. Create `userscript/gm-api/add-style.js` — GM_addStyle
14. Update `background.js` — request proxy

### Phase 5 — Remaining GM APIs (1-2 days)
15. Create `userscript/gm-api/tabs.js` — GM_openInTab
16. Create `userscript/gm-api/notifications.js` — GM_notification
17. Create `userscript/gm-api/index.js` — API registry

### Phase 6 — Polish + Tests (2-3 days)
18. Create `test/parser.test.js`
19. Create `test/matcher.test.js`
20. Create `test/integration.test.js`
21. Update popup with user script status
22. Final verification against existing workflow

---

## Part 9: Risk Assessment

### Risks to Our Existing Workflow

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Content script breaks existing solver | Medium | High | User script engine runs AFTER solver init, separate IIFE |
| Background changes break LiteLLM proxy | Low | High | Keep existing message handlers intact, add new ones alongside |
| CSP restrictions prevent injection | Medium | Medium | Detect CSP and fall back to content-mode execution |
| Performance regression from script scanning | Low | Medium | Cache script matches per page load |
| Memory from injected scripts | Low | Low | Scripts run and are garbage collected |
| Storage conflicts | Low | Low | Use separate key prefixes for user script data |
| manifest.json changes affect permissions | Medium | Medium | Add new permissions carefully, test existing functionality |

### Safety Measures

1. **Feature flag:** User script engine can be toggled on/off independently from solver
2. **Sandboxed storage:** User script values stored under separate keys (`us_*` prefix)
3. **Graceful degradation:** If user script engine fails, solver continues unaffected
4. **Permissions:** Only request additional permissions (`scripting`, `<all_urls>`) if user enables user scripts
5. **Testing:** Each phase includes verification that existing workflow (OCR → AI → solve) still functions

---

## Part 10: Conclusion

The minimum viable integration requires extracting approximately **5 core concepts** from Violentmonkey:
1. **Metadata parser** (~50 lines of regex)
2. **URL matcher** (~400 lines, the most complex part)
3. **Script injector** (~300 lines, DOM manipulation)
4. **GM API bridge** (~100 lines, postMessage pattern)
5. **Value storage** (~200 lines, chrome.storage wrapper)

Total new code: ~15-20 files, ~2,500-3,500 lines.

This provides the capability to run userscripts that Violentmonkey can run, without importing Violentmonkey's UI, options, sync, editor, or build system. The existing MCQ solver pipeline (Hash→OCR→AI) remains completely untouched.
