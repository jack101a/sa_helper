// ==UserScript==
// @name         Bypass Sarathi Restrictions - V2
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Disables DevTools blockers, tab-switching penalties, and copy/paste restrictions completely.
// @author       You
// @match        *://sarathi.parivahan.gov.in/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("[Tampermonkey] Initiating V2 bypass for Categories 1, 2, and 3...");

    // ==========================================
    // CATEGORY 1: ANTI-DEVTOOLS & KEYBOARD LOCKS
    // ==========================================

    // 1. Intercept 'addEventListener' to drop hostile traps
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'visibilitychange') return; // Block tab-switch trap
        if (listener && listener.name === 'detectDevTool') return; // Block DevTools trap
        return originalAddEventListener.call(this, type, listener, options);
    };

    // 2. Neutralize the backend logout trigger
    window.logout = function() {
        console.log("[Tampermonkey] Blocked hostile logout() attempt.");
    };

    // 3. Filter hostile alerts (Keep normal alerts like "Enter Captcha")
    const originalAlert = window.alert;
    window.alert = function(msg) {
        if (typeof msg === 'string' && (msg.includes('DEVTOOLS') || msg.includes('terminated'))) {
            console.log("[Tampermonkey] Suppressed hostile alert:", msg);
            return;
        }
        originalAlert(msg);
    };

    // 4. Defeat BOTH native and jQuery keyboard traps (F12, Esc, Ctrl+Shift+I/J/C, Ctrl+U)
    window.addEventListener('keydown', function(e) {
        const isDevKey = 
            e.keyCode === 123 || // F12
            e.keyCode === 27 ||  // Escape
            (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || // Ctrl+Shift+I/J/C
            (e.ctrlKey && e.keyCode === 85); // Ctrl+U

        if (isDevKey) {
            e.stopImmediatePropagation(); // Stops jQuery and native scripts from seeing the keypress
            console.log(`[Tampermonkey] Rescued protected keystroke: ${e.keyCode}`);
        }
    }, true); // 'true' ensures this runs in the Capture Phase first!

    Object.defineProperty(document, 'onkeydown', { set: function() {}, get: function() { return null; } });


    // ==========================================
    // CATEGORY 2: TAB SWITCHING & NAV BLOCKERS
    // ==========================================

    // 1. Prevent window closing and history manipulation
    window.close = function() { console.log("[Tampermonkey] Blocked window.close()."); };
    window.history.forward = function() { console.log("[Tampermonkey] Blocked history.forward()."); };

    // 2. Spoof visibility
    Object.defineProperty(document, 'hidden', { get: function() { return false; } });
    Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; } });


    // ==========================================
    // CATEGORY 3: COPY, PASTE & CONTEXT MENU
    // ==========================================

    // 1. Force-allow restricted events via Capture phase
    const restrictedEvents = ['contextmenu', 'copy', 'cut', 'paste', 'dragstart', 'drop'];
    restrictedEvents.forEach(eventName => {
        document.addEventListener(eventName, function(e) {
            e.stopPropagation();
        }, true); 
    });

    // 2. Clean up inline HTML blockers on DOM load
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('*').forEach(el => {
            ['oncontextmenu', 'ondragstart', 'oncopy', 'onpaste', 'ondrag', 'ondrop'].forEach(attr => {
                if (el.hasAttribute(attr)) el.removeAttribute(attr);
            });
        });

        if (typeof window.$ === 'function') {
            try {
                window.$('.form-text').unbind("cut copy paste contextmenu");
            } catch (e) {}
        }
        console.log("[Tampermonkey] Cleared all clipboard and right-click locks.");
    });

})();