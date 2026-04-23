'use strict';

const KEYS = ['captchaEnabled', 'solverEnabled', 'autofillEnabled', 'apiKey', 'serverUrl'];

function el(id) { return document.getElementById(id); }

function setStatus(text, state = 'idle') {
    el('status-text').textContent = text;
    const dot = el('conn-dot');
    dot.className = `dot ${state}`;
}

// Load saved settings and apply to toggles
chrome.storage.local.get(KEYS, data => {
    el('tog-captcha').checked = data.captchaEnabled !== false;
    el('tog-exam').checked    = data.solverEnabled  !== false;
    el('tog-autofill').checked= data.autofillEnabled!== false;

    if (data.apiKey) {
        verifyKey();
    } else {
        setStatus('No API key — open Settings', 'err');
    }
});

// Toggle listeners
el('tog-captcha').addEventListener('change', e => {
    chrome.storage.local.set({ captchaEnabled: e.target.checked });
});
el('tog-exam').addEventListener('change', e => {
    chrome.storage.local.set({ solverEnabled: e.target.checked });
});
el('tog-autofill').addEventListener('change', e => {
    chrome.storage.local.set({ autofillEnabled: e.target.checked });
});

// Verify API key
function verifyKey() {
    setStatus('Connecting…', 'idle');
    chrome.runtime.sendMessage({ type: 'VERIFY_KEY' }, resp => {
        if (resp?.ok) {
            setStatus(`Connected — ${resp.data.key_name}`, 'ok');
            el('plan-badge').textContent = 'Active';
        } else {
            setStatus(resp?.error || 'Connection failed', 'err');
        }
    });
}

el('btn-verify').addEventListener('click', verifyKey);

el('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});

el('link-options').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
});

// Load usage stats (local session counters)
chrome.storage.local.get(['statCaptcha', 'statExam', 'statFill'], d => {
    el('u-captcha').textContent = d.statCaptcha || 0;
    el('u-exam').textContent    = d.statExam    || 0;
    el('u-fill').textContent    = d.statFill    || 0;
});
