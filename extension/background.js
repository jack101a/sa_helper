// background.js — Unified Platform Extension
// Lightweight API relay only. No heavy logic.
// All AI/OCR runs on the backend.

'use strict';

const API_BASE = 'https://your-server.com'; // Admin sets this in options

async function getSettings() {
    return new Promise(resolve => {
        chrome.storage.local.get(['apiKey', 'serverUrl'], data => {
            resolve({
                apiKey:    data.apiKey    || '',
                serverUrl: data.serverUrl || API_BASE,
            });
        });
    });
}

async function apiPost(path, body) {
    const { apiKey, serverUrl } = await getSettings();
    if (!apiKey) throw new Error('No API key configured');
    const resp = await fetch(`${serverUrl}${path}`, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key':    apiKey,
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

async function apiGet(path) {
    const { apiKey, serverUrl } = await getSettings();
    if (!apiKey) throw new Error('No API key configured');
    const resp = await fetch(`${serverUrl}${path}`, {
        headers: { 'x-api-key': apiKey },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // ── Text Captcha ─────────────────────────────────────────────────────
    if (msg.type === 'SOLVE_CAPTCHA') {
        apiPost('/v1/solve', {
            type: 'image',
            payload_base64: msg.imageB64,
            domain: msg.domain,
            mode: 'fast',
        })
        .then(data => sendResponse({ ok: true, result: data.result, ms: data.processing_ms }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ── Exam Solver ──────────────────────────────────────────────────────
    if (msg.type === 'SOLVE_EXAM') {
        apiPost('/v1/exam/solve', {
            question_image_b64: msg.questionB64,
            option_images_b64:  msg.optionB64s,
            domain: msg.domain,
        })
        .then(data => sendResponse({ ok: true, data }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ── Autofill: Resolve fields ─────────────────────────────────────────
    if (msg.type === 'AUTOFILL_FILL') {
        apiPost('/v1/autofill/fill', {
            domain:       msg.domain,
            fields:       msg.fields,
            profile_data: msg.profileData,
        })
        .then(data => sendResponse({ ok: true, fills: data.fills }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ── Autofill: Sync routes ─────────────────────────────────────────────
    if (msg.type === 'SYNC_ROUTES') {
        apiGet('/v1/autofill/routes')
        .then(data => {
            chrome.storage.local.set({ fieldRoutes: data });
            sendResponse({ ok: true });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ── Auth verify ───────────────────────────────────────────────────────
    if (msg.type === 'VERIFY_KEY') {
        apiGet('/v1/auth/verify')
        .then(data => sendResponse({ ok: true, data }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ── Screenshot on exam pass ───────────────────────────────────────────
    if (msg.type === 'CAPTURE_SCREENSHOT') {
        const tabId = sender.tab?.id;
        if (!tabId) return false;
        chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 100 }, dataUrl => {
            if (chrome.runtime.lastError || !dataUrl) return;
            const ts       = new Date().toISOString().replace(/[:.]/g, '-').replace('T','_').slice(0,19);
            const filename = `sarathi_result_${ts}.png`;
            chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
        });
        return false;
    }

    // ── Abort tab (redirect top window from iframe) ───────────────────────
    if (msg.type === 'ABORT_TAB') {
        if (sender.tab?.id) {
            chrome.tabs.update(sender.tab.id, { url: 'https://www.google.com' });
        }
        return false;
    }
});
