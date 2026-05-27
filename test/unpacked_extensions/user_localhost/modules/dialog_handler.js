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
    
    function init() {
        const shouldSuppress = document.documentElement.getAttribute('data-suppress-dialogs') === 'true';
        
        if (!shouldSuppress || !isStallExamRelatedUrl()) return;

        console.log('[ta-ta] JS Dialog Suppression Active');

        // Override alert
        window.alert = function(msg) {
            console.log('[Suppressed Alert]:', msg);
            return undefined;
        };

        // Override confirm
        window.confirm = function(msg) {
            console.log('[Suppressed Confirm]:', msg);
            return true; // Always confirm
        };

        // Override prompt
        window.prompt = function(msg, defaultVal) {
            console.log('[Suppressed Prompt]:', msg);
            return defaultVal || "";
        };
        
        // Prevent onbeforeunload
        window.onbeforeunload = null;
        Object.defineProperty(window, 'onbeforeunload', {
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
