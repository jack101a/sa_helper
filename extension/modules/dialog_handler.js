(function() {
    'use strict';

    // This script runs in the MAIN world to override native dialogs.
    // We check a data attribute on the document element to see if suppression is enabled.

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
    
    const originalDialogs = {
        alert: window.alert,
        confirm: window.confirm,
        prompt: window.prompt,
        beforeUnloadValue: window.onbeforeunload,
        beforeUnloadDescriptor: Object.getOwnPropertyDescriptor(window, 'onbeforeunload')
    };
    let dialogsSuppressed = false;

    function restoreOnBeforeUnload() {
        try {
            if (originalDialogs.beforeUnloadDescriptor) {
                Object.defineProperty(window, 'onbeforeunload', originalDialogs.beforeUnloadDescriptor);
            } else {
                window.onbeforeunload = originalDialogs.beforeUnloadValue || null;
            }
        } catch (_) {
            try { window.onbeforeunload = originalDialogs.beforeUnloadValue || null; } catch (_) {}
        }
    }

    function init() {
        const shouldSuppress = document.documentElement.getAttribute('data-suppress-dialogs') === 'true';
        if ((!shouldSuppress || !isStallExamRelatedUrl()) && dialogsSuppressed) {
            dialogsSuppressed = false;
            try { window.alert = originalDialogs.alert; } catch (_) {}
            try { window.confirm = originalDialogs.confirm; } catch (_) {}
            try { window.prompt = originalDialogs.prompt; } catch (_) {}
            restoreOnBeforeUnload();
            return;
        }
        if (!shouldSuppress || !isStallExamRelatedUrl() || dialogsSuppressed) return;
        dialogsSuppressed = true;

        console.log('[ta-ta] JS Dialog Suppression Active');

        window.alert = function(msg) {
            console.log('[Suppressed Alert]:', msg);
            return undefined;
        };

        window.confirm = function(msg) {
            console.log('[Suppressed Confirm]:', msg);
            return true;
        };

        window.prompt = function(msg, defaultVal) {
            console.log('[Suppressed Prompt]:', msg);
            return defaultVal || "";
        };

        window.onbeforeunload = null;
        Object.defineProperty(window, 'onbeforeunload', {
            configurable: true,
            get: function() { return null; },
            set: function() {}
        });
    }
    // Run immediately
    init();

    // Also observe attribute changes in case it's toggled dynamically
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-suppress-dialogs') {
                init();
            }
        });
    });
    observer.observe(document.documentElement, { attributes: true });

})();
