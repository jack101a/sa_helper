'use strict';

// Global error handler
window.onerror = function (msg, src, line, col, err) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--danger);color:#fff;text-align:center;padding:8px;font-size:11px;font-weight:600;';
    banner.textContent = 'An unexpected error occurred. Please reload the popup.';
    document.body.prepend(banner);
    console.error('[Popup Error]', msg, src, line, col, err);
};
window.onunhandledrejection = function (ev) {
    console.error('[Popup Unhandled Rejection]', ev.reason);
};

const KEYS = ['captchaEnabled', 'solverEnabled', 'autofillEnabled', 'userscriptsEnabled', 'apiKey', 'serverUrl', 'isMaster', 'keyName', 'expiresAt', 'enabledServices', 'profiles', 'activeProfileId', 'isRecording', 'theme'];
const SERVER_URL = 'https://tata-ocs.duckdns.org';

function el(id) { return document.getElementById(id); }
function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

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

// --- View Management ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = el(viewId);
    if (target) target.classList.add('active');
    
    // Update header subtitle
    const sub = el('sub-header');
    if (viewId === 'view-auth') sub.textContent = 'Setup Required';
    else if (viewId === 'view-user') sub.textContent = 'User Mode';
    else if (viewId === 'view-master') sub.textContent = 'Master Control';
}

// --- Status & UI Helpers ---
function updateStatusDot(dotId, state) {
    const dot = el(dotId);
    const normalized = state === 'green' ? 'ok' : state === 'red' ? 'err' : state === 'yellow' ? 'warn' : state;
    if (dot) dot.className = `status-dot ${normalized}`;
}

function calculateExpiry(expiryStr) {
    if (!expiryStr) return 'No Expiry';
    try {
        const exp = new Date(expiryStr);
        const now = new Date();
        const diff = exp.getTime() - now.getTime();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        if (days <= 0) return 'Expired';
        return `${days} days remaining`;
    } catch (_) {
        return 'Unknown Expiry';
    }
}

async function checkServerHealth(serverUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const started = Date.now();
    try {
        const resp = await fetch(`${serverUrl}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
            const state = Date.now() - started > 1200 ? 'yellow' : 'green';
            updateStatusDot('user-dot', state);
            updateStatusDot('master-dot', state);
        } else {
            updateStatusDot('user-dot', 'red');
            updateStatusDot('master-dot', 'red');
        }
    } catch (_) {
        clearTimeout(timeout);
        updateStatusDot('user-dot', 'red');
        updateStatusDot('master-dot', 'red');
    }
}

// --- Auth Logic ---
async function handleLogin() {
    const key = el('input-key').value.trim();
    const url = SERVER_URL;
    const errNode = el('auth-error');
    
    if (!key) {
        errNode.textContent = 'Please enter an API key.';
        return;
    }
    errNode.textContent = 'Verifying...';
    errNode.style.color = 'var(--warning)';
    setLoading('btn-auth-submit', true);
    
    const timeout = setTimeout(() => {
        errNode.textContent = 'Request timed out. Is the server running?';
        errNode.style.color = 'var(--danger)';
    }, 10000);

    try {
        chrome.runtime.sendMessage({ type: 'VERIFY_KEY', apiKey: key, serverUrl: url }, async (resp) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
                setLoading('btn-auth-submit', false);
                errNode.textContent = 'Extension error: ' + chrome.runtime.lastError.message;
                errNode.style.color = 'var(--danger)';
                return;
            }
            if (resp?.ok) {
                setLoading('btn-auth-submit', false);
                await wipeSyncedData();
                await chrome.storage.local.set({ 
                    apiKey: key, 
                    serverUrl: url,
                    isMaster: !!resp.data.is_master,
                    keyName: resp.data.key_name || 'Generic Key',
                    expiresAt: resp.data.expires_at || null
                }, () => {
                    chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
                });
                initApp();
            } else {
                setLoading('btn-auth-submit', false);
                errNode.textContent = resp?.error || 'Verification failed. Check key.';
                errNode.style.color = 'var(--danger)';
            }
        });
    } catch (e) {
        clearTimeout(timeout);
        setLoading('btn-auth-submit', false);
        errNode.textContent = 'Connection error: ' + e.message;
        errNode.style.color = 'var(--danger)';
    }
}

function servicesFrom(data) {
    return (data && data.enabledServices && typeof data.enabledServices === 'object' && !Array.isArray(data.enabledServices))
        ? data.enabledServices
        : {};
}

function applyEntitledToggle(inputId, entitled, enabled, storageKey) {
    const input = el(inputId);
    if (!input) return;
    input.checked = !!entitled && enabled !== false;
    input.disabled = !entitled;
    input.title = entitled ? '' : 'Disabled by admin';
    if (!entitled) chrome.storage.local.set({ [storageKey]: false });
}

async function handleLogout() {
    await wipeSyncedData();
    showView('view-auth');
}

// --- Main Init ---
async function initApp() {
    const data = await chrome.storage.local.get(KEYS);
    if (data.serverUrl !== SERVER_URL) await chrome.storage.local.set({ serverUrl: SERVER_URL });
    data.serverUrl = SERVER_URL;
    
    // Apply saved theme
    const theme = data.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const themeBtn = el('popup-theme-toggle');
    if (themeBtn) themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
    
    // Connection health check
    if (data.apiKey) {
        checkServerHealth(SERVER_URL);
    }
    
    if (!data.apiKey) {
        showView('view-auth');
        return;
    }

    if (data.isMaster) {
        showView('view-master');
        el('master-tag').style.display = 'block';
        el('btn-dashboard').style.display = 'flex';
        setupMasterUI(data);
        initProfiles('master', data);
    } else {
        showView('view-user');
        el('master-tag').style.display = 'none';
        el('btn-dashboard').style.display = 'none';
        setupUserUI(data);
        initProfiles('user', data);
    }
}

// --- Profile Management ---
async function initProfiles(prefix, data) {
    const profiles = data.profiles || [{ id: 'default', name: 'Default Profile' }];
    const activeId = data.activeProfileId || 'default';
    const select = el(`${prefix}-profile-select`);
    const addBtn = el(`${prefix}-btn-add-profile`);

    if (!select || !addBtn) return;

    // Hide profile row for regular users (requested feature)
    if (prefix === 'user') {
        const row = el('user-profile-row');
        if (row) row.style.display = 'none';
    }

    // Render options
    select.innerHTML = profiles.map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)}</option>`).join('');
    select.value = activeId;

    // Listeners
    select.onchange = async () => {
        const newId = select.value;
        await chrome.storage.local.set({ activeProfileId: newId });
        console.log(`[Popup] Profile switched to: ${newId}`);
    };

    addBtn.onclick = async () => {
        const name = prompt('Enter new Profile Name:');
        if (!name) return;
        const id = 'p_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-4);
        
        const currentData = await chrome.storage.local.get(['profiles']);
        const currentProfiles = currentData.profiles || [{ id: 'default', name: 'Default Profile' }];
        
        currentProfiles.push({ id, name });
        await chrome.storage.local.set({ profiles: currentProfiles, activeProfileId: id });
        
        // Refresh UI
        initProfiles(prefix, { profiles: currentProfiles, activeProfileId: id });
    };
}

function setupUserUI(data) {
    const services = servicesFrom(data);
    applyEntitledToggle('user-tog-autofill', services.autofill !== false, data.autofillEnabled, 'autofillEnabled');
    applyEntitledToggle('user-tog-captcha', services.captcha !== false, data.captchaEnabled, 'captchaEnabled');
    applyEntitledToggle('user-tog-exam', services.stall !== false && services.solver !== false, data.solverEnabled, 'solverEnabled');
    chrome.storage.local.set({ userscriptsEnabled: true });
    el('user-expiry').textContent = calculateExpiry(data.expiresAt);
    el('user-key-name').textContent = data.keyName || 'Active User';
    
    // Connectivity check placeholder
    updateStatusDot('user-dot', 'ok');
}

function setupMasterUI(data) {
    el('tog-autofill').checked = data.autofillEnabled !== false;
    el('tog-captcha').checked = data.captchaEnabled !== false;
    el('tog-exam').checked = data.solverEnabled !== false;
    el('tog-userscripts').checked = data.userscriptsEnabled !== false;
    
    updateStatusDot('master-dot', 'ok');
    
    // Load stats
    chrome.storage.local.get(['statCaptcha', 'statExam', 'statFill'], s => {
        el('u-captcha').textContent = s.statCaptcha || 0;
        el('u-exam').textContent = s.statExam || 0;
        el('u-fill').textContent = s.statFill || 0;
    });
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    await initApp();
    
    // Close popup on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.close();
    });
    
    // Offline detection
    const offlineBanner = document.createElement('div');
    offlineBanner.style.cssText = 'display:none;background:var(--danger);color:#fff;text-align:center;padding:6px;font-size:11px;font-weight:600;';
    offlineBanner.textContent = 'You are offline';
    document.body.prepend(offlineBanner);
    window.addEventListener('offline', () => { offlineBanner.style.display = 'block'; });
    window.addEventListener('online', () => { offlineBanner.style.display = 'none'; });
    
    // Theme toggle
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
                

    // Auth
    el('btn-auth-submit').addEventListener('click', handleLogin);
    el('btn-logout').addEventListener('click', handleLogout);
    el('btn-master-logout').addEventListener('click', handleLogout);

    // Toggles - User
    el('user-tog-autofill').addEventListener('change', e => { if (!e.target.disabled) chrome.storage.local.set({ autofillEnabled: e.target.checked }); });
    el('user-tog-captcha').addEventListener('change', e => { if (!e.target.disabled) chrome.storage.local.set({ captchaEnabled: e.target.checked }); });
    el('user-tog-exam').addEventListener('change', e => { if (!e.target.disabled) chrome.storage.local.set({ solverEnabled: e.target.checked }); });
    if (el('user-tog-userscripts')) {
        el('user-tog-userscripts').addEventListener('change', e => { if (!e.target.disabled) chrome.storage.local.set({ userscriptsEnabled: e.target.checked }); });
    }

    // Toggles - Master
    el('tog-autofill').addEventListener('change', e => chrome.storage.local.set({ autofillEnabled: e.target.checked }));
    el('tog-captcha').addEventListener('change', e => chrome.storage.local.set({ captchaEnabled: e.target.checked }));
    el('tog-exam').addEventListener('change', e => chrome.storage.local.set({ solverEnabled: e.target.checked }));
    el('tog-userscripts').addEventListener('change', e => chrome.storage.local.set({ userscriptsEnabled: e.target.checked }));

    // Master Actions
    el('btn-record').addEventListener('click', async () => {
        const s = await chrome.storage.local.get('isRecording');
        const newState = !s.isRecording;
        await chrome.storage.local.set({ isRecording: newState });
        
        const btn = el('btn-record');
        btn.textContent = newState ? 'Stop Recording' : 'Start Rule Recording';
        if (newState) btn.classList.add('recording-pulse');
        else btn.classList.remove('recording-pulse');
    });

    el('btn-sync-routes').addEventListener('click', () => {
        setLoading('btn-sync-routes', true);
        chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, () => {
            setLoading('btn-sync-routes', false);
            const btn = el('btn-sync-routes');
            btn.textContent = 'Sync Complete';
            setTimeout(() => btn.textContent = 'Sync Rules with Cloud', 2000);
        });
    });

    el('btn-dashboard').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    const handleStallStart = async () => {
        chrome.runtime.sendMessage({
            type: 'START_STALL_AUTOMATION',
            payload: {} // Semi-automatic mode: no credentials needed from popup
        }, (resp) => {
            if (resp?.ok) {
                window.close();
            } else {
                alert(resp?.error || 'Failed to start session.');
            }
        });
    };

    el('btn-stall-start').addEventListener('click', handleStallStart);
    const masterStartBtn = el('master-btn-stall-start');
    if (masterStartBtn) masterStartBtn.addEventListener('click', handleStallStart);


    // --- Route Locator Logic ---
    function startLocate(targetField) {
        const status = el('loc-status');
        status.textContent = 'Picker started on tab...';
        status.style.color = 'var(--warning)';
        chrome.storage.local.set({ _popupPendingField: targetField });
        chrome.runtime.sendMessage({ type: 'START_LOCATE', targetField }, (resp) => {
            if (!resp || !resp.ok) {
                status.textContent = resp?.error || 'Failed to start picker.';
                status.style.color = 'var(--danger)';
            } else {
                window.close(); // Close popup so user can pick on the page
            }
        });
    }

    el('btn-loc-img').addEventListener('click', () => startLocate('source'));
    el('btn-loc-input').addEventListener('click', () => startLocate('target'));

    el('btn-save-loc').addEventListener('click', async () => {
        const taskType = el('loc-task-type').value;
        const sourceSelector = el('loc-img').value.trim();
        const targetSelector = el('loc-input').value.trim();
        const status = el('loc-status');

        if (!sourceSelector || !targetSelector) {
            status.textContent = 'Enter source and target selectors.';
            status.style.color = 'var(--danger)';
            return;
        }

        // Get current domain
        let currentDomain = '';
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url && /^https?:/.test(tabs[0].url)) {
            try { currentDomain = new URL(tabs[0].url).hostname.replace(/^www\./, ''); } catch (_) {}
        }

        if (!currentDomain) {
            status.textContent = 'Cannot detect current site domain.';
            status.style.color = 'var(--danger)';
            return;
        }

        status.textContent = 'Saving route...';
        status.style.color = 'var(--warning)';
        setLoading('btn-save-loc', true);

        const fieldName = `${taskType}_default`;
        const payload = {
            domain: currentDomain,
            task_type: taskType,
            source_data_type: taskType,
            source_selector: sourceSelector,
            target_data_type: 'text_input',
            target_selector: targetSelector,
            proposed_field_name: fieldName
        };

        // Validate Selectors
        chrome.runtime.sendMessage({ type: 'VALIDATE_SELECTORS', sourceSelector, targetSelector }, (valResp) => {
            if (!valResp?.ok || !valResp.result?.ok) {
                setLoading('btn-save-loc', false);
                status.textContent = `Invalid selectors: ${valResp?.error || valResp?.result?.error || 'Unknown'}`;
                status.style.color = 'var(--danger)';
                return;
            }
            if (!valResp.result.srcCount || !valResp.result.tgtCount) {
                setLoading('btn-save-loc', false);
                status.textContent = `Selector not found (src:${valResp.result.srcCount}, tgt:${valResp.result.tgtCount})`;
                status.style.color = 'var(--danger)';
                return;
            }

            // Save to server
            chrome.runtime.sendMessage({ type: 'PROPOSE_FIELD_MAPPING', payload }, (resp) => {
if (resp?.ok) {
                    setLoading('btn-save-loc', false);
                    // Also propose as locator if it's an image task (backward compat)
                    if (taskType === 'image') {
                        chrome.runtime.sendMessage({ 
                            type: 'PROPOSE_LOCATOR', 
                            domain: currentDomain, 
                            img: sourceSelector, 
                            input: targetSelector 
                        });
                    }

                    status.textContent = `Route saved for ${currentDomain}!`;
                    status.style.color = 'var(--success)';
                    el('loc-img').value = '';
                    el('loc-input').value = '';
                    chrome.storage.local.remove(['_locatedSource', '_locatedTarget', '_popupPendingField']);
                } else {
                    setLoading('btn-save-loc', false);
                    // Fallback to local
                    chrome.storage.local.get(['domainFieldRoutes'], data => {
                        const routes = Array.isArray(data.domainFieldRoutes) ? data.domainFieldRoutes : [];
                        const next = routes.filter(r => !(r.domain === currentDomain && r.sourceSelector === sourceSelector && r.targetSelector === targetSelector));
                        next.push({ domain: currentDomain, taskType, sourceSelector, targetSelector, fieldName, sourceFieldType: taskType, targetFieldType: 'text_input' });
                        chrome.storage.local.set({ domainFieldRoutes: next }, () => {
                            status.textContent = `Sync failed: ${resp?.error || 'Local save OK'}`;
                            status.style.color = 'var(--warning)';
                        });
                    });
                }
            });
        });
    });
});

// Sync state on startup
chrome.storage.local.get(['isRecording', '_locatedSource', '_locatedTarget'], s => {
    const btn = el('btn-record');
    if (btn) {
        btn.textContent = s.isRecording ? 'Stop Recording' : 'Start Rule Recording';
        if (s.isRecording) btn.classList.add('recording-pulse');
        else btn.classList.remove('recording-pulse');
    }
    
    // Restore picked locators
    if (s._locatedSource) {
        const srcInput = el('loc-img');
        if (srcInput) srcInput.value = s._locatedSource;
    }
    if (s._locatedTarget) {
        const tgtInput = el('loc-input');
        if (tgtInput) tgtInput.value = s._locatedTarget;
    }
});
