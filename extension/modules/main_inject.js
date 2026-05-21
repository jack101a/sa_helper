(function() {
    'use strict';

    function isStallExamRelatedUrl() {
        try {
            const url = new URL(location.href);
            if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
            const path = url.pathname.toLowerCase();
            return path === '/sarathiservice/authenticationaction.do'
                || path === '/sarathiservice/instruction.do'
                || path === '/sarathiservice/examselectaction.do'
                || path === '/sarathiservice/stallexam.do'
                || path === '/sarathiservice/stallexamaction.do'
                || path === '/sarathiservice/stallloginsubmit.do';
        } catch (_) {
            return false;
        }
    }

    if (!isStallExamRelatedUrl()) return;

    // ── Stealth & Anti-Debugger ──────────────────────────────────
    window.alert = function() {};
    window.confirm = function() { return true; };
    window.prompt = function(msg, defaultVal) { return defaultVal || ''; };
    window.close = function() {
        console.log('[ta-ta] Suppressed window.close');
    };
    window.onbeforeunload = null;
    try {
        Object.defineProperty(window, 'onbeforeunload', {
            get: () => null,
            set: () => {}
        });
    } catch (_) {}

    try {
        const safeAuthUrl = 'https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugnya';
        const originalPushState = history.pushState;
        history.pushState = function() {
            if (arguments[2] && String(arguments[2]).includes('403.jsp')) arguments[2] = safeAuthUrl;
            return originalPushState.apply(this, arguments);
        };
        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
            if (arguments[2] && String(arguments[2]).includes('403.jsp')) arguments[2] = safeAuthUrl;
            return originalReplaceState.apply(this, arguments);
        };
    } catch (_) {}

    // ── Network Image Interceptor ───────────────────────────────
    const handleCapturedImage = (url, base64) => {
        if (!base64 || base64.length < 500) return;
        window.postMessage({ type: 'SP_IMAGE_INTERCEPTED', url, data: base64 }, '*');
    };

    // Fetch Interceptor
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const clone = response.clone();
        const url = args[0] instanceof Request ? args[0].url : args[0];
        
        if (url.match(/\.(jpg|jpeg|png|gif|bmp)/i) || url.includes('captcha') || url.includes('image')) {
            clone.blob().then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => handleCapturedImage(url, reader.result);
                reader.readAsDataURL(blob);
            });
        }
        return response;
    };

    // XHR Interceptor
    const originalXHR = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        this.addEventListener('load', () => {
            if (url.match(/\.(jpg|jpeg|png|gif|bmp)/i) || url.includes('captcha') || url.includes('image')) {
                const blob = this.response;
                if (blob instanceof Blob) {
                    const reader = new FileReader();
                    reader.onloadend = () => handleCapturedImage(url, reader.result);
                    reader.readAsDataURL(blob);
                }
            }
        });
        originalXHR.apply(this, arguments);
    };

    console.log('[ta-ta] Interceptor Active');
})();
