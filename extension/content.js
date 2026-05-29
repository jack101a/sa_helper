// content.js - ta-ta Extension (V2.6.1)
// Slim bootloader for modularized content script.
// Modules: shared_utils.js, sarathi_harden.js, captcha.js, exam.js, autofill.js, stall_automation.js

(function () {
    'use strict';

    const DEBUG_LOGS = false;
    const debugLog = (...args) => { if (DEBUG_LOGS) console.log(...args); };

    function normalizedHost() {
        return String(location.hostname || '').replace(/^www\./, '').toLowerCase();
    }

    function isExcludedSite() {
        const host = normalizedHost();
        const blockedHosts = [
            'paypal.com', 'stripe.com', 'razorpay.com', 'paytm.com', 'phonepe.com',
            'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'kotak.com',
            'sbi.co.in', 'onlinesbi.sbi', 'bankofbaroda.in', 'unionbankofindia.co.in',
            'yesbank.in', 'idfcfirstbank.com', 'indusind.com', 'aubank.in',
            'canarabank.com', 'pnbindia.in', 'centralbankofindia.co.in', 'indianbank.in'
        ];
        return host === 'web.whatsapp.com'
            || host.endsWith('.bank.in')
            || host.includes('netbanking')
            || blockedHosts.some(domain => host === domain || host.endsWith('.' + domain));
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
        if (window.up_installErrorReporter) window.up_installErrorReporter('content');
        debugLog('[Content] Initializing modules...');

        // Use the shared utility for storage
        const data = await window.up_getStorage(['solverEnabled', 'autofillEnabled', 'captchaEnabled', 'isRecording', 'isMaster', 'enabledServices', 'stallVcamActive', '_automationState']);
        const sarathiHost = isSarathiHost();
        const stallRelated = isStallRelatedUrl();
        const services = data.enabledServices && typeof data.enabledServices === 'object' && !Array.isArray(data.enabledServices)
            ? data.enabledServices
            : {};
        const masterEntitled = data.isMaster === true;
        const stallEntitled = masterEntitled || services.exam === true;
        const solverEntitled = masterEntitled || (data.solverEnabled !== false && services.solver === true);

        // 1. Initialize Sarathi Hardening & Image Detector (Runs immediately)
        if (window.SarathiHarden) window.SarathiHarden.init();
        if (window.SarathiImageDetector) window.SarathiImageDetector.init();
        if (window.VcamController && sarathiHost) window.VcamController.init();

        // 2. Activate solver modules based on settings
        if (window.ExamModule && solverEntitled) window.ExamModule.activate();
        if (window.MockTrainerModule && sarathiHost && data.isMaster === true && solverEntitled) window.MockTrainerModule.activate();
        if (window.CaptchaModule && data.captchaEnabled !== false) window.CaptchaModule.activate();
        if (window.AutofillModule && (data.autofillEnabled !== false || data.isRecording === true)) window.AutofillModule.activate();

        // 3. Start automation monitor
        if (window.StallAutomation && stallRelated && stallEntitled) {
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
                debugLog('[Content] Routes updated by background sync — applying immediately');
                if (window.CaptchaModule.resetCache) window.CaptchaModule.resetCache();
            }

            // Step 4 remote trigger (orchestrated by background.js)
            if (msg.type === 'EXECUTE_STALL_STEP' && msg.step === 4 && window.StallAutomation && solverEntitled) {
                const runner = typeof window.StallAutomation.executeStep4Once === 'function'
                    ? window.StallAutomation.executeStep4Once('background')
                    : window.StallAutomation.executePayload('step4').then(() => {
                        chrome.runtime.sendMessage({ type: 'UPDATE_STALL_STEP', step: 5 });
                    });
                runner.catch(err => {
                    if (window.up_reportError) window.up_reportError('stall_step4', err);
                });
            }
            
        });

        debugLog('[Content] Boot complete.');
    }

    // Run bootloader
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
