// background.js - ta-ta Extension (V2.2)
// Lightweight API relay + auto-sync engine.
// Routes/locators are synced from backend every 5 min automatically — no manual refresh needed.


const gmXhrControllers = new Map();

async function handleGMCall(msg) {
    const { action, key, value, defaultValue, details, requestId, scriptId } = msg;
    const ns = String(scriptId || 'global');
    const storageKey = `userscript_storage:${ns}`;
    
    if (action === 'getValue') {
        const data = await storageGet([storageKey]);
        const store = data[storageKey] || {};
        return { requestId, value: store[key] !== undefined ? store[key] : defaultValue };
    }
    
    if (action === 'setValue') {
        const data = await storageGet([storageKey]);
        const store = data[storageKey] || {};
        store[key] = value;
        await storageSet({ [storageKey]: store });
        return { requestId, ok: true };
    }

    if (action === 'deleteValue') {
        const data = await storageGet([storageKey]);
        const store = data[storageKey] || {};
        delete store[key];
        await storageSet({ [storageKey]: store });
        return { requestId, ok: true };
    }

    if (action === 'listValues') {
        const data = await storageGet([storageKey]);
        return { requestId, values: Object.keys(data[storageKey] || {}) };
    }

    if (action === 'addValueChangeListener' || action === 'removeValueChangeListener') {
        return { requestId, ok: true };
    }
    
    if (action === 'xmlhttpRequest') {
        let xhrId = requestId;
        let timeoutId = null;
        let didTimeout = false;
        try {
            const cleanDetails = details || {};
            const allowed = await isUserscriptConnectAllowed(ns, cleanDetails.url);
            if (!allowed) return { requestId, error: `@connect blocked: ${cleanDetails.url}` };
            xhrId = cleanDetails.xhrId || requestId;
            const controller = new AbortController();
            gmXhrControllers.set(xhrId, controller);
            if (cleanDetails.timeout && Number(cleanDetails.timeout) > 0) {
                timeoutId = setTimeout(() => {
                    didTimeout = true;
                    controller.abort();
                }, Number(cleanDetails.timeout));
            }
            const response = await fetch(cleanDetails.url, {
                method: cleanDetails.method || 'GET',
                headers: cleanDetails.headers || {},
                body: cleanDetails.data || null,
                credentials: cleanDetails.anonymous ? 'omit' : 'include',
                signal: controller.signal,
            });
            const responseType = String(cleanDetails.responseType || 'text').toLowerCase();
            const responseText = responseType === 'arraybuffer' || responseType === 'blob'
                ? ''
                : await response.clone().text();
            let responseBody = responseText;
            if (responseType === 'json') {
                try { responseBody = responseText ? JSON.parse(responseText) : null; } catch (_) { responseBody = null; }
            } else if (responseType === 'arraybuffer') {
                const buf = await response.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buf));
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                responseBody = btoa(binary);
            } else if (responseType === 'blob') {
                const blob = await response.blob();
                const buf = await blob.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buf));
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                responseBody = `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
            }
            if (timeoutId) clearTimeout(timeoutId);
            gmXhrControllers.delete(xhrId);
            return { 
                requestId, 
                response: {
                    readyState: 4,
                    status: response.status,
                    statusText: response.statusText,
                    finalUrl: response.url,
                    responseText,
                    response: responseBody,
                    responseType,
                    responseHeaders: Array.from(response.headers.entries()).map(([k, v]) => `${k}: ${v}`).join('\r\n')
                } 
            };
        } catch (e) {
            if (timeoutId) clearTimeout(timeoutId);
            gmXhrControllers.delete(xhrId);
            return {
                requestId,
                aborted: e?.name === 'AbortError' && !didTimeout,
                timedOut: didTimeout,
                error: didTimeout ? 'timeout' : (e.message || String(e))
            };
        }
    }

    if (action === 'xmlhttpAbort') {
        const xhrId = details?.xhrId || key;
        const controller = gmXhrControllers.get(xhrId);
        if (controller) {
            controller.abort('abort');
            gmXhrControllers.delete(xhrId);
        }
        return { requestId, ok: true };
    }

    if (action === 'notification') {
        const text = typeof details === 'string' ? details : (details?.text || details?.message || '');
        const title = typeof details === 'object' ? (details.title || 'Userscript') : 'Userscript';
        if (chrome.notifications?.create) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title,
                message: text || title,
            });
            return { requestId, ok: true };
        }
        return { requestId, ok: false, error: 'notifications API unavailable' };
    }

    if (action === 'openInTab') {
        const url = typeof details === 'string' ? details : details?.url;
        if (!url) return { requestId, error: 'No URL provided' };
        return new Promise(resolve => {
            chrome.tabs.create({ url, active: details?.active !== false }, tab => {
                if (chrome.runtime.lastError) resolve({ requestId, error: chrome.runtime.lastError.message });
                else resolve({ requestId, ok: true, tabId: tab?.id });
            });
        });
    }

    if (action === 'download') {
        const opts = typeof details === 'string' ? { url: details } : { ...(details || {}) };
        if (!opts.url) return { requestId, error: 'No download URL provided' };
        return new Promise(resolve => {
            chrome.downloads.download({
                url: opts.url,
                filename: opts.name || opts.filename,
                saveAs: !!opts.saveAs
            }, downloadId => {
                if (chrome.runtime.lastError) resolve({ requestId, error: chrome.runtime.lastError.message });
                else resolve({ requestId, ok: true, downloadId });
            });
        });
    }

    if (action === 'registerMenuCommand') {
        const data = await storageGet([`userscript_menu_commands:${ns}`]);
        const menuKey = `userscript_menu_commands:${ns}`;
        const commands = data[menuKey] || {};
        const id = details?.id || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        commands[id] = { id, text: String(details?.text || ''), registeredAt: Date.now() };
        await storageSet({ [menuKey]: commands });
        return { requestId, ok: true, id };
    }

    if (action === 'unregisterMenuCommand') {
        const menuKey = `userscript_menu_commands:${ns}`;
        const data = await storageGet([menuKey]);
        const commands = data[menuKey] || {};
        delete commands[details?.id || details?.key || key];
        await storageSet({ [menuKey]: commands });
        return { requestId, ok: true };
    }

    if (action === 'log') {
        console.log(`[Userscript:${ns}]`, ...(Array.isArray(details?.args) ? details.args : [details]));
        return { requestId, ok: true };
    }
    
    return { requestId, error: 'Unknown GM action' };
}

async function isUserscriptConnectAllowed(scriptId, targetUrl) {
    try {
        const url = new URL(String(targetUrl || ''));
        const data = await storageGet(['normalized_userscripts']);
        const scripts = Array.isArray(data.normalized_userscripts) ? data.normalized_userscripts : [];
        const script = scripts.find(item => String(item.id) === String(scriptId));
        const connects = script?.parsedMeta?.connects || [];
        if (!connects.length) return true;
        return connects.some(pattern => {
            const clean = String(pattern || '').trim().toLowerCase();
            if (!clean) return false;
            if (clean === '*' || clean === '<all_urls>') return true;
            if (clean.startsWith('*.')) return url.hostname.toLowerCase().endsWith(clean.slice(1));
            return url.hostname.toLowerCase() === clean.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
        });
    } catch (_) {
        return false;
    }
}

function parseUserscript(code) {
    const meta = {
        matches: [],
        includes: [],
        exclude: [],
        excludeMatches: [],
        requires: [],
        resources: [],
        grants: [],
        connects: [],
        noframes: false,
        runAt: 'document-idle',
        name: 'Unnamed',
        version: '0.0',
        description: '',
        namespace: '',
        icon: '',
        downloadURL: '',
        updateURL: ''
    };
    const match = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    if (match) {
        const lines = match[1].split('\n');
        for (const line of lines) {
            const m = line.match(/\/\/\s*@([\w-]+)\s*(.*)/);
            if (m) {
                const key = m[1].trim().toLowerCase();
                const val = m[2].trim();
                if (key === 'match') meta.matches.push(val);
                else if (key === 'include') meta.includes.push(val);
                else if (key === 'exclude') meta.exclude.push(val);
                else if (key === 'exclude-match') meta.excludeMatches.push(val);
                else if (key === 'require') meta.requires.push(val);
                else if (key === 'resource') {
                    const parts = val.split(/\s+/, 2);
                    if (parts.length === 2) meta.resources.push({ name: parts[0], url: parts[1] });
                }
                else if (key === 'grant') meta.grants.push(val);
                else if (key === 'connect') meta.connects.push(val);
                else if (key === 'noframes') meta.noframes = true;
                else if (key === 'run-at') meta.runAt = val;
                else if (key === 'name') meta.name = val;
                else if (key === 'namespace') meta.namespace = val;
                else if (key === 'version') meta.version = val;
                else if (key === 'description') meta.description = val;
                else if (key === 'icon') meta.icon = val;
                else if (key === 'downloadurl') meta.downloadURL = val;
                else if (key === 'updateurl') meta.updateURL = val;
            }
        }
    }
    return meta;
}

async function migrateUserscripts() {
    const data = await storageGet(['userscripts', 'normalized_userscripts', 'userscriptsEnabled']);
    if (!data.userscripts || data.normalized_userscripts) return;

    console.log('[Userscript] Migrating legacy scripts...');
    const normalized = data.userscripts.map(script => {
        const parsedMeta = parseUserscript(script.code || '');
        return {
            id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `script_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: parsedMeta.name,
            version: parsedMeta.version,
            enabled: true,
            source: 'backend',
            rawCode: script.code || '',
            parsedMeta,
            installedAt: Date.now(),
            updatedAt: Date.now(),
            lastError: null
        };
    });
    await storageSet({
        normalized_userscripts: normalized,
        userscriptsEnabled: data.userscriptsEnabled !== false
    });
}

'use strict';

const API_BASE = 'https://tata-ocs.duckdns.org';
const SYNC_ALARM = 'auto_sync';
const HEAVY_SYNC_ALARM = 'heavy_auto_sync';
const STALL_KEEPALIVE_ALARM = 'stall_keepalive';
const SYNC_PERIOD_MIN = 5;
const HEAVY_SYNC_PERIOD_MIN = 180;
const HEAVY_SYNC_MIN_INTERVAL_MS = HEAVY_SYNC_PERIOD_MIN * 60 * 1000;
let cachedDeviceId = '';
let pendingDeviceIdPromise = null;
let automationState = {
    active: false,
    tabId: null,
    step: 1
};

const SENSITIVE_STORAGE_KEYS = [
    'apiKey',
    'authState',
    'authError',
    'lastAuthFailure',
    'isMaster',
    'keyName',
    'expiresAt',
    'name',
    'userName',
    'planName',
    'subscriptionPlan',
    'subscription_status',
    'mobile',
    'telegramId',
    'enabledServices',
    'services',
    'subscribedServices',
    'autofillEnabled',
    'captchaEnabled',
    'solverEnabled',
    'userscriptsEnabled',
    'lastVerify',
    'rules',
    'domainFieldRoutes',
    'userscripts',
    'normalized_userscripts',
    'userscript_logs',
    'copyUnlockerConfig',
    'globalFieldRoutes',
    'globalLocators',
    'lastSync',
    'lastHeavySync',
    'stall_user_photo',
    'stallStepScripts',
    '_automationState',
    '_stall_appNo',
    '_stall_captcha',
    '_stall_step4_started_at',
    '_stall_step4_lock_at',
    '_stall_step4_done_at',
    '_stall_flow_done_at',
    '_locatedSource',
    '_locatedTarget',
    '_popupPendingField',
    'suppressDialogs',
    'sp_vcam_image',
    'sp_vcam_enabled',
    'sp_vcam_force_all',
    'stallVcamActive'
];

const AUTH_PRESERVE_KEY_CODES = new Set([
    'expired_subscription',
    'inactive_user',
    'payment_pending',
    'expired_key',
    'device_mismatch'
]);

const AUTH_CLEAR_KEY_CODES = new Set([
    'invalid_key',
    'revoked_key',
    'blocked_user'
]);

const SENSITIVE_STORAGE_PREFIXES = [
    'userscript_require:',
    'userscript_resource:',
    'userscript_storage:',
    'userscript_menu_commands:'
];

// Promise that resolves once automation state is loaded from storage
let _stateResolve;
const _stateReady = new Promise(resolve => { _stateResolve = resolve; });

function _persistAutomationState() {
    chrome.storage.local.set({ _automationState: automationState });
}

function _setStallKeepAlive(active) {
    if (active) {
        chrome.alarms.create(STALL_KEEPALIVE_ALARM, { periodInMinutes: 1 });
    } else {
        chrome.alarms.clear(STALL_KEEPALIVE_ALARM);
    }
}

function _injectStallKeepAlive(tabId) {
    if (!tabId) return;
    chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: () => {
            if (window.__STALL_KEEPALIVE_INSTALLED__) return;
            window.__STALL_KEEPALIVE_INSTALLED__ = true;
            try {
                Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
                Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
                Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
                Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
            } catch (_) {}
            window.__stall_keepalive_tick = window.__stall_keepalive_tick || setInterval(() => {
                void document.visibilityState;
            }, 30000);
            try {
                navigator.wakeLock?.request?.('screen').then(lock => {
                    window.__stall_wake_lock = lock;
                }).catch(() => {});
            } catch (_) {}
        }
    }, () => {
        void chrome.runtime.lastError;
    });
}

function _stallKeepAliveTick() {
    if (!automationState.active || !automationState.tabId) return;
    chrome.tabs.get(automationState.tabId, tab => {
        if (chrome.runtime.lastError || !tab) return;
        _injectStallKeepAlive(automationState.tabId);
        chrome.tabs.sendMessage(automationState.tabId, { type: 'STALL_KEEPALIVE_TICK' }, () => {
            void chrome.runtime.lastError;
        });
    });
}

// Throttle to avoid redirect loops (per tab)
const lastRedirectAt = new Map(); // tabId -> ms
function shouldRedirect(tabId, windowMs = 10000) {
  const now = Date.now();
  const last = lastRedirectAt.get(tabId) || 0;
  if (now - last < windowMs) return false;
  lastRedirectAt.set(tabId, now);
  return true;
}

const AUTH_FROM_URL = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugyna";
const AUTH_TO_URL   = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugnya";
const AUTH_BASE_URL = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do";

// Detect Chrome/Edge error-like pages
function isErrorLikeUrl(url) {
  if (!url) return true;
  url = String(url);
  return (
    url.startsWith('chrome-error://') ||
    url.startsWith('chrome://') ||
    url.startsWith('edge-error://') ||
    url.startsWith('about:blank#blocked') ||
    url.startsWith('about:neterror')
  );
}

// Stabilize after loads + inject anti-403 hooks
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab || !tab.url) return;

  const url = tab.url;
  if (isErrorLikeUrl(url)) return;
  if (automationState.active && automationState.tabId === tabId) {
    _injectStallKeepAlive(tabId);
  }
  if (!url.includes('sarathi.parivahan.gov.in/sarathiservice')) return;

  // If /403.jsp somehow loads, immediately jump to stable URL (extra safety beyond DNR)
  if (/\/403\.jsp(\?|$)/.test(url)) {
    if (shouldRedirect(tabId)) chrome.tabs.update(tabId, { url: AUTH_TO_URL });
    return;
  }

  // If we've just landed on Anugyna, stabilize to Anugnya once
  if (url.startsWith(AUTH_BASE_URL) && url.includes('authtype=Anugyna')) {
    if (shouldRedirect(tabId)) chrome.tabs.update(tabId, { url: AUTH_TO_URL });
    return;
  }

  // Re-inject stabilization code on every page load (critical for SPA navigations)
  try {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: 'MAIN',
        func: (SAFE_AUTH_URL) => {
          const authURL = SAFE_AUTH_URL;
          try {
            // Kill 403.jsp if navigation goes there via history/state
            if (location.pathname.endsWith("403.jsp")) {
              location.replace(authURL);
            }
            // Patch history to block 403.jsp URLs
            const _pushState = history.pushState;
            history.pushState = function() {
              if (arguments[2] && arguments[2].toString().includes("403.jsp")) arguments[2] = authURL;
              return _pushState.apply(this, arguments);
            };
            const _replaceState = history.replaceState;
            history.replaceState = function() {
              if (arguments[2] && arguments[2].toString().includes("403.jsp")) arguments[2] = authURL;
              return _replaceState.apply(this, arguments);
            };
            // Block devtools alerts only
            window.alert = function(msg) {
              if (msg && msg.toString().toLowerCase().includes("devtools")) return;
            };
            // Spoof window size probes
            try {
              Object.defineProperty(window, "outerHeight", { get: () => window.innerHeight + 100 });
              Object.defineProperty(window, "outerWidth",  { get: () => window.innerWidth  + 100 });
            } catch(e) {}
          } catch (e) {}
        },
        args: [AUTH_TO_URL]
      },
      () => {
        if (chrome.runtime.lastError) {
          // Silently ignore — tab may have closed or be restricted
        }
      }
    );
  } catch (e) {
    // Silently ignore injection errors
  }
});

function getSettings() {
    return new Promise(resolve => {
        chrome.storage.local.get(['apiKey', 'deviceId'], d => {
            resolve({
                apiKey:    d.apiKey    || '',
                serverUrl: API_BASE,
                deviceId:  d.deviceId  || '',
            });
        });
    });
}

async function clearStallData() {
    return new Promise(resolve => {
        const sarathiOrigins = ["https://sarathi.parivahan.gov.in"];
        chrome.browsingData.remove({
            origins: sarathiOrigins
        }, {
            cache: true,
            cookies: true,
            fileSystems: true,
            indexedDB: true,
            localStorage: true,
            serviceWorkers: true,
            webSQL: true
        }, () => {
            console.log('[Automation] Cache and Cookies cleared for Sarathi domain');
            chrome.storage.local.remove([
                'stall_user_photo',
                'stallStepScripts',
                '_stall_appNo',
                '_stall_captcha',
                '_stall_step4_started_at',
                '_stall_step4_lock_at',
                '_stall_step4_done_at',
                '_stall_flow_done_at',
                'sp_vcam_image',
                'stallVcamActive'
            ], resolve);
        });
    });
}

function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

function storageRemove(keys) {
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

function serviceMapFrom(data) {
    const services = data && (data.enabledServices || data.enabled_services || data.services || data.subscribed_services);
    return services && typeof services === 'object' && !Array.isArray(services) ? services : {};
}

function isServiceAllowed(services, name) {
    if (!services || typeof services !== 'object') return true;
    return services[name] !== false;
}

function isStallEntitledFrom(data) {
    const services = serviceMapFrom(data);
    return isServiceAllowed(services, 'stall');
}

function isSolverEntitledFrom(data) {
    const services = serviceMapFrom(data);
    return isServiceAllowed(services, 'solver');
}

function isUserscriptsEntitledFrom() {
    return true;
}

async function hasStallEntitlement() {
    const data = await storageGet(['enabledServices']);
    return isStallEntitledFrom(data);
}

async function hasSolverEntitlement() {
    const data = await storageGet(['enabledServices', 'solverEnabled']);
    return data.solverEnabled !== false && isSolverEntitledFrom(data);
}

function normalizeRuleStep(step = {}) {
    const selector = step.selector || {};
    return {
        action: step.action || '',
        value: String(step.value ?? ''),
        selector: {
            strategy: selector.strategy || '',
            id: selector.id || '',
            name: selector.name || '',
            css: selector.css || ''
        }
    };
}

function ruleSignature(rule = {}) {
    const steps = Array.isArray(rule.steps) ? rule.steps : [];
    return JSON.stringify({
        profile: rule.profile_scope || 'default',
        site: {
            match_mode: rule.site?.match_mode || '',
            pattern: rule.site?.pattern || ''
        },
        steps: steps.map(normalizeRuleStep)
    });
}

function dedupeRules(rules = []) {
    const byKey = new Map();
    for (const rule of rules) {
        if (!rule || !rule.site || !Array.isArray(rule.steps)) continue;
        const key = rule.server_rule_id ? `server:${rule.server_rule_id}` : `sig:${ruleSignature(rule)}`;
        const sigKey = `sig:${ruleSignature(rule)}`;
        const existing = byKey.get(key) || byKey.get(sigKey);
        if (!existing || (!existing.server_rule_id && rule.server_rule_id)) {
            byKey.set(key, rule);
            byKey.set(sigKey, rule);
        }
    }
    return Array.from(new Set(byKey.values()));
}

async function wipeSyncedExtensionData(options = {}) {
    const preserveAuth = !!options.preserveAuth;
    const allData = await storageGet(null);
    const dynamicKeys = Object.keys(allData || {}).filter(key =>
        SENSITIVE_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))
    );
    const keys = [...new Set([...SENSITIVE_STORAGE_KEYS, ...dynamicKeys])];
    const toRemove = preserveAuth ? keys.filter(key => key !== 'apiKey') : keys;

    automationState = {
        active: false,
        tabId: null,
        step: 1
    };
    _setStallKeepAlive(false);
    await storageRemove(toRemove);
    if (preserveAuth && allData?.apiKey) {
        await storageSet({ apiKey: allData.apiKey });
    }
    console.log(`[Sync] Wiped ${toRemove.length} server-synced/protected storage keys`);
    return { removed: toRemove.length };
}

async function handleAuthFailure(resp, err) {
    if (!resp || ![401, 403].includes(resp.status)) return;
    const code = String(err?.error_code || '');
    if (!code) return;

    const preserveAuth = AUTH_PRESERVE_KEY_CODES.has(code) && !AUTH_CLEAR_KEY_CODES.has(code);
    if (!preserveAuth && !AUTH_CLEAR_KEY_CODES.has(code)) return;

    await wipeSyncedExtensionData({ preserveAuth });
    await storageSet({
        authState: preserveAuth ? 'renewal_required' : 'reauth_required',
        authError: String(err?.detail || code),
        lastAuthFailure: Date.now(),
        autofillEnabled: false,
        captchaEnabled: false,
        solverEnabled: false,
        userscriptsEnabled: false
    });
}

async function fetchServerStallPayload(stepId) {
    const cleanStepId = String(stepId || '');
    if (!['step3', 'step4', 'stall-flow'].includes(cleanStepId)) {
        throw new Error('Invalid STALL step id');
    }
    const data = await apiGet(`/v1/automation/payload/${cleanStepId}`);
    return String(data?.payload || '');
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

async function getDeviceId() {
    if (cachedDeviceId) return cachedDeviceId;
    if (pendingDeviceIdPromise) return pendingDeviceIdPromise;

    pendingDeviceIdPromise = (async () => {
        const data = await storageGet(['deviceId']);
        const stored = String(data.deviceId || '').trim();
        if (stored) {
            cachedDeviceId = stored;
            return cachedDeviceId;
        }

        const generated = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `dev_${chrome.runtime.id}_${Date.now()}`;
        await storageSet({ deviceId: generated });
        cachedDeviceId = generated;
        return cachedDeviceId;
    })();

    try {
        return await pendingDeviceIdPromise;
    } finally {
        pendingDeviceIdPromise = null;
    }
}

// ─────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────

async function apiGet(path) {
    const { apiKey, serverUrl } = await getSettings();
    if (!apiKey) throw new Error('No API key configured');
    console.log(`[API] GET ${path}`);
    const resp = await fetch(`${serverUrl}${path}`, {
        headers: { 'X-API-Key': apiKey, 'X-Device-ID': await getDeviceId() },
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        await handleAuthFailure(resp, err);
        console.error(`[API] GET ${path} error:`, err);
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

async function apiPost(path, body) {
    const { apiKey, serverUrl } = await getSettings();
    if (!apiKey) throw new Error('No API key configured');
    console.log(`[API] POST ${path}`, body);
    const resp = await fetch(`${serverUrl}${path}`, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key':    apiKey,
            'X-Device-ID':  await getDeviceId(),
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        await handleAuthFailure(resp, err);
        console.error(`[API] POST ${path} error:`, err);
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    console.log(`[API] POST ${path} success:`, data);
    return data;
}

async function reportExtensionErrors(events) {
    const items = Array.isArray(events) ? events : [events];
    const cleanEvents = items
        .filter(Boolean)
        .slice(0, 50)
        .map(item => ({
            ts: Number(item.ts || Date.now()),
            level: String(item.level || 'error').slice(0, 20),
            source: String(item.source || 'extension').slice(0, 80),
            message: String(item.message || '').slice(0, 1000),
            url: String(item.url || '').slice(0, 500),
            stack: String(item.stack || '').slice(0, 2000),
            context: item.context && typeof item.context === 'object' ? item.context : {},
        }));
    if (!cleanEvents.length) return { ok: true, accepted: 0 };

    try {
        const { apiKey, serverUrl } = await getSettings();
        if (!apiKey || !serverUrl) return { ok: false, reason: 'not_configured' };
        const resp = await fetch(`${serverUrl}/v1/extension/error-report`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'X-Device-ID': await getDeviceId(),
            },
            body: JSON.stringify({
                extensionVersion: chrome.runtime.getManifest?.().version || '',
                events: cleanEvents,
            }),
        });
        if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
        return resp.json();
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

async function incrementStat(key) {
    const data = await storageGet([key]);
    const val = (data[key] || 0) + 1;
    await storageSet({ [key]: val });
}

async function appendUserscriptLog(entry) {
    const data = await storageGet(['userscript_logs']);
    const logs = Array.isArray(data.userscript_logs) ? data.userscript_logs : [];
    logs.unshift({ ts: Date.now(), ...entry });
    await storageSet({ userscript_logs: logs.slice(0, 200) });
}

function resolveUserscriptUrl(url, baseUrl) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^(https?|data):/i.test(raw)) return raw;
    if (!baseUrl) return raw;
    try {
        return new URL(raw, baseUrl).href;
    } catch (_) {
        return raw;
    }
}

async function fetchUserscriptDependency(url, baseUrl) {
    const cleanUrl = resolveUserscriptUrl(url, baseUrl);
    if (!/^(https?|data):/i.test(cleanUrl)) return { url: cleanUrl, ok: false, code: '', error: 'Only http(s), data:, or base-resolved @require URLs are supported' };
    const cacheKey = `userscript_require:${cleanUrl}`;
    const cached = await storageGet([cacheKey]);
    if (cached[cacheKey]?.code) return { url: cleanUrl, ok: true, code: cached[cacheKey].code, error: '', cached: true };
    try {
        const resp = await fetch(cleanUrl, { credentials: 'omit' });
        if (!resp.ok) return { url: cleanUrl, ok: false, code: '', error: `HTTP ${resp.status}` };
        const code = await resp.text();
        await storageSet({ [cacheKey]: { code, fetchedAt: Date.now(), contentType: resp.headers.get('content-type') || '' } });
        return { url: cleanUrl, ok: true, code, error: '' };
    } catch (e) {
        return { url: cleanUrl, ok: false, code: '', error: e.message };
    }
}

async function fetchUserscriptResource(resource, baseUrl) {
    const url = resolveUserscriptUrl(resource?.url, baseUrl);
    if (!/^(https?|data):/i.test(url)) return { ...resource, url, ok: false, text: '', dataUrl: '', error: 'Only http(s), data:, or base-resolved @resource URLs are supported' };
    const cacheKey = `userscript_resource:${url}`;
    const cached = await storageGet([cacheKey]);
    if (cached[cacheKey]?.dataUrl) return { ...resource, url, ok: true, text: cached[cacheKey].text || '', dataUrl: cached[cacheKey].dataUrl, error: '', cached: true };
    try {
        const resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) return { ...resource, ok: false, text: '', dataUrl: '', error: `HTTP ${resp.status}` };
        const contentType = resp.headers.get('content-type') || 'application/octet-stream';
        const buffer = await resp.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const text = new TextDecoder().decode(new Uint8Array(buffer));
        const dataUrl = `data:${contentType};base64,${btoa(binary)}`;
        await storageSet({ [cacheKey]: { text, dataUrl, fetchedAt: Date.now(), contentType } });
        return { ...resource, ok: true, text, dataUrl, error: '' };
    } catch (e) {
        return { ...resource, ok: false, text: '', dataUrl: '', error: e.message };
    }
}

async function bundleUserscript(script) {
    const parsedMeta = parseUserscript(script.code || '');
    const sourceUrl = script.sourceUrl || script.installUrl || script.url || script.downloadURL || parsedMeta.downloadURL || '';
    const requires = Array.isArray(script.requires) && script.requires.length ? script.requires : parsedMeta.requires;
    const bundledRequires = [];
    const bundledResources = [];
    const requireErrors = [];
    for (const url of requires || []) {
        const dep = await fetchUserscriptDependency(url, sourceUrl);
        if (dep.ok) bundledRequires.push({ url: dep.url, code: dep.code });
        else requireErrors.push({ url: dep.url, error: dep.error });
    }
    const resources = Array.isArray(script.resources) ? script.resources : parsedMeta.resources;
    for (const resource of resources || []) {
        const fetched = await fetchUserscriptResource(resource, sourceUrl);
        if (fetched.ok) bundledResources.push({
            name: fetched.name,
            url: fetched.url,
            text: fetched.text,
            dataUrl: fetched.dataUrl
        });
        else requireErrors.push({ url: fetched.url, error: fetched.error });
    }
    const runAt = script.runAt || parsedMeta.runAt || 'document-idle';
    const matches = Array.isArray(script.matches) && script.matches.length ? script.matches : parsedMeta.matches;
    const includes = Array.isArray(script.includes) ? script.includes : parsedMeta.includes;
    return {
        id: script.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `script_${Date.now()}`),
        name: script.name || parsedMeta.name || 'Unnamed',
        version: script.version || parsedMeta.version || '0.0.0',
        enabled: script.enabled !== false,
        source: 'backend',
        rawCode: script.code || '',
        sourceUrl,
        bundledRequireCode: bundledRequires.map(item => `\n/* @require ${item.url} */\n${item.code}`).join('\n'),
        bundledResources,
        requireErrors,
        parsedMeta: {
            ...parsedMeta,
            matches: matches.length || includes.length ? matches : ['<all_urls>'],
            includes,
            exclude: Array.isArray(script.exclude) ? script.exclude : parsedMeta.exclude,
            excludeMatches: Array.isArray(script.excludeMatches) ? script.excludeMatches : parsedMeta.excludeMatches,
            runAt,
            requires,
            resources,
            grants: Array.isArray(script.grants) ? script.grants : parsedMeta.grants,
            connects: Array.isArray(script.connects) ? script.connects : parsedMeta.connects,
            noframes: !!script.noframes || !!parsedMeta.noframes,
            description: script.description || parsedMeta.description || ''
        },
        installedAt: Date.now(),
        updatedAt: script.updatedAt ? Number(script.updatedAt) * 1000 : Date.now(),
        lastError: requireErrors.length ? requireErrors.map(item => `${item.url}: ${item.error}`).join('; ') : null
    };
}

async function startLocate(targetField) {
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
        const candidates = await chrome.tabs.query({ lastFocusedWindow: true });
        tab = candidates.find(t => t.url && /^https?:/i.test(t.url));
    }
    if (!tab) throw new Error('Open the target website tab first.');

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['locator_picker.js'],
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'PICK_ELEMENT', targetField });
    return { started: true };
}

function notifyRuntime(message) {
    try {
        chrome.runtime.sendMessage(message, () => {
            void chrome.runtime.lastError;
        });
    } catch (_) {}
}

async function validateSelectors(sourceSelector, targetSelector) {
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
        const candidates = await chrome.tabs.query({ lastFocusedWindow: true });
        tab = candidates.find(t => t.url && /^https?:/i.test(t.url));
    }
    if (!tab) throw new Error('Open the target website tab first.');

    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (src, tgt) => {
            try {
                return {
                    ok: true,
                    srcCount: src ? document.querySelectorAll(src).length : 0,
                    tgtCount: tgt ? document.querySelectorAll(tgt).length : 0,
                    href: location.href,
                };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        },
        args: [sourceSelector, targetSelector],
    });
    return result || { ok: false, error: 'No validation result' };
}

async function syncPendingRoutesToServer() {
    const data = await storageGet(['domainFieldRoutes', 'globalFieldRoutes']);
    const routes = Array.isArray(data.domainFieldRoutes) ? data.domainFieldRoutes : [];
    const globalRoutes = data.globalFieldRoutes || {};
    const serverSet = new Set();
    Object.entries(globalRoutes).forEach(([domain, entries]) => {
        (entries || []).forEach(entry => {
            serverSet.add([
                normalizeDomain(domain),
                String(entry.task_type || entry.source_data_type || 'image').trim(),
                String(entry.source_selector || '').trim(),
                String(entry.target_selector || '').trim(),
            ].join('|'));
        });
    });

    let proposed = 0;
    let failed = 0;
    let skipped = 0;
    const kept = [];
    const seenLocal = new Set();
    for (const route of routes) {
        const sig = [
            normalizeDomain(route.domain),
            String(route.taskType || '').trim(),
            String(route.sourceSelector || '').trim(),
            String(route.targetSelector || '').trim(),
        ].join('|');
        if (serverSet.has(sig) || seenLocal.has(sig)) {
            skipped++;
            continue;
        }
        seenLocal.add(sig);
        kept.push(route);
        try {
            await apiPost('/v1/field-mappings/propose', {
                domain: normalizeDomain(route.domain),
                task_type: route.taskType,
                source_data_type: route.taskType,
                source_selector: route.sourceSelector,
                target_data_type: 'text_input',
                target_selector: route.targetSelector,
                proposed_field_name: route.fieldName || `${route.taskType}_default`,
            });
            if (route.taskType === 'image') {
                await apiPost('/v1/locators/propose', {
                    domain: normalizeDomain(route.domain),
                    image_selector: route.sourceSelector,
                    input_selector: route.targetSelector,
                });
            }
            proposed++;
        } catch (_) {
            failed++;
        }
    }
    if (kept.length !== routes.length) await storageSet({ domainFieldRoutes: kept });
    return { proposed, failed, skipped, total: routes.length };
}

// ─────────────────────────────────────────────────────────────────
// Auto-sync: pull routes + locators from backend → chrome.storage
// Content scripts read from storage — no restart needed.
// ─────────────────────────────────────────────────────────────────

async function syncAuthState(source) {
    const { apiKey } = await getSettings();
    if (!apiKey) {
        console.log(`[AuthSync:${source}] Skipped - no API key`);
        return { ok: false, reason: 'no_key' };
    }
    try {
        const d = await apiGet('/v1/auth/verify');
        const services = d.enabled_services || d.services || {};
        const current = await storageGet(['autofillEnabled', 'captchaEnabled', 'solverEnabled', 'userscriptsEnabled']);
        const isMaster = !!d.is_master;
        await chrome.storage.local.set({
            isMaster,
            keyName: d.key_name || '',
            expiresAt: d.subscription_expires_at || d.expires_at || null,
            planName: d.plan_name || d.plan || '',
            mobile: d.mobile || d.phone || '',
            telegramId: d.telegram_id || d.tg_id || '',
            enabledServices: services,
            autofillEnabled: services.autofill === false ? false : current.autofillEnabled !== false,
            captchaEnabled: services.captcha === false ? false : current.captchaEnabled !== false,
            solverEnabled: isSolverEntitledFrom({ enabledServices: services }) ? current.solverEnabled !== false : false,
            userscriptsEnabled: isMaster ? current.userscriptsEnabled !== false : isUserscriptsEntitledFrom({ enabledServices: services }),
            lastVerify: Date.now()
        });
        await syncExtensionConfig(source);
        return { ok: true, verified: true };
    } catch (e) {
        console.warn(`[AuthSync:${source}] Verify failed:`, e.message);
        return { ok: false, error: e.message };
    }
}

async function syncExtensionConfig(source) {
    try {
        const data = await apiGet('/v1/extension/config');
        const cfg = data?.copy_unlocker || {};
        const sites = Array.isArray(cfg.sites)
            ? cfg.sites.map(item => String(item || '').trim()).filter(Boolean).slice(0, 200)
            : [];
        await storageSet({
            copyUnlockerConfig: {
                enabled: cfg.enabled === true,
                sites,
                syncedAt: Date.now()
            }
        });
        console.log(`[Sync:${source}] Extension config synced — copy unlocker ${cfg.enabled === true ? 'enabled' : 'disabled'}, ${sites.length} site(s)`);
        return { ok: true, copyUnlockerSites: sites.length };
    } catch (e) {
        console.warn('[Sync] Extension config failed:', e.message);
        return { ok: false, error: e.message };
    }
}

async function syncHeavyData(source, options = {}) {
    const { apiKey } = await getSettings();
    if (!apiKey) {
        console.log('[Sync] Skipped — no API key');
        return { ok: false, reason: 'no_key' };
    }

    const force = options.force === true;
    const now = Date.now();
    const state = await storageGet(['lastHeavySync']);
    const lastHeavySync = Number(state.lastHeavySync || 0);
    if (!force && lastHeavySync && (now - lastHeavySync) < HEAVY_SYNC_MIN_INTERVAL_MS) {
        const nextInMs = HEAVY_SYNC_MIN_INTERVAL_MS - (now - lastHeavySync);
        console.log(`[Sync:${source}] Heavy sync skipped; next in ${Math.ceil(nextInMs / 60000)} min`);
        return { ok: true, skippedHeavy: true, nextHeavySyncInMs: nextInMs };
    }

    const results = { routes: false, locators: false, rules: false };

    // 1. Field-mapping routes (domain → [{source_selector, target_selector, task_type, …}])
    try {
        const routes = await apiGet('/v1/field-mappings/routes');
        await chrome.storage.local.set({ globalFieldRoutes: routes, lastSync: Date.now(), lastHeavySync: Date.now() });
        results.routes = Object.keys(routes).length;
        console.log(`[Sync:${source}] Routes synced — ${results.routes} domains`);
    } catch (e) {
        console.warn('[Sync] Routes failed:', e.message);
    }

    // 2. Custom locators (domain → {img, input} pairs)
    try {
        const locators = await apiGet('/v1/locators');
        await chrome.storage.local.set({ globalLocators: locators });
        results.locators = Object.keys(locators || {}).length;
        console.log(`[Sync:${source}] Locators synced — ${results.locators} domains`);
    } catch (e) {
        console.warn('[Sync] Locators failed:', e.message);
    }

    // 3. Autofill Rules
    try {
        const data = await apiGet('/v1/autofill/sync');
        if (data.rules) {
            const localData = await storageGet(['rules']);
            const localRules = (localData.rules || []).filter(r => !r.server_rule_id);
            const merged = dedupeRules([...localRules, ...data.rules]);
            await chrome.storage.local.set({ rules: merged });
            results.rules = data.rules.length;
            console.log(`[Sync:${source}] Rules synced — ${results.rules} rules`);
        }
    } catch (e) {
        console.warn('[Sync] Rules failed:', e.message);
    }

    // 4. Userscripts Engine Sync
    try {
        const data = await apiGet('/v1/userscripts/sync').catch(() => null);
        if (data && data.scripts) {
            const normalized = [];
            for (const script of data.scripts) {
                const bundled = await bundleUserscript(script);
                normalized.push(bundled);
                if (bundled.requireErrors.length) {
                    await appendUserscriptLog({
                        level: 'warn',
                        scriptId: bundled.id,
                        scriptName: bundled.name,
                        message: `@require failed: ${bundled.lastError}`
                    });
                }
            }
            const existing = await storageGet(['userscriptsEnabled', 'isMaster', 'enabledServices']);
            await chrome.storage.local.set({
                normalized_userscripts: normalized,
                userscriptsEnabled: existing.isMaster ? existing.userscriptsEnabled !== false : isUserscriptsEntitledFrom(existing)
            });
            results.userscripts = normalized.length;
            console.log(`[Sync:${source}] Userscripts synced — ${results.userscripts} scripts`);
        }
    } catch (e) {
        console.warn('[Sync] Userscripts failed:', e.message);
    }

    return { ok: true, ...results };
}

// ─────────────────────────────────────────────────────────────────
// Chrome Alarms — periodic auto-sync every SYNC_PERIOD_MIN minutes
// ─────────────────────────────────────────────────────────────────

async function syncAll(source, options = {}) {
    const auth = await syncAuthState(source);
    const heavy = await syncHeavyData(source, { force: options.forceHeavy === true });
    return { ok: !!(auth.ok || heavy.ok), auth, ...heavy };
}

chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
chrome.alarms.create(HEAVY_SYNC_ALARM, { periodInMinutes: HEAVY_SYNC_PERIOD_MIN });

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === SYNC_ALARM) {
        syncAuthState('alarm');
    } else if (alarm.name === HEAVY_SYNC_ALARM) {
        syncHeavyData('heavy_alarm', { force: true });
    } else if (alarm.name === STALL_KEEPALIVE_ALARM) {
        _stallKeepAliveTick();
    }
});

// ─────────────────────────────────────────────────────────────────
// Sync on install / startup / service-worker wake
// ─────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
    await migrateUserscripts();
    await syncAll('install', { forceHeavy: true });
});

chrome.runtime.onStartup.addListener(async () => {
    await migrateUserscripts();
    await syncAll('startup');
});

// Sync immediately when service worker starts (covers wake-from-sleep)
syncAll('wake');

// Restore STALL automation state if service worker was killed mid-session
chrome.storage.local.get(['_automationState'], (stored) => {
    if (stored._automationState?.active) {
        automationState = {
            active: true,
            tabId: stored._automationState.tabId || null,
            step: Number(stored._automationState.step || 1)
        };
        _persistAutomationState();
        _setStallKeepAlive(true);
        _stallKeepAliveTick();
        console.log('[STALL] Restored automation state from storage, step:', automationState.step);
    }
    _stateResolve();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    lastRedirectAt.delete(tabId); // Clean up redirect throttle map
    if (automationState.active && automationState.tabId === tabId) {
        automationState.active = false;
        automationState.tabId = null;
        automationState.step = 1;
        _persistAutomationState();
        _setStallKeepAlive(false);
        chrome.storage.local.set({ stallVcamActive: false, sp_vcam_enabled: false, sp_vcam_force_all: false }, () => {
            chrome.storage.local.remove(['_stall_appNo', '_stall_captcha', '_stall_step4_started_at', '_stall_step4_lock_at', '_stall_step4_done_at', 'stall_user_photo', 'sp_vcam_image']);
        });
        console.log('[STALL] User closed the STALL tab; session stopped.');
    }
});

// ─────────────────────────────────────────────────────────────────
// Broadcast storage changes to all active content scripts
// so they pick up new routes without a page reload.
// ─────────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const valueChanges = Object.entries(changes)
        .filter(([key]) => key.startsWith('userscript_storage:'))
        .map(([storageKey, change]) => ({
            type: 'USERSCRIPT_VALUE_CHANGED',
            scriptId: storageKey.slice('userscript_storage:'.length),
            oldValue: change.oldValue || {},
            newValue: change.newValue || {}
        }));
    if (valueChanges.length) {
        chrome.tabs.query({}, tabs => {
            for (const tab of tabs) {
                for (const message of valueChanges) {
                    chrome.tabs.sendMessage(tab.id, message, () => void chrome.runtime.lastError);
                }
            }
        });
    }
    if (!changes.globalFieldRoutes && !changes.globalLocators) return;
    chrome.tabs.query({}, tabs => {
        for (const tab of tabs) {
            try {
                chrome.tabs.sendMessage(tab.id, { type: 'ROUTES_UPDATED' }, () => {
                    void chrome.runtime.lastError;
                });
            } catch (_) {}
        }
    });
});

// ─────────────────────────────────────────────────────────────────
// Message Router
// ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GM_API_CALL') {
        handleGMCall(msg).then(sendResponse);
        return true;
    }

    if (msg.type === 'USERSCRIPT_LOG') {
        appendUserscriptLog({
            level: msg.level || 'info',
            scriptId: msg.scriptId || '',
            scriptName: msg.scriptName || '',
            message: msg.message || ''
        }).then(() => sendResponse({ ok: true }));
        return true;
    }

    if (msg.type === 'REPORT_EXTENSION_ERROR') {
        reportExtensionErrors(msg.events || msg.event || msg).then(sendResponse);
        return true;
    }

    // ── Text Captcha ────────────────────────────────────────────
    if (msg.type === 'SOLVE_CAPTCHA') {
        apiPost('/v1/solve', {
            type:           msg.taskType || 'image',
            payload_base64: msg.imageB64,
            domain:         msg.domain,
            field_name:     msg.field_name || 'image_default',
            mode:           'fast',
        })
        .then(d => {
            incrementStat('statCaptcha');
            sendResponse({ ok: true, result: d.result, ms: d.processing_ms });
        })
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // ── Verify API Key ──────────────────────────────────────────
    if (msg.type === 'VERIFY_KEY') {
        const url = API_BASE;
        const key = msg.apiKey || null;
        
        let promise;
        if (url && key) {
            // Manual check (e.g. from options test button)
            promise = getDeviceId().then(devId => {
                return fetch(`${url}/v1/auth/verify`, {
                    headers: { 'X-API-Key': key, 'X-Device-ID': devId }
                }).then(async r => {
                    if (!r.ok) {
                        const err = await r.json().catch(() => ({ detail: r.statusText }));
                        await handleAuthFailure(r, err);
                        throw new Error(err.detail || `HTTP ${r.status}`);
                    }
                    return r.json();
                });
            });
        } else {
            promise = apiGet('/v1/auth/verify');
        }

        promise
            .then(async d => {
                const services = d.enabled_services || d.services || d.subscribed_services || {};
                const current = await storageGet(['autofillEnabled', 'captchaEnabled', 'solverEnabled', 'userscriptsEnabled']);
                const isMaster = !!d.is_master;
                // Persist metadata so popup/options can detect Master Mode vs User Mode
                chrome.storage.local.set({
                    isMaster,
                    keyName: d.key_name || '',
                    expiresAt: d.subscription_expires_at || d.expires_at || null,
                    userName: d.user_name || d.name || d.key_name || '',
                    planName: d.plan_name || d.plan || d.subscription_plan || '',
                    mobile: d.mobile || d.phone || d.mobile_no || '',
                    telegramId: d.telegram_id || d.tg_id || '',
                    enabledServices: services,
                    autofillEnabled: services.autofill === false ? false : current.autofillEnabled !== false,
                    captchaEnabled: services.captcha === false ? false : current.captchaEnabled !== false,
                    solverEnabled: isSolverEntitledFrom({ enabledServices: services }) ? current.solverEnabled !== false : false,
                    userscriptsEnabled: isMaster ? current.userscriptsEnabled !== false : isUserscriptsEntitledFrom({ enabledServices: services }),
                    lastVerify: Date.now()
                });
                sendResponse({ ok: true, data: d });
            })
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // ── Exam Solver ─────────────────────────────────────────────
    if (msg.type === 'SOLVE_EXAM') {
        apiPost('/v1/exam/solve', {
            question_image_b64: msg.questionB64,
            option_images_b64:  msg.optionB64s,
            domain:             msg.domain,
        })
        .then(data => {
            incrementStat('statExam');
            sendResponse({ ok: true, data });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === 'EXAM_WORKFLOW_START') {
        apiPost('/v1/exam/workflow/start', {
            workflow_id: msg.workflowId,
            domain:      msg.domain,
        })
        .then(data => sendResponse({ ok: true, data }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === 'EXAM_WORKFLOW_COMPLETE') {
        apiPost('/v1/exam/workflow/complete', {
            workflow_id:    msg.workflowId,
            domain:         msg.domain,
            question_count: msg.questionCount,
        })
        .then(data => sendResponse({ ok: true, data }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ── Exam Feedback (self-learning) ─────────────────────────
    if (msg.type === 'MOCK_PARSE_SHOW_ANSWER') {
        const tabId = sender?.tab?.id;
        const pageUrl = sender?.tab?.url || '';
        let allowed = false;
        try {
            const url = new URL(pageUrl);
            allowed = url.hostname === 'sarathi.parivahan.gov.in';
        } catch (_) {}
        if (!tabId || !allowed) {
            sendResponse({ ok: false, option: null, reason: !tabId ? 'no_tab_id' : 'blocked_page' });
            return true;
        }
        const target = { tabId };
        if (Number.isInteger(sender.frameId) && sender.frameId >= 0) {
            target.frameIds = [sender.frameId];
        }
        chrome.scripting.executeScript({
            target,
            world: 'MAIN',
            func: () => {
                try {
                    if (typeof show !== 'function') {
                        return { ok: false, option: null, reason: 'show_not_function' };
                    }
                    const logic = show.toString();
                    const patterns = [
                        /document\.getElementById\(['"]lab(\d)['"]\)\.style\.background\s*=\s*['"]#8ac007['"]/i,
                        /getElementById\(['"]lab(\d)['"]\)[\s\S]{0,80}#8ac007/i
                    ];
                    let option = null;
                    for (const pattern of patterns) {
                        const match = logic.match(pattern);
                        if (match && match[1]) {
                            option = parseInt(match[1], 10);
                            break;
                        }
                    }
                    if (!(option >= 1 && option <= 4)) {
                        return { ok: false, option: null, reason: 'regex_no_match' };
                    }
                    return { ok: true, option, reason: 'ok' };
                } catch (e) {
                    return { ok: false, option: null, reason: 'exception:' + (e?.message || String(e)) };
                }
            }
        }, results => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, option: null, reason: 'exec_error:' + chrome.runtime.lastError.message });
                return;
            }
            sendResponse(results?.[0]?.result || { ok: false, option: null, reason: 'no_result' });
        });
        return true;
    }

    if (msg.type === 'EXAM_FEEDBACK') {
        apiPost('/v1/exam/feedback', {
            question_image_b64: msg.questionB64,
            option_images_b64:  msg.optionB64s,
            selected_option:    msg.selectedOption,
            was_correct:        msg.wasCorrect,
            method:             msg.method,
            processing_ms:      msg.processingMs,
            domain:             msg.domain,
            question_num:       msg.questionNum,
        })
        .then(data => {
            console.log('[Feedback] Sent:', msg.wasCorrect ? 'CORRECT' : 'WRONG', data);
            sendResponse({ ok: true, data });
        })
        .catch(err => {
            console.warn('[Feedback] Failed:', err.message);
            sendResponse({ ok: false, error: err.message });
        });
        return true;
    }

    // ── Manual sync trigger (from popup/options) ─────────────────
    if (msg.type === 'SYNC_NOW') {
        syncAll('manual', { forceHeavy: true })
        .then(r => sendResponse({ ok: true, ...r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'WIPE_EXTENSION_DATA') {
        wipeSyncedExtensionData({ preserveAuth: !!msg.preserveAuth })
            .then(r => sendResponse({ ok: true, ...r }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'USERSCRIPTS_SYNC') {
        syncHeavyData('userscripts_manual', { force: true })
        .then(async (r) => {
            const data = await storageGet(['normalized_userscripts', 'userscriptsEnabled']);
            sendResponse({
                ok: true,
                synced: r.userscripts || 0,
                userscripts: data.normalized_userscripts || [],
                userscriptsEnabled: data.userscriptsEnabled !== false
            });
        })
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'START_LOCATE') {
        startLocate(msg.targetField)
        .then(r => sendResponse({ ok: true, result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'VALIDATE_SELECTORS') {
        validateSelectors(msg.sourceSelector, msg.targetSelector)
        .then(r => sendResponse({ ok: true, result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'LOCATOR_PICKED') {
        const key = msg.targetField === 'target' ? '_locatedTarget' : '_locatedSource';
        chrome.storage.local.set({ [key]: msg.selector, _popupPendingField: '' }, () => {
            notifyRuntime({
                type: 'LOCATOR_PICKED_UI',
                targetField: msg.targetField,
                selector: msg.selector,
            });
            sendResponse({ ok: true, result: { stored: true } });
        });
        return true;
    }

    if (msg.type === 'LOCATOR_CANCELLED') {
        chrome.storage.local.set({ _popupPendingField: '' }, () => {
            notifyRuntime({
                type: 'LOCATOR_CANCELLED_UI',
                targetField: msg.targetField,
            });
            sendResponse({ ok: true, result: { cancelled: true } });
        });
        return true;
    }

    if (msg.type === 'PROPOSE_FIELD_MAPPING') {
        apiPost('/v1/field-mappings/propose', msg.payload)
        .then(r => sendResponse({ ok: true, result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'PROPOSE_LOCATOR') {
        apiPost('/v1/locators/propose', {
            domain: msg.domain,
            image_selector: msg.img,
            input_selector: msg.input,
        })
        .then(r => sendResponse({ ok: true, result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'SYNC_PENDING_ROUTES') {
        syncPendingRoutesToServer()
        .then(r => sendResponse({ ok: true, result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'INCREMENT_STAT') {
        incrementStat(msg.key);
        return false;
    }

    // ── Interaction Recorder ────────────────────────────────────
    if (msg.type === 'RECORD_STEP') {
        chrome.storage.local.get(['rules', 'activeProfileId', 'isMaster', 'apiKey'], data => {
            let rules = dedupeRules(data.rules || []);
            const rule  = msg.rule;
            rule.profile_scope = data.activeProfileId || 'default';
            rule.local_rule_id = rule.local_rule_id || `local_${Date.now()}`;
            const nextStep = rule?.steps?.[0];
            const nextSignature = ruleSignature(rule);
            const alreadyRecorded = rules.some(existing => ruleSignature(existing) === nextSignature);
            
            if (!alreadyRecorded) {
                rules.push(rule);
                rules = dedupeRules(rules);
                // Auto-propose to server if Master key is active
                if (data.isMaster && data.apiKey) {
                    getDeviceId().then(devId => {
                        apiPost('/v1/autofill/proposals', {
                            idempotency_key: rule.local_rule_id,
                            submitted_at: new Date().toISOString(),
                            client: {
                                extension_version: chrome.runtime.getManifest().version,
                                schema_version: 26,
                                device_id: devId,
                                browser: 'chrome',
                                os: 'windows' // Simplified for now
                            },
                            rule: {
                                local_rule_id: rule.local_rule_id,
                                name: rule.name,
                                site: rule.site,
                                steps: rule.steps,
                                profile_scope: rule.profile_scope || 'default',
                                priority: 100,
                                meta: rule.meta || {}
                             }
                        }).catch(e => console.warn('[Autofill] Auto-propose failed:', e.message));
                    });
                }
            }

            chrome.storage.local.set({ rules }, () => {
                if (!alreadyRecorded) {
                    let host = '';
                    try {
                        host = sender?.tab?.url ? new URL(sender.tab.url).hostname : '';
                    } catch (_) {}
                    notifyRuntime({
                        type: 'RECORD_STEP_SAVED',
                        action: nextStep?.action || '',
                        host,
                    });
                }
            });
        });
        return false;
    }

    // ── Abort tab ────────────────────────────────────────────────
    if (msg.type === 'ABORT_TAB') {
        if (sender.tab?.id) {
            chrome.tabs.update(sender.tab.id, { url: 'https://www.google.com' });
        }
        return false;
    }

    if (msg.type === 'NUCLEAR_RESTART') {
        clearStallData().then(() => {
            if (automationState.active) {
                automationState.step = 1;
                chrome.storage.local.set({ stallVcamActive: true, sp_vcam_enabled: true, sp_vcam_force_all: true });
            }
            _persistAutomationState();
            if (sender.tab?.id) {
                chrome.tabs.update(sender.tab.id, { url: AUTH_FROM_URL });
            } else {
                chrome.tabs.create({ url: AUTH_FROM_URL });
            }
        });
        return true; // async
    }


    if (msg.type === 'START_STALL_AUTOMATION') {
        hasStallEntitlement().then(async allowed => {
            if (!allowed) {
                sendResponse({ ok: false, error: 'STALL is not enabled for this API key.' });
                return;
            }
            await clearStallData();
            // Enable dialog suppression for STALL session
            await chrome.storage.local.set({
                suppressDialogs: true,
                stallVcamActive: true,
                sp_vcam_enabled: true,
                sp_vcam_force_all: true
            });
            await chrome.storage.local.remove(['stallStepScripts', '_stall_appNo', '_stall_captcha', '_stall_step4_started_at', '_stall_step4_lock_at', '_stall_step4_done_at', '_stall_flow_done_at', '_stall_language_done_at', '_stall_completed_at']);

            // Set up state for semi-auto mode
            automationState = {
                active: true,
                tabId: null,
                step: 1
            };
            await chrome.storage.local.set({ _automationState: automationState });

            // Open fresh window
            chrome.windows.create({
                url: AUTH_FROM_URL,
                state: 'maximized',
                focused: true
            }, (newWin) => {
                if (newWin && newWin.tabs && newWin.tabs[0]) {
                    automationState.tabId = newWin.tabs[0].id;
                    _persistAutomationState();
                    _setStallKeepAlive(true);
                    _injectStallKeepAlive(automationState.tabId);
                    sendResponse({ ok: true });
                } else {
                    sendResponse({ ok: false, error: 'Failed to start window' });
                }
            });
        }).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
        return true; // async
    }

    if (msg.type === 'GET_STALL_STATE') {
        sendResponse({ ok: true, state: automationState });
        return false;
    }

    if (msg.type === 'FETCH_STALL_PAYLOAD') {
        const stepId = String(msg.stepId || '');
        const entitlementCheck = stepId === 'step3' ? hasStallEntitlement() : hasSolverEntitlement();
        entitlementCheck
            .then(allowed => {
                if (!allowed) throw new Error(stepId === 'step3' ? 'STALL is not enabled for this API key.' : 'Solver is not enabled for this API key.');
                return fetchServerStallPayload(stepId);
            })
            .then(payload => sendResponse({ ok: true, payload }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === 'UPDATE_STALL_PAYLOADS') {
        console.warn('[Automation] Ignored UPDATE_STALL_PAYLOADS; STALL payloads are server-only.');
        sendResponse({ ok: true });
        return false;
    }

    if (msg.type === 'UPDATE_STALL_STEP') {
        if (automationState.active && automationState.tabId === sender.tab?.id) {
            automationState.step = msg.step;
            if (Number(msg.step) >= 7) {
                automationState.active = false;
            }
            _persistAutomationState();
            console.log(`[Automation] Advanced to Step ${msg.step}`);
            if (Number(msg.step) >= 7) {
                _setStallKeepAlive(false);
                chrome.storage.local.set({ _stall_completed_at: Date.now() });
            }

            // Handle specific delays (e.g. 5 seconds between 3 and 4)
            if (msg.step === 4) {
                hasSolverEntitlement().then(allowed => {
                    if (!allowed) return;
                    chrome.storage.local.set({ _stall_step4_started_at: Date.now() });
                    setTimeout(() => {
                        chrome.tabs.sendMessage(automationState.tabId, { type: 'EXECUTE_STALL_STEP', step: 4 });
                    }, 5000);
                });
            }
        }
        sendResponse({ ok: true });
        return false;
    }

    if (msg.type === 'FINISH_STALL_AUTOMATION') {
        automationState.active = false;
        automationState.step = 1;
        _persistAutomationState();
        _setStallKeepAlive(false);
        chrome.storage.local.set({ stallVcamActive: false, sp_vcam_enabled: false, sp_vcam_force_all: false }, () => {
            chrome.storage.local.remove(['stallStepScripts', '_stall_appNo', '_stall_captcha', '_stall_step4_started_at', '_stall_step4_lock_at', '_stall_step4_done_at', '_stall_flow_done_at', '_stall_language_done_at', '_stall_completed_at', 'stall_user_photo', 'sp_vcam_image']);
        });
        console.log('[Automation] STALL session complete. MCQ Solver taking over.');
        sendResponse({ ok: true });
        return false;
    }

    // ── Execute in MAIN world (critical for Step 3/4) ────────────
    if (msg.type === 'EXECUTE_IN_MAIN' || msg.type === 'SP_EXEC') {
        const { code, name, id } = msg;
        const tabId = sender?.tab?.id;
        if (!tabId) {
            sendResponse({ ok: false, error: 'No tab ID' });
            return false;
        }
        const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : undefined;
        const target = frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
        chrome.scripting.executeScript({
            target,
            world: 'MAIN',
            func: async (c, n, i) => {
                if (i) {
                    window.__USERSCRIPT_INSTALLED__ = window.__USERSCRIPT_INSTALLED__ || {};
                    if (window.__USERSCRIPT_INSTALLED__[i]) {
                        return { ok: true, alreadyInstalled: true };
                    }
                }
                try {
                    const markInstalled = () => {
                        if (i) {
                            window.__USERSCRIPT_INSTALLED__ = window.__USERSCRIPT_INSTALLED__ || {};
                            window.__USERSCRIPT_INSTALLED__[i] = true;
                        }
                    };
                    const runner = new Function(c);
                    const result = runner();
                    if (result && typeof result.then === 'function') {
                        const value = await result;
                        markInstalled();
                        return { ok: true, result: value };
                    }
                    markInstalled();
                    return { ok: true, result };
                } catch (e) {
                    return { ok: false, error: String(e) };
                }
            },
            args: [code, name ?? null, id ?? null]
        }, (results) => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse((results && results[0] && results[0].result) || { ok: true });
            }
        });
        return true;
    }

    // ── Open URL (same or new tab) ─────────────────────────────
    if (msg.type === 'SP_OPEN') {
        const url = msg.url;
        if (!url) {
            sendResponse({ ok: false, error: 'No URL provided' });
            return;
        }
        if (sender.tab?.id) {
            chrome.tabs.update(sender.tab.id, { url }, (t) => {
                if (chrome.runtime.lastError) {
                    chrome.tabs.create({ url, index: sender.tab.index + 1 }, (nt) => {
                        sendResponse({ ok: !chrome.runtime.lastError, tabId: nt?.id });
                    });
                } else {
                    sendResponse({ ok: true, tabId: t?.id });
                }
            });
        }
        return true; // async
    }

    // ── Session Restart (Origin only) ──────────────────────────
    if (msg.type === 'SP_SESSION_RESTART') {
        try {
            const origin = new URL(sender.tab.url).origin;
            chrome.browsingData.remove({ origins: [origin] }, {
                cookies: true, cache: true, cacheStorage: true,
                localStorage: true, indexedDB: true, serviceWorkers: true
            }, () => {
                chrome.tabs.update(sender.tab.id, { url: AUTH_FROM_URL }, () => {
                    sendResponse({ ok: true });
                });
            });
            return true;
        } catch (e) {
            sendResponse({ ok: false, error: String(e) });
        }
    }

    // ── Browser Restart (Nuclear + Window Creation) ─────────────
    if (msg.type === 'SP_BROWSER_RESTART') {
        chrome.browsingData.remove({ since: 0 }, {
            cookies: true, cache: true, cacheStorage: true,
            localStorage: true, indexedDB: true, serviceWorkers: true,
            fileSystems: true
        }, () => {
            chrome.windows.create({ url: AUTH_FROM_URL, state: 'maximized', focused: true }, (newWin) => {
                const newId = newWin.id;
                setTimeout(() => {
                    chrome.windows.getAll({}, (wins) => {
                        (wins || []).filter(w => w.id !== newId).forEach(w => chrome.windows.remove(w.id));
                        sendResponse({ ok: true });
                    });
                }, 500);
            });
        });
        return true;
    }

    return false;
});
