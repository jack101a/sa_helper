// ==UserScript==
// @name         Sarathi - Select Maharashtra in Edit LL
// @namespace    local.sarathi.select.maharashtra
// @version      1.0
// @description  Select MH / Maharashtra once on eKycOTPAuth.do
// @match        https://sarathi.parivahan.gov.in/sarathiservice/eKycOTPAuth.do
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Extra safety: only run on this exact URL path
    const allowedUrl = 'https://sarathi.parivahan.gov.in/sarathiservice/eKycOTPAuth.do';
    if (window.location.href !== allowedUrl) return;

    let executed = false;

    function selectMaharashtra() {
        if (executed) return;

        const select = document.querySelector('#presState');

        if (!select) return;

        let option = Array.from(select.options).find(opt =>
            opt.value === 'MH' || /maharashtra/i.test(opt.textContent)
        );

        if (!option) {
            option = new Option('Maharashtra', 'MH');
            option.className = 'bhashini-skip-translation';
            select.add(option);
        }

        select.value = 'MH';

        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));

        executed = true;

        if (observer) {
            observer.disconnect();
        }
    }

    selectMaharashtra();

    const observer = new MutationObserver(() => {
        selectMaharashtra();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();