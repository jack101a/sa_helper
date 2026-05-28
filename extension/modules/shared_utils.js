// extension/modules/shared_utils.js
(function () {
    'use strict';

    const reportState = {
        queue: [],
        seen: new Map(),
        timer: null,
        installed: false
    };
    const PROTECTED_READ_KEYS = new Set([
        'rules',
        'normalized_userscripts',
        'globalFieldRoutes',
        'globalLocators',
        'copyUnlockerConfig'
    ]);

    function compactError(value) {
        if (value instanceof Error) {
            return { message: value.message || String(value), stack: value.stack || '', name: value.name || 'Error' };
        }
        if (value && typeof value === 'object') {
            return { message: value.message || JSON.stringify(value).slice(0, 1000), stack: value.stack || '', name: value.name || '' };
        }
        return { message: String(value || ''), stack: '', name: '' };
    }

    function flushReports() {
        if (!reportState.queue.length || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        const events = reportState.queue.splice(0, 25);
        try {
            chrome.runtime.sendMessage({ type: 'REPORT_EXTENSION_ERROR', events }, () => {
                void chrome.runtime.lastError;
            });
        } catch (_) {}
    }

    window.up_reportError = function(source, error, context = {}) {
        const clean = compactError(error);
        const signature = `${source}|${clean.name}|${clean.message}`.slice(0, 500);
        const now = Date.now();
        const last = reportState.seen.get(signature) || 0;
        if (now - last < 60000) return;
        reportState.seen.set(signature, now);
        reportState.queue.push({
            ts: now,
            level: 'error',
            source,
            message: clean.message,
            stack: clean.stack,
            url: location.href,
            context
        });
        if (!reportState.timer) {
            reportState.timer = setInterval(flushReports, 30000);
        }
        if (reportState.queue.length >= 10) flushReports();
    };

    window.up_installErrorReporter = function(source = 'content') {
        if (reportState.installed) return;
        reportState.installed = true;
        window.addEventListener('error', event => {
            window.up_reportError(source, event.error || event.message, {
                filename: event.filename || '',
                line: event.lineno || 0,
                column: event.colno || 0
            });
        });
        window.addEventListener('unhandledrejection', event => {
            window.up_reportError(source, event.reason || 'Unhandled promise rejection');
        });
    };

    function needsProtectedStorage(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return list.some(key => PROTECTED_READ_KEYS.has(key));
    }

    function getExtensionStorage(keys) {
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage({ type: 'GET_EXTENSION_STORAGE', keys }, response => {
                    if (chrome.runtime.lastError || !response?.ok) return resolve({});
                    resolve(response.data || {});
                });
            } catch (_) {
                resolve({});
            }
        });
    }

    window.up_getStorage = function(keys) {
        return new Promise(resolve => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.id) return resolve({});
            try {
                if (keys !== null && keys !== undefined && needsProtectedStorage(keys)) {
                    getExtensionStorage(keys).then(resolve);
                    return;
                }
                const p = chrome.storage.local.get(keys, resolve);
                if (p && typeof p.catch === 'function') {
                    p.catch(() => resolve({}));
                }
            } catch (e) {
                resolve({});
            }
        });
    };

    window.up_imgToB64 = function(imgEl) {
        try {
            const w = imgEl.naturalWidth  || imgEl.width  || 0;
            const h = imgEl.naturalHeight || imgEl.height || 0;
            if (w === 0 || h === 0) return null; // image not yet loaded
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        } catch (_) { return null; }
    };

    window.up_utf8ToB64 = function(value) {
        return btoa(unescape(encodeURIComponent(String(value || ''))));
    };

    window.up_sendMsg = async function(type, payload = {}) {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return { ok: false, error: 'Extension context invalidated' };
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage({ type, ...payload }, response => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response || { ok: false, error: 'No response from background' });
                    }
                });
            } catch (e) {
                resolve({ ok: false, error: e.message });
            }
        });
    };

    window.up_rndInt = function(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    window.up_humanMouse = async function(el) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + window.up_rndInt(5, Math.max(6, r.width  - 5));
        const cy = r.top  + window.up_rndInt(3, Math.max(4, r.height - 3));
        const o  = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        el.dispatchEvent(new MouseEvent('mouseover',  o));
        await new Promise(r => setTimeout(r, window.up_rndInt(60, 180)));
        el.dispatchEvent(new MouseEvent('mousemove',  o));
        await new Promise(r => setTimeout(r, window.up_rndInt(40, 120)));
        el.dispatchEvent(new MouseEvent('mouseenter', o));
        await new Promise(r => setTimeout(r, window.up_rndInt(30, 90)));
    };

})();
