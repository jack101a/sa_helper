// ==UserScript==
// @name         Sarathi - Select Maharashtra and COVs in Edit LL
// @namespace    local.sarathi.select.maharashtra.covs
// @version      1.1
// @description  Select MH / Maharashtra and required COVs once on eKycOTPAuth.do
// @match        https://sarathi.parivahan.gov.in/sarathiservice/eKycOTPAuth.do
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Extra safety: only run on this exact URL
    const allowedUrl = 'https://sarathi.parivahan.gov.in/sarathiservice/eKycOTPAuth.do';
    if (window.location.href !== allowedUrl) return;

    let observer = null;
    let maharashtraDone = false;
    let covsDone = false;

    const requiredCovs = [
        'Motor Cycle with Gear(Non Transport) (MCWG)',
        'LIGHT MOTOR VEHICLE (LMV)',
        'LMV-TR(GOODS) (LMV-TR)',
        'LMV -3 Wheeler CAB (3W-CAB)',
        'LMV -3 Wheeler Transport Goods Non PSV (3W-GV)',
        'Motor cycle without Gear (Non Transport) (MCWOG)'
    ];

    function triggerSelectEvents(select) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));

        // Refresh common enhanced select plugins if present
        if (window.jQuery) {
            const $ = window.jQuery;
            const $select = $(select);

            $select.trigger('change');
            $select.trigger('chosen:updated');
            $select.trigger('liszt:updated');

            try {
                $select.multiselect('refresh');
            } catch (e) {}

            try {
                $select.selectpicker('refresh');
            } catch (e) {}
        }
    }

    function selectMaharashtra() {
        if (maharashtraDone) return;

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
        triggerSelectEvents(select);

        maharashtraDone = true;
        console.log('[Sarathi Userscript] Maharashtra selected');
    }

    function selectRequiredCovs() {
        if (covsDone) return;

        const select = document.querySelector('#selectedCovsList, select[name="selectedCovsList"]');
        if (!select) return;

        requiredCovs.forEach(covValue => {
            let option = Array.from(select.options).find(opt =>
                opt.value.trim() === covValue || opt.textContent.trim() === covValue
            );

            if (!option) {
                option = new Option(covValue, covValue, true, true);
                option.className = 'bhashini-skip-translation NALOC';
                option.title = covValue;
                option.style.cursor = 'pointer';
                select.add(option);
            }

            option.selected = true;
            option.setAttribute('selected', 'selected');
        });

        triggerSelectEvents(select);

        covsDone = true;
        console.log('[Sarathi Userscript] Required COVs selected');
    }

    function runAutomation() {
        selectMaharashtra();
        selectRequiredCovs();

        if (maharashtraDone && covsDone && observer) {
            observer.disconnect();
            observer = null;
            console.log('[Sarathi Userscript] Completed and observer disconnected');
        }
    }

    runAutomation();

    observer = new MutationObserver(() => {
        runAutomation();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Safety cleanup so observer does not run forever if one field never appears
    setTimeout(() => {
        if (observer) {
            observer.disconnect();
            observer = null;
            console.log('[Sarathi Userscript] Observer stopped after timeout');
        }
    }, 30000);
})();