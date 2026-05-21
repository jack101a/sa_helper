'use strict';

// Global error handler
window.onerror = function (msg, src, line, col, err) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--danger);color:#fff;text-align:center;padding:10px;font-size:13px;font-weight:600;position:fixed;top:0;left:0;right:0;z-index:9999;';
    banner.textContent = '⚠ An unexpected error occurred. Please reload the page.';
    document.body.prepend(banner);
    console.error('[Options Error]', msg, src, line, col, err);
};
window.onunhandledrejection = function (ev) {
    console.error('[Options Unhandled Rejection]', ev.reason);
};

// ── Globals & Constants ──────────────────────────────────────────────────────
const PROFILE_FIELDS = [];
const SERVER_URL = 'https://tata-ocs.duckdns.org';

let state = {
    rules: [],
    captchaRoutes: [],
    settings: {},
    theme: 'dark'
};

function el(id) { return document.getElementById(id); }

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

function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

function storageGet(keys) {
    return new Promise(resolve => {
        chrome.storage.local.get(keys, resolve);
    });
}

async function getDeviceId() {
    const data = await storageGet(['deviceId']);
    let deviceId = String(data.deviceId || '').trim();
    if (deviceId) return deviceId;

    deviceId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `dev_${chrome.runtime.id}_${Date.now()}`;
    await chrome.storage.local.set({ deviceId });
    return deviceId;
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

// ── Tab Navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => activateTab(item.dataset.tab));
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activateTab(item.dataset.tab);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = Array.from(document.querySelectorAll('.nav-item'));
            const idx = items.indexOf(item);
            const next = e.key === 'ArrowDown'
                ? items[(idx + 1) % items.length]
                : items[(idx - 1 + items.length) % items.length];
            next.focus();
        }
    });
});

function activateTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    const tabPanel = document.getElementById('tab-' + tabName);
    if (navItem) navItem.classList.add('active');
    if (tabPanel) tabPanel.classList.add('active');
    chrome.storage.local.set({ activeOptionsTab: tabName });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showMsg(msgId, text, isOk = true) {
    const el2 = el(msgId);
    if (!el2) return;
    el2.textContent = text;
    el2.className = `msg ${isOk ? 'ok' : 'err'}`;
    el2.style.display = 'block';
    setTimeout(() => { el2.style.display = 'none'; }, 4000);
}

function firstValue(data, keys, fallback = '-') {
    for (const key of keys) {
        const value = data?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return fallback;
}

function formatAccountExpiry(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function connectionLight(data) {
    if (!data.apiKey) return 'red';
    const age = Date.now() - Number(data.lastVerify || 0);
    if (age >= 0 && age < 2 * 60 * 1000) return 'green';
    if (age >= 0 && age < 15 * 60 * 1000) return 'yellow';
    return 'red';
}

function renderServiceList(data) {
    const services = firstValue(data, ['enabledServices', 'services', 'subscribedServices'], []);
    if (Array.isArray(services)) return services.length ? services.join(', ') : '-';
    if (services && typeof services === 'object') {
        const active = Object.entries(services)
            .filter(([, enabled]) => enabled)
            .map(([name]) => name);
        return active.length ? active.join(', ') : '-';
    }
    return String(services || '-');
}

function entitlementServices(data) {
    const services = firstValue(data, ['enabledServices', 'services', 'subscribedServices'], {});
    return services && typeof services === 'object' && !Array.isArray(services) ? services : {};
}

function applyUserEntitlement(input, entitled, enabled, storageKey) {
    if (!input) return;
    input.checked = !!entitled && enabled !== false;
    input.disabled = !entitled;
    input.title = entitled ? '' : 'Disabled by admin';
    if (!entitled) chrome.storage.local.set({ [storageKey]: false });
}

function renderUserOptions(data) {
    document.body.classList.add('user-mode');
    const view = el('user-options-view');
    if (view) view.hidden = false;

    const setText = (id, value) => {
        const node = el(id);
        if (node) node.textContent = String(value || '-');
    };

    setText('user-info-name', firstValue(data, ['userName', 'name', 'keyName', 'key_name']));
    setText('user-info-plan', firstValue(data, ['planName', 'plan', 'subscriptionPlan', 'subscription_status']));
    setText('user-info-mobile', firstValue(data, ['mobile', 'phone', 'mobileNo', 'phoneNumber']));
    setText('user-info-expiry', formatAccountExpiry(firstValue(data, ['expiresAt', 'expires_at'], '')));
    setText('user-info-telegram', firstValue(data, ['telegramId', 'telegram_id', 'tgId', 'tg_id']));
    const light = el('user-conn-light');
    if (light) light.className = `conn-light ${connectionLight(data)}`;

    const autofill = el('user-opt-autofill');
    const captcha = el('user-opt-captcha');
    const stall = el('user-opt-stall');
    const services = entitlementServices(data);
    if (autofill) {
        applyUserEntitlement(autofill, services.autofill !== false, data.autofillEnabled, 'autofillEnabled');
        autofill.onchange = e => { if (!e.target.disabled) chrome.storage.local.set({ autofillEnabled: e.target.checked }); };
    }
    if (captcha) {
        applyUserEntitlement(captcha, services.captcha !== false, data.captchaEnabled, 'captchaEnabled');
        captcha.onchange = e => { if (!e.target.disabled) chrome.storage.local.set({ captchaEnabled: e.target.checked }); };
    }
    if (stall) {
        applyUserEntitlement(stall, services.stall !== false && services.solver !== false, data.solverEnabled, 'solverEnabled');
        stall.onchange = e => { if (!e.target.disabled) chrome.storage.local.set({ solverEnabled: e.target.checked }); };
    }
}

// ── Initialization ───────────────────────────────────────────────────────────
async function init() {
    const data = await storageGet([
        'apiKey', 'serverUrl', 'isMaster', 'rules', 'autofillSettings',
        'captchaEnabled', 'solverEnabled', 'autofillEnabled', 'autoRefresh',
        'autoScreenshot', 'theme', 'normalized_userscripts', 'userscriptsEnabled',
        'globalFieldRoutes', 'globalLocators', 'domainFieldRoutes', 'activeOptionsTab',
        'keyName', 'expiresAt', 'lastVerify', 'userName', 'name', 'planName',
        'plan', 'subscriptionPlan', 'subscription_status', 'mobile', 'phone',
        'mobileNo', 'phoneNumber', 'telegramId', 'telegram_id', 'tgId', 'tg_id',
        'enabledServices', 'services', 'subscribedServices'
    ]);
    if (data.serverUrl !== SERVER_URL) await chrome.storage.local.set({ serverUrl: SERVER_URL });
    data.serverUrl = SERVER_URL;
    
    state.theme = data.theme || 'dark';
    applyTheme(state.theme);

    if (!data.isMaster && data.apiKey) {
        renderUserOptions(data);
        return;
    }

    // Check Master Access
    if (false && !data.isMaster && data.apiKey) {
        document.body.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 40px; text-align:center;">
                <div style="font-size: 48px; margin-bottom: 20px;">🛡️</div>
                <h1 style="font-size: 24px; font-weight: 800; margin-bottom: 12px;">Master Access Required</h1>
                <p style="color:var(--muted); max-width: 400px; line-height: 1.6; margin-bottom: 30px;">
                    This dashboard is restricted to administrative keys. 
                    Closing in 3 seconds...
                </p>
            </div>
        `;
        setTimeout(() => window.close(), 3000);
        return;
    }

    if (!data.apiKey) {
        document.body.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 40px; text-align:center;">
                <div style="font-size: 48px; margin-bottom: 20px;">🔑</div>
                <h1 style="font-size: 24px; font-weight: 800; margin-bottom: 12px;">Authentication Required</h1>
                <p style="color:var(--muted); max-width: 400px; line-height: 1.6; margin-bottom: 30px;">
                    Please enter your secret key in the extension popup first to access settings.
                </p>
                <button onclick="window.close()" style="background:var(--primary); color:#fff; border:none; padding:12px 24px; border-radius:12px; font-weight:600; cursor:pointer;">Close</button>
            </div>
        `;
        return;
    }

    // Restore last active tab
    if (data.activeOptionsTab) {
        activateTab(data.activeOptionsTab);
    }
    // Connection
    if (data.apiKey)    el('api-key').value    = data.apiKey;
    
    // Rules
    state.rules = data.rules || [];
    renderRules();
    state.captchaRoutes = buildCaptchaRoutes(data);
    renderCaptchaRoutes();
    renderUserscripts(data.normalized_userscripts || []);
    if (el('tog-userscripts-enabled')) {
        el('tog-userscripts-enabled').checked = data.userscriptsEnabled !== false;
    }

    // Services & Settings
    el('tog-captcha').checked  = data.captchaEnabled !== false;
    el('tog-exam').checked     = data.solverEnabled  !== false;
    el('tog-autofill').checked = data.autofillEnabled!== false;
    
    const settings = data.autofillSettings || { skipHidden: true, skipLocked: true, skipPassword: true };
    if (el('set-skip-hidden')) el('set-skip-hidden').checked = settings.skipHidden !== false;
    if (el('set-skip-locked')) el('set-skip-locked').checked = settings.skipLocked !== false;
    if (el('set-skip-password')) el('set-skip-password').checked = settings.skipPassword !== false;

    // Exam
    el('tog-refresh').checked    = data.autoRefresh    !== false;
    el('tog-screenshot').checked = data.autoScreenshot !== false;
    
    if (data.apiKey) {
        verifyKey(data.apiKey, SERVER_URL);
        syncRulesFromServer(data.apiKey, SERVER_URL);
    }

    setupDataPortability();

    // Offline detection
    const offlineBanner = document.createElement('div');
    offlineBanner.style.cssText = 'display:none;background:var(--danger);color:#fff;text-align:center;padding:8px;font-size:12px;font-weight:600;position:fixed;top:0;left:0;right:0;z-index:9999;';
    offlineBanner.textContent = '⚠ You are offline — changes will not sync';
    document.body.prepend(offlineBanner);
    window.addEventListener('offline', () => { offlineBanner.style.display = 'block'; });
    window.addEventListener('online', () => { offlineBanner.style.display = 'none'; });
}

function normalizeDomain(value) {
    let token = String(value || '').trim().toLowerCase();
    if (!token) return '';
    try {
        if (token.includes('://')) token = new URL(token).hostname;
    } catch (_) {}
    token = token.split('/', 1)[0].split(':', 1)[0].replace(/\.$/, '');
    if (token.startsWith('www.')) token = token.slice(4);
    return token;
}

function buildCaptchaRoutes(data) {
    const routes = [];
    const seen = new Set();
    const addRoute = (entry) => {
        const sig = `${entry.domain}|${entry.taskType}|${entry.sourceSelector}|${entry.targetSelector}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        routes.push(entry);
    };

    const globalFieldRoutes = data.globalFieldRoutes || {};
    for (const [domain, entries] of Object.entries(globalFieldRoutes)) {
        for (const r of (entries || [])) {
            const taskType = String(r.task_type || r.source_data_type || '').trim();
            if (taskType !== 'image' && taskType !== 'text') continue;
            addRoute({
                origin: 'server',
                domain: normalizeDomain(domain),
                taskType,
                sourceSelector: String(r.source_selector || ''),
                targetSelector: String(r.target_selector || ''),
                fieldName: String(r.proposed_field_name || `${taskType}_default`)
            });
        }
    }

    const globalLocators = data.globalLocators || {};
    for (const [domain, loc] of Object.entries(globalLocators)) {
        if (!loc) continue;
        addRoute({
            origin: 'server',
            domain: normalizeDomain(domain),
            taskType: 'image',
            sourceSelector: String(loc.img || loc.image_selector || ''),
            targetSelector: String(loc.input || loc.input_selector || ''),
            fieldName: 'image_default'
        });
    }

    const localRoutes = Array.isArray(data.domainFieldRoutes) ? data.domainFieldRoutes : [];
    for (const r of localRoutes) {
        addRoute({
            origin: 'local',
            domain: normalizeDomain(r.domain),
            taskType: String(r.taskType || 'image'),
            sourceSelector: String(r.sourceSelector || ''),
            targetSelector: String(r.targetSelector || ''),
            fieldName: String(r.fieldName || 'image_default')
        });
    }

    return routes;
}

function renderCaptchaRoutes() {
    const table = el('captcha-routes-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    if (!state.captchaRoutes.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted);">No captcha routes found.</td></tr>`;
        return;
    }
    state.captchaRoutes.forEach((r, idx) => {
        const canDelete = r.origin === 'local';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(r.origin)}</td>
            <td>${escapeHtml(r.domain)}</td>
            <td>${escapeHtml(r.taskType)}</td>
            <td style="font-family:monospace;">${escapeHtml(r.sourceSelector)}</td>
            <td style="font-family:monospace;">${escapeHtml(r.targetSelector)}</td>
            <td>
                <button class="btn btn-danger cr-del-btn" data-idx="${idx}" ${canDelete ? '' : 'disabled'} style="padding:4px 8px; width:auto;">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderUserscripts(scripts) {
    const table = el('userscripts-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    if (!Array.isArray(scripts) || scripts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted);">No userscripts synced from backend.</td></tr>`;
        return;
    }

    for (const script of scripts) {
        const meta = script.parsedMeta || {};
        const matches = (meta.matches || []).join(', ');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:700;">${escapeHtml(script.name || 'Unnamed')}</td>
            <td>${escapeHtml(script.version || '0.0.0')}</td>
            <td>${script.enabled ? 'Enabled' : 'Disabled'}</td>
            <td style="max-width:220px; white-space:normal;">${escapeHtml(matches || '—')}</td>
            <td>${escapeHtml(meta.runAt || 'document-idle')}</td>
            <td><textarea readonly style="min-height:90px;">${escapeHtml(script.rawCode || '')}</textarea></td>
        `;
        tbody.appendChild(tr);
    }
}

function setupDataPortability() {
    el('btn-export').onclick = async () => {
        const data = await chrome.storage.local.get(null);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tata_backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        showMsg('port-msg', 'Backup exported successfully!');
    };

    el('btn-import-trigger').onclick = () => el('input-import').click();

    el('input-import').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (confirm('Are you sure? This will overwrite your current settings and local rules.')) {
                    await chrome.storage.local.set(data);
                    showMsg('port-msg', 'Data imported! Reloading...');
                    setTimeout(() => location.reload(), 1500);
                }
            } catch (err) {
                showMsg('port-msg', 'Invalid JSON file.', false);
            }
        };
        reader.readAsText(file);
    };
}

// ── Profile Manager (REMOVED) ───────────────────────────────────────────────

// ── Connection ───────────────────────────────────────────────────────────────
el('btn-save-conn').addEventListener('click', async () => {
    const apiKey = el('api-key').value.trim();
    const serverUrl = SERVER_URL;
    if (!apiKey) {
        setLoading('btn-save-conn', true);
        await wipeSyncedData();
        if (el('key-name')) el('key-name').value = '';
        if (el('key-expires')) el('key-expires').value = '';
        setLoading('btn-save-conn', false);
        showMsg('conn-msg', 'API key removed. Server-synced data wiped.');
        return;
    }
    setLoading('btn-save-conn', true);
    await wipeSyncedData();
    await chrome.storage.local.set({ apiKey, serverUrl });
    await verifyKey(apiKey, serverUrl);
    await syncRulesFromServer(apiKey, serverUrl);
    setLoading('btn-save-conn', false);
});

el('btn-test').addEventListener('click', () => {
    const apiKey = el('api-key').value.trim();
    const serverUrl = SERVER_URL;
    setLoading('btn-test', true);
    verifyKey(apiKey, serverUrl).finally(() => setLoading('btn-test', false));
});

async function verifyKey(apiKey, serverUrl) {
    showMsg('conn-msg', 'Verifying…');
    try {
        const raw = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'VERIFY_KEY', apiKey, serverUrl }, resolve);
        });
        if (!raw) throw new Error('No response from extension background');
        if (raw.ok === false) throw new Error(raw.error || 'Request failed');
        const data = raw.data || raw;
        if (data.valid) {
            el('key-name').value = data.key_name;
            el('key-expires').value = data.expires_at || 'Never';
            showMsg('conn-msg', `✓ Connected as: ${data.key_name}`);
        } else {
            showMsg('conn-msg', '✗ Invalid API Key', false);
        }
    } catch (e) {
        showMsg('conn-msg', '✗ Connection failed: ' + e.message, false);
    }
}

// ── Rules UI & Modal Logic ───────────────────────────────────────────────────
function renderRules() {
    const tbody = el('rules-table').querySelector('tbody');
    tbody.innerHTML = '';
    const search = el('rule-search')?.value.toLowerCase() || '';
    
    let filtered = state.rules.filter(r => {
        const text = (r.site?.pattern || r.site || '') + JSON.stringify(r.steps || {}) + (r.name || '') + (r.elementId || '') + (r.selector || '');
        return text.toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--muted);">No rules found.</td></tr>`;
        return;
    }

    filtered.forEach((r, idx) => {
        const tr = document.createElement('tr');
        
        const site = escapeHtml(r.site?.pattern || r.site || 'Global');
        
        let targetDisplay = '';
        if (r.steps && r.steps.length > 0) {
            const s = r.steps[0].selector || {};
            if (s.name) targetDisplay = `<span style="color:var(--success); font-weight:600;">NAME:</span> ${escapeHtml(s.name)}`;
            else if (s.id) targetDisplay = `<span style="color:var(--primary); font-weight:600;">ID:</span> #${escapeHtml(String(s.id))}`;
            else if (s.css) targetDisplay = `<span style="color:var(--warning); font-weight:600;">CSS:</span> ${escapeHtml(s.css)}`;
        } else {
            if (r.name) targetDisplay = `<span style="color:var(--success); font-weight:600;">NAME:</span> ${escapeHtml(r.name)}`;
            else if (r.elementId) targetDisplay = `<span style="color:var(--primary); font-weight:600;">ID:</span> #${escapeHtml(String(r.elementId))}`;
            else if (r.selector) targetDisplay = `<span style="color:var(--warning); font-weight:600;">CSS:</span> ${escapeHtml(r.selector)}`;
        }

        let actionDisplay = '';
        const action = r.steps?.[0]?.action || r.action;
        const value = r.steps?.[0]?.value || r.value;
        
        if (action === 'click') actionDisplay = '<span style="color:var(--primary)">🖱️ Click</span>';
        else if (action === 'checkbox') actionDisplay = value ? '☑ Checked' : '☐ Unchecked';
        else actionDisplay = escapeHtml(String(value || ''));

        tr.innerHTML = `
            <td><input type="checkbox" class="rule-sel" data-id="${idx}"></td>
            <td style="font-size:12px; color:var(--muted);">${site}</td>
            <td style="font-family:monospace; font-size:12px;">${targetDisplay}</td>
            <td><b>${actionDisplay}</b></td>
            <td style="text-align:right">
                <button class="btn btn-outline btn-edit" data-idx="${idx}" style="padding:4px 8px; width:auto; display:inline-block;">✏️</button>
                <button class="btn btn-danger btn-delete" data-idx="${idx}" style="padding:4px 8px; width:auto; display:inline-block;">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

el('rule-search')?.addEventListener('input', debounce(renderRules, 250));

// Select All Logic
el('rules-select-all')?.addEventListener('change', e => {
    document.querySelectorAll('.rule-sel').forEach(cb => cb.checked = e.target.checked);
});

// Modal Logic
const ruleModal = el('ruleModal');
function openModal(idx = null) {
    if (idx !== null) {
        const r = state.rules[idx];
        el('editId').value = idx;
        el('editServerRuleId').value = r.server_rule_id || '';
        el('editSite').value = r.site?.pattern || r.site || '';
        
        const target = r.steps?.[0]?.selector || r;
        el('editName').value = target.name || '';
        el('editElementId').value = target.id || target.elementId || '';
        el('editSelector').value = target.css || target.selector || '';
        
        el('editAction').value = r.steps?.[0]?.action || r.action || 'text';
        el('editValue').value = r.steps?.[0]?.value || r.value || '';
    } else {
        el('editId').value = '';
        el('editServerRuleId').value = '';
        el('editSite').value = '';
        el('editName').value = '';
        el('editElementId').value = '';
        el('editSelector').value = '';
        el('editAction').value = 'text';
        el('editValue').value = '';
    }
    ruleModal.style.display = 'flex';
    setTimeout(() => el('editSite')?.focus(), 50);
}

el('cancelModal')?.addEventListener('click', () => ruleModal.style.display = 'none');

el('saveModal')?.addEventListener('click', async () => {
    const idx = el('editId').value;
    const site = el('editSite').value.trim();
    const name = el('editName').value.trim();
    const elementId = el('editElementId').value.trim();
    const selector = el('editSelector').value.trim();
    
    if (!site || (!name && !elementId && !selector)) {
        alert("Site and at least one Target (Name, ID, or Selector) are required");
        return;
    }

    let strategy = 'css';
    if (elementId) strategy = 'id';
    else if (name) strategy = 'name';

    const newRule = {
        server_rule_id: el('editServerRuleId').value || null,
        site: { match_mode: 'domainPath', pattern: site },
        steps: [{
            order: 1,
            action: el('editAction').value,
            selector: { strategy, name, id: elementId, css: selector },
            value: el('editValue').value
        }],
        timestamp: Date.now()
    };

    if (idx !== '') {
        state.rules[parseInt(idx)] = newRule;
    } else {
        state.rules.push(newRule);
    }

    await chrome.storage.local.set({ rules: state.rules });
    renderRules();
    ruleModal.style.display = 'none';
    showMsg('rules-msg', '✓ Rule saved locally.');
});

el('rules-table')?.addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const idx = target.getAttribute('data-idx');
    
    if (target.classList.contains('btn-edit')) {
        openModal(idx);
    } else if (target.classList.contains('btn-delete')) {
        if (confirm("Delete this rule?")) {
            state.rules.splice(idx, 1);
            await chrome.storage.local.set({ rules: state.rules });
            renderRules();
        }
    }
});

el('rules-add-btn')?.addEventListener('click', () => openModal(null));

el('rules-delete-all-btn')?.addEventListener('click', async () => {
    if (confirm("Delete ALL rules?")) {
        state.rules = [];
        await chrome.storage.local.set({ rules: [] });
        renderRules();
        showMsg('rules-msg', '✓ All rules deleted.');
    }
});

// ── Server Sync ──────────────────────────────────────────────────────────────
async function syncRulesFromServer(apiKey, serverUrl) {
    if (!apiKey || !serverUrl) return;
    try {
        const resp = await fetch(`${serverUrl}/v1/autofill/sync`, {
            headers: { 'X-API-Key': apiKey, 'X-Device-ID': await getDeviceId() }
        });
        const data = await resp.json();
        if (data.rules) {
            // Merge rules: replace existing server rules with new ones
            const localRules = state.rules.filter(r => !r.server_rule_id);
            state.rules = [...localRules, ...data.rules];
            await chrome.storage.local.set({ rules: state.rules });
            renderRules();
            showMsg('rules-msg', `✓ Auto-synced ${data.rules.length} rules.`);
        }
    } catch (e) {
        console.error('Auto-sync failed:', e);
    }
}

el('rules-sync-btn').addEventListener('click', async () => {
    const { apiKey } = await storageGet(['apiKey']);
    const serverUrl = SERVER_URL;
    if (!apiKey) return showMsg('rules-msg', 'Set API credentials first', false);

    showMsg('rules-msg', 'Syncing…');
    setLoading('rules-sync-btn', true);
    await syncRulesFromServer(apiKey, serverUrl);
    setLoading('rules-sync-btn', false);
});

el('rules-propose-btn').addEventListener('click', async () => {
    const selectedIdx = Array.from(document.querySelectorAll('.rule-sel:checked')).map(cb => cb.dataset.id);
    if (!selectedIdx.length) return alert('Select rules to propose first.');

    const { apiKey } = await storageGet(['apiKey']);
    const serverUrl = SERVER_URL;
    if (!apiKey) return alert('Set API credentials first.');

    showMsg('rules-msg', `Proposing ${selectedIdx.length} rules…`);
    let count = 0;
    for (const idx of selectedIdx) {
        const rule = state.rules[parseInt(idx)];
        if (rule.server_rule_id) continue; // Already on server

        try {
            const resp = await fetch(`${serverUrl}/v1/autofill/proposals`, {
                method: 'POST',
                headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', 'X-Device-ID': await getDeviceId() },
                body: JSON.stringify({
                    idempotency_key: `opt_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
                    submitted_at: new Date().toISOString(),
                    client: {
                        extension_version: chrome.runtime.getManifest().version,
                        schema_version: 26,
                        device_id: 'options_page',
                        browser: 'chrome',
                        os: navigator.platform
                    },
                    rule
                })
            });
            if (resp.ok) count++;
            else {
                const err = await resp.json().catch(() => ({}));
                console.error('[Propose] Failed:', err);
            }
        } catch (e) {
            console.error('[Propose] Error:', e);
        }
    }
    showMsg('rules-msg', `✓ Proposed ${count} rules for review.`);
});

// ── Captcha Routes (Options Tab) ─────────────────────────────────────────────
async function refreshCaptchaRoutesFromStorage() {
    const data = await storageGet(['globalFieldRoutes', 'globalLocators', 'domainFieldRoutes']);
    state.captchaRoutes = buildCaptchaRoutes(data);
    renderCaptchaRoutes();
}

el('cr-sync-btn')?.addEventListener('click', async () => {
    showMsg('captcha-routes-msg', 'Syncing captcha routes…');
    const syncResp = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, resolve));
    if (!syncResp || syncResp.ok === false) {
        showMsg('captcha-routes-msg', `Sync failed: ${syncResp?.error || 'Unknown error'}`, false);
        return;
    }
    await refreshCaptchaRoutesFromStorage();
    showMsg('captcha-routes-msg', 'Captcha routes synced and refreshed.');
});

el('captcha-routes-table')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.cr-del-btn');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const item = state.captchaRoutes[idx];
    if (!item || item.origin !== 'local') return;
    if (!confirm(`Remove captcha route for ${item.domain}?`)) return;

    const data = await storageGet(['domainFieldRoutes']);
    const routes = Array.isArray(data.domainFieldRoutes) ? data.domainFieldRoutes : [];
    const next = routes.filter(r =>
        !(normalizeDomain(r.domain) === item.domain &&
          String(r.taskType || '') === item.taskType &&
          String(r.sourceSelector || '') === item.sourceSelector &&
          String(r.targetSelector || '') === item.targetSelector)
    );
    await chrome.storage.local.set({ domainFieldRoutes: next });
    await refreshCaptchaRoutesFromStorage();
    showMsg('captcha-routes-msg', 'Local captcha route removed.');
});

function startLocate(targetField) {
    showMsg('captcha-routes-msg', 'Picker started on active tab…');
    chrome.storage.local.set({ _popupPendingField: targetField }, () => {
        chrome.runtime.sendMessage({ type: 'START_LOCATE', targetField }, (resp) => {
            if (!resp || !resp.ok) {
                showMsg('captcha-routes-msg', resp?.error || 'Failed to start picker.', false);
            }
        });
    });
}

el('cr-pick-source')?.addEventListener('click', () => startLocate('source'));
el('cr-pick-target')?.addEventListener('click', () => startLocate('target'));

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'LOCATOR_PICKED_UI') {
        if (msg.targetField === 'source') {
            if (el('cr-source-selector')) el('cr-source-selector').value = msg.selector || '';
        } else {
            if (el('cr-target-selector')) el('cr-target-selector').value = msg.selector || '';
        }
        showMsg('captcha-routes-msg', 'Selector captured.');
    }
});

el('cr-save-btn')?.addEventListener('click', async () => {
    const domain = normalizeDomain(el('cr-domain')?.value || '');
    const taskType = String(el('cr-task-type')?.value || 'image');
    const sourceSelector = String(el('cr-source-selector')?.value || '').trim();
    const targetSelector = String(el('cr-target-selector')?.value || '').trim();

    if (!domain || !sourceSelector || !targetSelector) {
        showMsg('captcha-routes-msg', 'Domain, source selector and target selector are required.', false);
        return;
    }

    const payload = {
        domain,
        task_type: taskType,
        source_data_type: taskType,
        source_selector: sourceSelector,
        target_data_type: 'text_input',
        target_selector: targetSelector,
        proposed_field_name: `${taskType}_default`
    };

    showMsg('captcha-routes-msg', 'Saving captcha route…');
    setLoading('cr-save-btn', true);
    const resp = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'PROPOSE_FIELD_MAPPING', payload }, resolve));
    setLoading('cr-save-btn', false);
    if (resp && resp.ok) {
        if (taskType === 'image') {
            chrome.runtime.sendMessage({ type: 'PROPOSE_LOCATOR', domain, img: sourceSelector, input: targetSelector }, () => {});
        }
        await new Promise(resolve => chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, resolve));
        await refreshCaptchaRoutesFromStorage();
        showMsg('captcha-routes-msg', `Saved route for ${domain}.`);
        return;
    }

    // Local fallback when server proposal fails
    const data = await storageGet(['domainFieldRoutes']);
    const routes = Array.isArray(data.domainFieldRoutes) ? data.domainFieldRoutes : [];
    routes.push({ domain, taskType, sourceSelector, targetSelector, fieldName: `${taskType}_default` });
    await chrome.storage.local.set({ domainFieldRoutes: routes });
    await refreshCaptchaRoutesFromStorage();
    showMsg('captcha-routes-msg', `Server save failed (${resp?.error || 'unknown'}). Stored locally.`, false);
});

// ── Service Toggles ──────────────────────────────────────────────────────────
el('tog-captcha').addEventListener('change',  e => chrome.storage.local.set({ captchaEnabled:  e.target.checked }));
el('tog-exam').addEventListener('change',     e => chrome.storage.local.set({ solverEnabled:   e.target.checked }));
el('tog-autofill').addEventListener('change', e => chrome.storage.local.set({ autofillEnabled: e.target.checked }));

function saveSettings() {
    const settings = {
        skipHidden: el('set-skip-hidden')?.checked,
        skipLocked: el('set-skip-locked')?.checked,
        skipPassword: el('set-skip-password')?.checked
    };
    chrome.storage.local.set({ autofillSettings: settings });
}

if (el('set-skip-hidden')) el('set-skip-hidden').addEventListener('change', saveSettings);
if (el('set-skip-locked')) el('set-skip-locked').addEventListener('change', saveSettings);
if (el('set-skip-password')) el('set-skip-password').addEventListener('change', saveSettings);

if (el('tog-userscripts-enabled')) {
    el('tog-userscripts-enabled').addEventListener('change', e => {
        chrome.storage.local.set({ userscriptsEnabled: e.target.checked }, () => {
            showMsg('userscripts-msg', `Userscripts ${e.target.checked ? 'enabled' : 'disabled'} globally.`);
        });
    });
}

if (el('userscripts-sync-btn')) {
    el('userscripts-sync-btn').addEventListener('click', () => {
        showMsg('userscripts-msg', 'Syncing userscripts…');
        setLoading('userscripts-sync-btn', true);
        chrome.runtime.sendMessage({ type: 'USERSCRIPTS_SYNC' }, async (resp) => {
            setLoading('userscripts-sync-btn', false);
            if (!resp || resp.ok === false) {
                showMsg('userscripts-msg', `Sync failed: ${resp?.error || 'Unknown error'}`, false);
                return;
            }
            await chrome.storage.local.set({
                normalized_userscripts: resp.userscripts || [],
                userscriptsEnabled: resp.userscriptsEnabled !== false
            });
            renderUserscripts(resp.userscripts || []);
            showMsg('userscripts-msg', `Synced ${resp.synced || 0} userscripts from backend.`);
        });
    });
}

// ── Exam Tab ──────────────────────────────────────────────────────────────────
el('btn-save-exam').addEventListener('click', () => {
    setLoading('btn-save-exam', true);
    chrome.storage.local.set({
        autoRefresh:    el('tog-refresh').checked,
        autoScreenshot: el('tog-screenshot').checked,
    }, () => {
        setLoading('btn-save-exam', false);
        showMsg('exam-msg', '✓ Exam settings saved');
    });
});

// ── Theme Management ─────────────────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = el('themeToggleBtn');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}

el('themeToggleBtn').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(state.theme);
    chrome.storage.local.set({ theme: state.theme });
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
init();
