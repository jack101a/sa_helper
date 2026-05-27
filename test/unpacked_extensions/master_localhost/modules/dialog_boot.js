(function() {
    'use strict';

    // This script runs in the ISOLATED world at document_start.
    // It reads the suppression setting and sets an attribute on the document element
    // so that the MAIN world script can see it immediately.

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

    async function sync() {
        try {
            const data = await chrome.storage.local.get('suppressDialogs');
            const enabled = data.suppressDialogs === true && isStallExamRelatedUrl();
            document.documentElement.setAttribute('data-suppress-dialogs', enabled ? 'true' : 'false');
        } catch (e) {
            console.error('[ta-ta] Boot error:', e);
        }
    }

    sync();

    // Also listen for changes to update the attribute in real-time
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.suppressDialogs) {
            const enabled = changes.suppressDialogs.newValue === true && isStallExamRelatedUrl();
            document.documentElement.setAttribute('data-suppress-dialogs', enabled ? 'true' : 'false');
        }
    });

})();
