'use strict';

const KEYS = ['captchaEnabled', 'autofillEnabled', 'apiKey', 'serverUrl', 'keyName', 'expiresAt', 'enabledServices', 'theme'];
const SERVER_URL = 'https://tata-ocs.duckdns.org';

function el(id) { return document.getElementById(id); }

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = el(viewId);
    if (target) target.classList.add('active');
    const sub = el('sub-header');
    if (sub) sub.textContent = viewId === 'view-auth' ? 'Setup' : 'Connected';
}

function updateStatusDot(dotId, state) {
    const dot = el(dotId);
    const normalized = state === 'green' ? 'ok' : state === 'red' ? 'err' : state === 'yellow' ? 'warn' : state;
    if (dot) dot.className = `status-dot ${normalized}`;
}

function calculateExpiry(expiryStr) {
    if (!expiryStr) return 'No Expiry';
    try {
        const exp = new Date(expiryStr);
        const diff = exp.getTime() - Date.now();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        if (days <= 0) return 'Expired';
        return `${days} days remaining`;
    } catch (_) {
        return 'Unknown Expiry';
    }
}

function servicesFrom(data) {
    return data && data.enabledServices && typeof data.enabledServices === 'object' && !Array.isArray(data.enabledServices)
        ? data.enabledServices
        : {};
}

function servicesFromAuth(data) {
    const services = data && (data.enabled_services || data.services || data.subscribed_services);
    return services && typeof services === 'object' && !Array.isArray(services) ? services : {};
}

function serviceAllowed(services, name) {
    return services[name] !== false;
}

function stallAllowed(services) {
    return serviceAllowed(services, 'stall');
}

function solverAllowed(services) {
    return serviceAllowed(services, 'solver');
}

function userscriptsAllowed() {
    return true;
}

function applyEntitledToggle(inputId, entitled, enabled, storageKey) {
    const input = el(inputId);
    if (!input) return;
    input.checked = !!entitled && enabled !== false;
    input.disabled = !entitled;
    input.title = entitled ? '' : 'Disabled by admin';
    if (!entitled) chrome.storage.local.set({ [storageKey]: false });
}

function setLoading(btnId, loading) {
    const btn = el(btnId);
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.classList.add('loading');
        btn.dataset.originalText = btn.textContent;
        btn.innerHTML = '<span class="spinner"></span>' + btn.textContent;
    } else {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = btn.dataset.originalText || btn.textContent;
    }
}

function wipeSyncedData() {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ type: 'WIPE_EXTENSION_DATA' }, () => resolve());
        } catch (_) {
            resolve();
        }
    });
}

async function checkServerHealth(serverUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const started = Date.now();
    try {
        const resp = await fetch(`${serverUrl}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        updateStatusDot('user-dot', resp.ok ? (Date.now() - started > 1200 ? 'yellow' : 'green') : 'red');
    } catch (_) {
        clearTimeout(timeout);
        updateStatusDot('user-dot', 'red');
    }
}

async function handleLogin() {
    const key = el('input-key').value.trim();
    const errNode = el('auth-error');
    if (!key) {
        errNode.textContent = 'Please enter an API key.';
        return;
    }
    errNode.textContent = 'Verifying...';
    errNode.style.color = 'var(--warning)';
    setLoading('btn-auth-submit', true);

    chrome.runtime.sendMessage({ type: 'VERIFY_KEY', apiKey: key, serverUrl: SERVER_URL }, async resp => {
        setLoading('btn-auth-submit', false);
        if (chrome.runtime.lastError) {
            errNode.textContent = 'Extension error: ' + chrome.runtime.lastError.message;
            errNode.style.color = 'var(--danger)';
            return;
        }
        if (!resp?.ok) {
            errNode.textContent = resp?.error || 'Verification failed. Check key.';
            errNode.style.color = 'var(--danger)';
            return;
        }

        const services = servicesFromAuth(resp.data);
        await wipeSyncedData();
        await chrome.storage.local.set({
            apiKey: key,
            serverUrl: SERVER_URL,
            isMaster: false,
            keyName: resp.data.key_name || 'Generic Key',
            expiresAt: resp.data.expires_at || null,
            enabledServices: services,
            autofillEnabled: serviceAllowed(services, 'autofill'),
            captchaEnabled: serviceAllowed(services, 'captcha'),
            solverEnabled: solverAllowed(services),
            userscriptsEnabled: userscriptsAllowed(services)
        });
        chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
        initApp();
    });
}

async function handleLogout() {
    await wipeSyncedData();
    showView('view-auth');
}

function setupUserUI(data) {
    const services = servicesFrom(data);
    applyEntitledToggle('user-tog-autofill', serviceAllowed(services, 'autofill'), data.autofillEnabled, 'autofillEnabled');
    applyEntitledToggle('user-tog-captcha', serviceAllowed(services, 'captcha'), data.captchaEnabled, 'captchaEnabled');
    chrome.storage.local.set({
        solverEnabled: solverAllowed(services),
        userscriptsEnabled: userscriptsAllowed(services)
    });
    el('stall-action-section').style.display = stallAllowed(services) ? 'block' : 'none';
    el('user-expiry').textContent = calculateExpiry(data.expiresAt);
    el('user-key-name').textContent = data.keyName || 'Active User';
    const row = el('user-profile-row');
    if (row) row.style.display = 'none';
    updateStatusDot('user-dot', 'warn');
}

async function initApp() {
    const data = await chrome.storage.local.get(KEYS);
    if (data.serverUrl !== SERVER_URL) await chrome.storage.local.set({ serverUrl: SERVER_URL });

    const theme = data.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const themeBtn = el('popup-theme-toggle');
    if (themeBtn) themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';

    updateStatusDot('user-dot', 'warn');
    if (data.apiKey) checkServerHealth(SERVER_URL);

    if (!data.apiKey) {
        showView('view-auth');
        return;
    }

    showView('view-user');
    setupUserUI(data);
}

document.addEventListener('DOMContentLoaded', async () => {
    await initApp();

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') window.close();
    });

    const offlineBanner = document.createElement('div');
    offlineBanner.style.cssText = 'display:none;background:var(--danger);color:#fff;text-align:center;padding:6px;font-size:11px;font-weight:600;';
    offlineBanner.textContent = 'You are offline';
    document.body.prepend(offlineBanner);
    window.addEventListener('offline', () => { offlineBanner.style.display = 'block'; });
    window.addEventListener('online', () => { offlineBanner.style.display = 'none'; });

    const themeBtn = el('popup-theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', async () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
            await chrome.storage.local.set({ theme: next });
        });
    }

    el('btn-auth-submit').addEventListener('click', handleLogin);
    el('btn-logout').addEventListener('click', handleLogout);
    el('user-tog-autofill').addEventListener('change', e => {
        if (!e.target.disabled) chrome.storage.local.set({ autofillEnabled: e.target.checked });
    });
    el('user-tog-captcha').addEventListener('change', e => {
        if (!e.target.disabled) chrome.storage.local.set({ captchaEnabled: e.target.checked });
    });
    el('btn-stall-start').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'START_STALL_AUTOMATION', payload: {} }, resp => {
            if (resp?.ok) window.close();
        });
    });
});
