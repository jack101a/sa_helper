(function() {
    'use strict';

    // This script runs in the ISOLATED world at document_start.
    // It reads the suppression setting and sets an attribute on the document element
    // so that the MAIN world script can see it immediately.

    async function sync() {
        try {
            const data = await chrome.storage.local.get('suppressDialogs');
            const enabled = data.suppressDialogs === true;
            document.documentElement.setAttribute('data-suppress-dialogs', enabled ? 'true' : 'false');
        } catch (e) {
            console.error('[ta-ta] Boot error:', e);
        }
    }

    sync();

    // Also listen for changes to update the attribute in real-time
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.suppressDialogs) {
            document.documentElement.setAttribute('data-suppress-dialogs', changes.suppressDialogs.newValue === true ? 'true' : 'false');
        }
    });

})();
