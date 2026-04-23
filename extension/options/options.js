'use strict';

// ── Tab Navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        item.classList.add('active');
        document.getElementById('tab-' + item.dataset.tab).classList.add('active');
    });
});

function el(id) { return document.getElementById(id); }

function showMsg(msgId, text, isOk = true) {
    const el2 = el(msgId);
    el2.textContent = text;
    el2.className = `msg ${isOk ? 'ok' : 'err'}`;
    el2.style.display = 'block';
    setTimeout(() => { el2.style.display = 'none'; }, 4000);
}

// ── Load all stored settings ─────────────────────────────────────────────────
chrome.storage.local.get(null, data => {
    // Connection
    if (data.apiKey)    el('api-key').value    = data.apiKey;
    if (data.serverUrl) el('server-url').value = data.serverUrl;
    if (data.keyName)   el('key-name').value   = data.keyName;
    if (data.keyExpiry) el('key-expires').value = data.keyExpiry;

    // Profile
    const profile = data.profileData || {};
    const PROFILE_FIELDS = [
        'full_name','first_name','last_name','dob','gender','father_name','mother_name',
        'email','phone','aadhar','pan','dl_number','address','city','state','pincode'
    ];
    PROFILE_FIELDS.forEach(f => {
        const inp = el('p-' + f);
        if (inp && profile[f]) inp.value = profile[f];
    });

    // Services
    el('tog-captcha').checked  = data.captchaEnabled !== false;
    el('tog-exam').checked     = data.solverEnabled  !== false;
    el('tog-autofill').checked = data.autofillEnabled!== false;

    // Exam
    el('tog-refresh').checked    = data.autoRefresh    !== false;
    el('tog-screenshot').checked = data.autoScreenshot !== false;
});

// ── Connection Tab ───────────────────────────────────────────────────────────
el('btn-save-conn').addEventListener('click', () => {
    const apiKey    = el('api-key').value.trim();
    const serverUrl = el('server-url').value.trim().replace(/\/$/, '');
    if (!apiKey) return showMsg('conn-msg', 'API key is required', false);
    if (!serverUrl) return showMsg('conn-msg', 'Server URL is required', false);
    chrome.storage.local.set({ apiKey, serverUrl }, () => {
        testConnection(apiKey, serverUrl);
    });
});

el('btn-test').addEventListener('click', () => {
    const apiKey    = el('api-key').value.trim();
    const serverUrl = el('server-url').value.trim().replace(/\/$/, '');
    testConnection(apiKey, serverUrl);
});

function testConnection(apiKey, serverUrl) {
    showMsg('conn-msg', 'Connecting…', true);
    chrome.runtime.sendMessage({ type: 'VERIFY_KEY' }, resp => {
        if (resp?.ok) {
            el('key-name').value   = resp.data.key_name;
            el('key-expires').value= resp.data.expires_at || 'Never';
            chrome.storage.local.set({ keyName: resp.data.key_name, keyExpiry: resp.data.expires_at || 'Never' });
            showMsg('conn-msg', `✓ Connected as: ${resp.data.key_name}`, true);
        } else {
            showMsg('conn-msg', `✗ ${resp?.error || 'Connection failed'}`, false);
        }
    });
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
el('btn-save-profile').addEventListener('click', () => {
    const PROFILE_FIELDS = [
        'full_name','first_name','last_name','dob','gender','father_name','mother_name',
        'email','phone','aadhar','pan','dl_number','address','city','state','pincode'
    ];
    const profile = {};
    PROFILE_FIELDS.forEach(f => {
        const val = el('p-' + f)?.value?.trim();
        if (val) profile[f] = val;
    });
    chrome.storage.local.set({ profileData: profile }, () => {
        showMsg('profile-msg', `✓ Profile saved (${Object.keys(profile).length} fields)`, true);
    });
});

// ── Services Tab ──────────────────────────────────────────────────────────────
el('tog-captcha').addEventListener('change',  e => chrome.storage.local.set({ captchaEnabled:  e.target.checked }));
el('tog-exam').addEventListener('change',     e => chrome.storage.local.set({ solverEnabled:   e.target.checked }));
el('tog-autofill').addEventListener('change', e => chrome.storage.local.set({ autofillEnabled: e.target.checked }));

// ── Exam Tab ──────────────────────────────────────────────────────────────────
el('btn-save-exam').addEventListener('click', () => {
    chrome.storage.local.set({
        autoRefresh:    el('tog-refresh').checked,
        autoScreenshot: el('tog-screenshot').checked,
    }, () => showMsg('exam-msg', '✓ Exam settings saved', true));
});
