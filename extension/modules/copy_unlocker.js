// modules/copy_unlocker.js - admin-controlled right-click/copy/select restore.
(function () {
    'use strict';

    if (window.__TA_TA_COPY_UNLOCKER_LOADED__) return;
    window.__TA_TA_COPY_UNLOCKER_LOADED__ = true;

    const INLINE_ATTRS = ['oncontextmenu', 'oncopy', 'onpaste', 'onselectstart'];
    const EVENT_TYPES = ['contextmenu', 'copy', 'paste', 'selectstart'];
    const STYLE_ID = 'ta-ta-copy-unlocker-style';

    function storageGet(keys) {
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }

    function normalizeHost(value) {
        let token = String(value || '').trim().toLowerCase();
        if (!token) return '';
        try {
            if (token.includes('://')) token = new URL(token).hostname;
        } catch (_) {}
        return token.split('/', 1)[0].split(':', 1)[0].replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
    }

    function wildcardToRegExp(pattern) {
        const escaped = String(pattern)
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`, 'i');
    }

    function urlMatchesPattern(rawPattern) {
        const pattern = String(rawPattern || '').trim();
        if (!pattern) return false;
        const href = location.href;
        const host = normalizeHost(location.hostname);
        const lowerPattern = pattern.toLowerCase();

        if (lowerPattern === '<all_urls>' || lowerPattern === '*') return true;
        if (pattern.includes('://') || pattern.includes('/')) {
            return wildcardToRegExp(pattern).test(href);
        }

        const clean = normalizeHost(pattern.replace(/^\*\./, ''));
        if (!clean) return false;
        if (pattern.startsWith('*.')) return host === clean || host.endsWith(`.${clean}`);
        return host === clean || host.endsWith(`.${clean}`);
    }

    function isEnabledForCurrentPage(config) {
        if (!config || config.enabled !== true) return false;
        const sites = Array.isArray(config.sites) ? config.sites : [];
        return sites.some(urlMatchesPattern);
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
html, body, body * {
  -webkit-user-select: text !important;
  user-select: text !important;
}
`;
        (document.documentElement || document.head || document.body)?.appendChild(style);
    }

    function removeInlineBlockers(root) {
        const start = root && root.nodeType === Node.ELEMENT_NODE ? root : document.documentElement;
        if (!start) return;
        const clean = (el) => {
            for (const attr of INLINE_ATTRS) {
                if (el.hasAttribute && el.hasAttribute(attr)) el.removeAttribute(attr);
            }
        };
        clean(start);
        if (start.querySelectorAll) {
            start.querySelectorAll(INLINE_ATTRS.map(attr => `[${attr}]`).join(',')).forEach(clean);
        }
    }

    function installEventGuards() {
        const allowDefaultBeforePageHandlers = (event) => {
            event.stopImmediatePropagation();
        };
        for (const type of EVENT_TYPES) {
            window.addEventListener(type, allowDefaultBeforePageHandlers, true);
            document.addEventListener(type, allowDefaultBeforePageHandlers, true);
        }
    }

    function observeInlineBlockers() {
        if (window.__TA_TA_COPY_UNLOCKER_OBSERVING__) return;
        if (!document.documentElement || typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    removeInlineBlockers(mutation.target);
                } else {
                    for (const node of mutation.addedNodes || []) removeInlineBlockers(node);
                }
            }
        });
        observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: INLINE_ATTRS,
        });
        window.__TA_TA_COPY_UNLOCKER_OBSERVING__ = true;
    }

    function activate() {
        if (window.__TA_TA_COPY_UNLOCKER_ACTIVE__) return;
        window.__TA_TA_COPY_UNLOCKER_ACTIVE__ = true;
        installStyle();
        installEventGuards();
        removeInlineBlockers(document.documentElement);
        observeInlineBlockers();
        console.log('[CopyUnlocker] Enabled for admin-approved site.');
    }

    function refreshDomHooks() {
        if (!window.__TA_TA_COPY_UNLOCKER_ACTIVE__) return;
        installStyle();
        removeInlineBlockers(document.documentElement);
        observeInlineBlockers();
    }

    async function init() {
        try {
            const data = await storageGet(['copyUnlockerConfig']);
            if (isEnabledForCurrentPage(data.copyUnlockerConfig)) activate();
        } catch (e) {
            console.debug('[CopyUnlocker] Init skipped:', e?.message || e);
        }
    }

    if (document.readyState === 'loading') {
        init();
        document.addEventListener('DOMContentLoaded', refreshDomHooks, { once: true });
    } else {
        init();
    }
})();
