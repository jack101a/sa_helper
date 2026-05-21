# Violentmonkey Engine Integration Plan v2 — Enhanced Architecture

## Corrected Context

This analysis is based on the **real extension at `/workspace/sa_helper/extension/`** (NOT the deprecated trash version). The extension already has a **working userscript engine** — this plan focuses on **enhancing** it with Violentmonkey's battle-tested patterns.

---

## Part 1: Current Extension Architecture (sa_helper/extension/)

### 1.1 Extension Overview

**Type:** Manifest V3  
**Name:** Unified Platform (v2.2.0)  
**Purpose:** All-in-one browser assistant (Text Captcha, MCQ Exam Solver, Autofill, Stall Automation)

### 1.2 Module Structure

```
extension/
├── manifest.json              ← MV3, <all_urls> host permissions
├── background.js              ← Service worker (1381 lines) — API relay, GM handler, sync
├── content.js                 ← Bootloader (85 lines) — loads modules
├── modules/
│   ├── userscript_engine.js   ← ★ User script engine (341 lines)
│   ├── exam.js                ← MCQ exam solver
│   ├── captcha.js             ← Text captcha solver
│   ├── autofill.js            ← Autofill engine
│   ├── stall_automation.js    ← STALL automation workflow
│   ├── shared_utils.js        ← Shared utilities
│   ├── main_inject.js         ← MAIN world stealth shim (debugger, network intercept)
│   ├── vcam_inject.js         ← MAIN world virtual camera shim
│   ├── vcam_controller.js     ← VCAM controller
│   ├── dialog_boot.js         ← Dialog suppression boot
│   ├── dialog_handler.js      ← Dialog handler
│   ├── sarathi_harden.js      ← Sarathi hardening
│   └── sarathi_panel.js       ← Sarathi panel UI
├── popup/                     ← Extension popup
├── options/                   ← Options page
└── dynamic_steps/             ← Automation step scripts
```

### 1.3 Existing Userscript Engine — How It Works

```
                 ┌─────────────────────────────────────┐
                 │   BACKGROUND SERVICE WORKER          │
                 │   (background.js)                    │
                 │                                     │
                 │  1. Fetches scripts from backend     │
                 │     (/v1/userscripts/sync)           │
                 │  2. parseUserscript() — parses       │
                 │     // ==UserScript== blocks          │
                 │  3. bundleUserscript() — fetches      │
                 │     @require and @resource deps      │
                 │  4. Stores in chrome.storage.local   │
                 │     as "normalized_userscripts"       │
                 │  5. handleGMCall() — processes        │
                 │     GM_getValue/setValue/xmlhttp...  │
                 └──────────────┬──────────────────────┘
                                │
                                ▼
                 ┌─────────────────────────────────────┐
                 │   CONTENT SCRIPT (ISOLATED WORLD)    │
                 │   (modules/userscript_engine.js)     │
                 │                                     │
                 │  1. Loads scripts from storage       │
                 │  2. Matches against current URL      │
                 │  3. Schedules by runAt timing        │
                 │  4. Injects GM shim if needed         │
                 │  5. Sends EXECUTE_IN_MAIN message    │
                 │  6. Relays GM requests via postMessage│
                 └──────────────┬──────────────────────┘
                                │  chrome.runtime.sendMessage
                                │  { type: 'EXECUTE_IN_MAIN', code }
                                ▼
                 ┌─────────────────────────────────────┐
                 │   BACKGROUND → EXECUTE IN MAIN       │
                 │   (chrome.scripting.executeScript)   │
                 │                                     │
                 │   Runs: new Function(code)()         │
                 │   In MAIN world via world: 'MAIN'    │
                 └─────────────────────────────────────┘
                                │
                                ▼
                 ┌─────────────────────────────────────┐
                 │   WEB PAGE (MAIN WORLD)              │
                 │                                     │
                 │  - GM shim provides GM_* API         │
                 │  - GM calls → postMessage → content  │
                 │    script → background → response    │
                 └─────────────────────────────────────┘
```

### 1.4 What Already Works

| Feature | Status | Quality |
|---------|--------|---------|
| `// ==UserScript==` parsing | ✅ | Basic regex |
| `@match` / `@include` / `@exclude` | ✅ | Simple glob-to-regex |
| `@require` dependency fetching | ✅ | Works |
| `@resource` fetching | ✅ | Works |
| `@grant` detection | ✅ | Basic |
| `@noframes` support | ✅ | Basic check |
| `run-at` timing (start/end/idle) | ✅ | Event-based |
| `GM_getValue` / `GM_setValue` | ✅ | Via postMessage bridge |
| `GM_deleteValue` / `GM_listValues` | ✅ | Via postMessage bridge |
| `GM_xmlhttpRequest` | ✅ | Proxied via background fetch |
| `GM_notification` | ✅ | Via chrome.notifications |
| `GM_setClipboard` | ✅ | navigator.clipboard |
| `GM_addStyle` | ✅ | Direct DOM injection |
| `GM_getResourceText/URL` | ✅ | Bundled at install time |
| Script install from backend | ✅ | Auto-synced |
| Script enable/disable | ✅ | Per-script + global toggle |
| `@connect` for GM_xmlhttpRequest | ✅ | Hostname whitelist |

---

## Part 2: Gap Analysis — What Violentmonkey Does Better

### 2.1 Critical Gaps (Security/Reliability)

| Area | Current | Violentmonkey | Risk |
|------|---------|---------------|------|
| **Script injection** | `new Function(code)()` in MAIN world | Creates `<script>` elements in page DOM | Low — both work |
| **GM shim security** | `window.postMessage('*')` — any page can intercept | Secure handshake with vault iframe + session ID | **HIGH** — page scripts can spoof GM responses |
| **Script sandboxing** | None — scripts run in global scope with full page access | `SafeProxy` window wrapper in `gm-global-wrapper.js` | **MEDIUM** — scripts can pollute global scope |
| **URL matching** | Simple regex conversion of glob patterns | Full Chrome match pattern parser in `tester.js` (~12KB) | **MEDIUM** — edge cases with `*.`, TLDs, `*://` |
| **CSP bypass** | None | CSP nonce detection + forced content mode | **MEDIUM** — scripts won't run on strict CSP sites |
| **Error isolation** | Catch-all try/catch per script | Per-script error isolation with sourceURL mapping | Low |

### 2.2 Missing GM APIs

| API | Current | Violentmonkey | Need |
|-----|---------|---------------|------|
| `GM_addValueChangeListener` | ❌ | ✅ | Medium |
| `GM_removeValueChangeListener` | ❌ | ✅ | Medium |
| `GM_registerMenuCommand` | ❌ | ✅ | Low |
| `GM_unregisterMenuCommand` | ❌ | ✅ | Low |
| `GM_openInTab` | ❌ (has SP_OPEN) | ✅ | Medium |
| `GM_addElement` | ❌ | ✅ | Low |
| `GM_info` | ❌ | ✅ | High |
| `unsafeWindow` | ❌ (direct window) | ✅ | Medium |
| `GM_log` | ❌ | ✅ | Low |
| `GM_getValues` / `GM_setValues` | ❌ | ✅ | Low |
| `GM_download` | ❌ | ✅ | Low |
| `GM_cookie` | ❌ | ✅ | Low |

### 2.3 Structural Gaps

| Area | Current | Violentmonkey |
|------|---------|---------------|
| **Code preparation** | Raw script code wrapped in IIFE | Prepared code with metadata, requires, sourceURL, try-catch wrappers (~25KB preinject.js) |
| **Storage** | `chrome.storage.local` for everything | IndexedDB for scripts, separate value storage with change tracking |
| **Metadata parsing** | `parseUserscript()` in background (basic) | `METABLOCK_RE` in common/consts.js with full directive support |
| **Script matching** | On each content script load via storage read | Background pre-caches per-URL script lists |
| **Deduplication** | `__USERSCRIPT_INSTALLED__[id]` flag | Session-based injection tracking |
| **Timing** | Event-based (DOMContentLoaded, load) | Precise injection at document-start, -body, -end, -idle |

---

## Part 3: Enhancement Plan

### Architecture: Keep Existing Structure, Strengthen Components

The existing structure (Background → Content → MAIN world) is sound. We enhance each layer:

```
BEFORE:                          AFTER:
┌─────────────┐                  ┌──────────────────────┐
│ background   │                  │ background            │
│ parseScript  │                  │ parseScript (improved)│
│ handleGMCall │                  │ handleGMCall (extended│
│ basic sync   │                  │   + change listeners) │
└──────┬──────┘                  └──────┬───────────────┘
       │                                │
┌──────▼──────┐                  ┌──────▼───────────────┐
│ content      │                  │ content               │
│ match + exec │                  │ match (improved)      │
│ postMessage  │                  │ inject with CSP      │
│ bridge       │                  │ secure postMessage   │
└──────┬──────┘                  │ bridge with handshake │
       │                         └──────┬───────────────┘
       │                                │
┌──────▼──────┐                  ┌──────▼───────────────┐
│ MAIN world  │                  │ MAIN world            │
│ new Function │                  │ <script> injection   │
│ GM shim only │                  │ GM shim + SafeProxy  │
└─────────────┘                  │ GM_info + unsafeWindow│
                                 └──────────────────────┘
```

### Phase 1: Secure the Injection Pipeline

**Goal:** Replace `new Function()` injection with proper `<script>` element injection, add CSP awareness.

**Files affected:**
- `modules/userscript_engine.js` — injection method
- `background.js` — EXECUTE_IN_MAIN handler (optional simplification)

**Changes:**
1. Content script creates `<script>` elements directly (instead of sending to background for `executeScript`)
2. Add CSP nonce detection from `<meta>` tags
3. Add sourceURL comments for debugging
4. Implement proper document-start injection via direct DOM

**Why this matters:** Violentmonkey injects via `<script>` elements because:
- It runs in the correct document context synchronously
- SourceURL comments work for debugging
- `new Function()` loses the execution context

### Phase 2: Upgrade URL Pattern Matching

**Goal:** Full Chrome match pattern support matching Violentmonkey's `tester.js`.

**Files affected:**
- `modules/userscript_engine.js` — `urlMatchesPattern()` function

**Changes:**
1. Implement proper `MatchTest` class (from Violentmonkey's `tester.js`)
2. Support `<all_urls>`, `*://`, `*.example.com`, `file://`, etc.
3. Implement `@exclude` / `@exclude-match` properly
4. Add TLD matching support
5. Cache compiled patterns

**Violentmonkey reference:** `background/utils/tester.js` (~12KB) — can be adapted as a standalone module.

### Phase 3: Secure the GM Bridge

**Goal:** Prevent page scripts from intercepting GM API calls.

**Files affected:**
- `modules/userscript_engine.js` — GM_REQUEST handler
- `modules/userscript_engine.js` — GM shim (injected into MAIN)

**Current vulnerability:**
```javascript
// Content script listens on window:
window.addEventListener('message', async (e) => {
    if (e.data && e.data.type === 'GM_REQUEST') {
        // ANY page script can send GM_REQUEST!
        chrome.runtime.sendMessage({ type: 'GM_API_CALL', ...e.data });
    }
});
```

**Violentmonkey's solution:** 
1. Use a random session ID as shared secret
2. Handshake protocol via iframe vault
3. Content script sets a non-enumerable property on window that only it knows about

**Our simplified approach:**
1. Generate random session ID per page load
2. Pass it to injected GM shim (not via postMessage, but via `__defineGetter__` or script textContent)
3. Content script checks the session ID in postMessage events
4. Reject messages without valid session ID

### Phase 4: Add Missing GM APIs

**Goal:** Implement the most needed missing GM APIs.

**Files affected:**
- `background.js` — `handleGMCall()` extend
- `modules/userscript_engine.js` — GM shim extend

**Add in order of priority:**

1. **GM_info** (High):
   ```javascript
   GM_info = {
       script: { name, version, description, namespace },
       scriptMetaStr: "...",
       scriptWillUpdate: false,
       uuid: script.id
   }
   ```

2. **unsafeWindow** (Medium):
   - Currently scripts have full window access anyway (running in MAIN)
   - For future sandboxing: pass as a separate variable

3. **GM_addValueChangeListener / GM_removeValueChangeListener** (Medium):
   - Background tracks listeners per script
   - Uses `chrome.storage.onChanged` to detect cross-tab changes
   - Fires callbacks via postMessage to content script

4. **GM_openInTab** (Medium):
   - Already have `SP_OPEN` in background — just wrap it
   ```javascript
   GM_openInTab: (url) => request('openInTab', { url }, scriptId)
   ```

### Phase 5: Enhanced Script Preparation

**Goal:** Properly prepare script code with metadata, better error handling, and resource injection.

**Violentmonkey's `preinject.js` approach:**
1. Separates script code from metadata
2. Prepares require chains with proper concatenation
3. Adds sourceURL for debugging
4. Wraps in try-catch for Firefox
5. Handles @grant none optimization
6. Prepares resource caching

**Our approach:**
1. Keep `bundleUserscript()` in background but enhance it:
   - Add sourceURL generation (already partially done)
   - Add proper error boundaries per script
   - Pre-resolve `@resource` to data URLs at bundle time (already done)
   - Cache resolved `@require` code

### Phase 6: Script Sandboxing (Optional/Advanced)

**Goal:** Prevent user scripts from interfering with each other and the page.

**Violentmonkey's approach** is complex (SafeProxy, window wrapper, ~9KB). For our MV3 extension:

**Simplified sandbox:**
1. Wrap each script in its own IIFE with shadowed globals
2. Provide `unsafeWindow` as the real `window`
3. Override the script's `window`, `document`, `self`, `globalThis` with guarded versions
4. This prevents scripts from leaking variables into the page global scope

---

## Part 4: Detailed File Change Summary

### Files to MODIFY

| File | Phase | Changes |
|------|-------|---------|
| `modules/userscript_engine.js` | 1,2,3,4,6 | Enhance injection, matching, bridge security, add GM APIs, sandbox |
| `background.js` | 4 | Extend `handleGMCall()` with new GM APIs, value change listeners |
| `manifest.json` | — | Likely no changes needed (already has all permissions) |

### Files to CREATE

| File | Phase | Purpose |
|------|-------|---------|
| `modules/userscript/matcher.js` | 2 | Extracted URL matching module from Violentmonkey's `tester.js` |
| `modules/userscript/bridge.js` | 3 | Shared bridge protocol (session ID, message types) |
| `modules/userscript/safe-window.js` | 6 | Simplified window sandbox (if implemented) |

### Files UNCHANGED

All other module files (`exam.js`, `captcha.js`, `autofill.js`, `stall_automation.js`, etc.) — no changes needed.

---

## Part 5: Implementation Order

### Week 1: Security + Core Enhancements

**Day 1-2: Phase 1 — Secure Injection Pipeline**
- Change from `new Function()` to `<script>` element injection
- Add nonce support for CSP
- Add sourceURL for debugging
- Test with various user scripts

**Day 3-4: Phase 2 — URL Matching Upgrade**
- Implement proper match pattern parser
- Support `<all_urls>`, `*://`, TLD patterns
- Add caching for compiled patterns
- Test with edge cases

**Day 5: Phase 3 — Secure GM Bridge**
- Implement session ID handshake
- Validate all postMessage sources
- Test that page scripts cannot spoof GM calls

### Week 2: API Completion + Polish

**Day 1-2: Phase 4 — Missing GM APIs**
- Add GM_info, unsafeWindow
- Add GM_openInTab (wrap existing SP_OPEN)
- Add GM_addValueChangeListener
- GM_log

**Day 3-4: Phase 5 — Enhanced Script Preparation**
- Improve error handling per script
- Better @require code concatenation
- SourceURL generation

**Day 5: Phase 6 — Sandboxing (Optional)**
- Implement simplified window sandbox
- Test script isolation

---

## Part 6: Verification Strategy

For each phase, verify:

1. **Existing functionality still works:**
   - Exam solver still triggers on exam pages
   - Captcha solver still triggers on captcha pages
   - Popup toggle still works
   - Stall automation still functions

2. **User script improvements work:**
   - Scripts from backend still install and run
   - GM_* API calls return correct values
   - `@match` patterns match correctly
   - Scripts run at correct timing

3. **Security:**
   - Page scripts cannot intercept GM calls
   - Error in one script doesn't break others
   - CSP-restricted pages still work

---

## Part 7: Conclusion

The existing userscript engine at `sa_helper/extension/` is **already functional** with basic GM API support, script syncing, and URL matching. What Violentmonkey brings is:

1. **Security** — Secure postMessage bridge (medium effort)
2. **Reliability** — Proper URL matching, CSP handling (medium effort)
3. **Completeness** — Missing GM APIs (low-medium effort)
4. **Sandboxing** — Script isolation (optional, high effort)

**Estimated effort:** ~10 days for core enhancements (Phases 1-5), +2-3 days for sandboxing (Phase 6).

**Key files to borrow from Violentmonkey:**
- `background/utils/tester.js` (~12KB) → URL matching module
- `injected/web/safe-globals.js` (~8KB) → Window sandbox (optional)
- `common/consts.js` (~3.5KB) → Constants, regex patterns

The existing engine structure stays **completely intact** — we're just upgrading components underneath.
