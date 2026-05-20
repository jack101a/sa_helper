// ==UserScript==
// @name         COPY PASTE
// @namespace    http://tampermonkey.net/
// @version      2025-07-29
// @description  try to take over the world!
// @author       You
// @match        https://sarathi.parivahan.gov.in/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gov.in
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function removeHandlers() {
        document.querySelectorAll('*').forEach(el => {
            el.oncopy = null;
            el.onpaste = null;
        });
    }

    // Initial clean
    removeHandlers();

    // Observe the DOM for changes (e.g., dynamically loaded content)
    const observer = new MutationObserver(() => {
        removeHandlers();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

})();