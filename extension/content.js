// content.js - ta-ta Extension (V2.2)
// Slim bootloader for modularized content script.
// Modules: shared_utils.js, sarathi_harden.js, captcha.js, exam.js, autofill.js, stall_automation.js

(function () {
    'use strict';

    function normalizedHost() {
        return String(location.hostname || '').replace(/^www\./, '').toLowerCase();
    }

    function isExcludedSite() {
        const host = normalizedHost();
        return host === 'web.whatsapp.com' || host.endsWith('.bank.in');
    }

    function isSarathiHost() {
        return normalizedHost() === 'sarathi.parivahan.gov.in';
    }

    function isStallRelatedUrl() {
        if (!isSarathiHost()) return false;
        const href = location.href;
        return /authenticationaction\.do|instruction\.do|examselectaction\.do|stallexam\.do|stallLoginSubmit\.do/i.test(href);
    }

    // Prevent double injection
    if (window.__UNIFIED_PLATFORM_INJECTED__) return;
    window.__UNIFIED_PLATFORM_INJECTED__ = true;

    async function boot() {
        if (isExcludedSite()) return;
        console.log('[Content] Initializing modules...');

        // Use the shared utility for storage
        const data = await window.up_getStorage(['solverEnabled', 'autofillEnabled', 'captchaEnabled', 'isMaster', 'stallVcamActive', '_automationState']);
        const sarathiHost = isSarathiHost();
        const stallRelated = isStallRelatedUrl();

        // 1. Initialize Sarathi Hardening & Image Detector (Runs immediately)
        if (window.SarathiHarden) window.SarathiHarden.init();
        if (window.SarathiImageDetector) window.SarathiImageDetector.init();
        if (window.VcamController && data.stallVcamActive === true) window.VcamController.init();

        // 2. Activate solver modules based on settings
        if (window.ExamModule && data.solverEnabled !== false) window.ExamModule.activate();
        if (window.MockTrainerModule && sarathiHost && data.isMaster === true && data.solverEnabled !== false) window.MockTrainerModule.activate();
        if (window.CaptchaModule && data.captchaEnabled !== false) window.CaptchaModule.activate();
        if (window.AutofillModule && data.autofillEnabled !== false) window.AutofillModule.activate();

        // 3. Start automation monitor
        if (window.StallAutomation && stallRelated) {
            if (typeof window.StallAutomation.start === 'function') window.StallAutomation.start();
            else window.StallAutomation.run();
        }

        // 4. Listen for control messages
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.type === 'TOGGLE_RECORD' && window.AutofillModule) {
                window.AutofillModule.toggleRecording(msg.state);
            }
            if (msg.type === 'FORCE_AUTOFILL' && window.AutofillModule) {
                window.AutofillModule.runNow();
            }
            if (msg.type === 'ROUTES_UPDATED' && window.CaptchaModule) {
                console.log('[Content] Routes updated by background sync — applying immediately');
                if (window.CaptchaModule.resetCache) window.CaptchaModule.resetCache();
            }

            // Step 4 remote trigger (orchestrated by background.js)
            if (msg.type === 'EXECUTE_STALL_STEP' && msg.step === 4 && window.StallAutomation) {
                const runner = typeof window.StallAutomation.executeStep4Once === 'function'
                    ? window.StallAutomation.executeStep4Once('background')
                    : window.StallAutomation.executePayload('step4').then(() => {
                        chrome.runtime.sendMessage({ type: 'UPDATE_STALL_STEP', step: 5 });
                    });
                runner.catch(err => {
                    console.error('[Content] Step 4 execution failed:', err);
                });
            }
            
        });

        console.log('[Content] Boot complete.');
    }

    // Run bootloader
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
