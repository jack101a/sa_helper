// extension/modules/shared_utils.js
(function () {
    'use strict';

    window.up_getStorage = function(keys) {
        return new Promise(resolve => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.id) return resolve({});
            try {
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
