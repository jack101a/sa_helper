// ==UserScript==
// @name         Enable All Form Fields (for stall user)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Remove disabled and readonly from all inputs/selects/textareas
// @match        https://sarathi.parivahan.gov.in/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function enableAll() {
        // disable हटाओ
        document.querySelectorAll("[disabled]").forEach(function (el) {
            el.removeAttribute("disabled");
        });

        // readonly हटाओ
        document.querySelectorAll("[readonly]").forEach(function (el) {
            el.removeAttribute("readonly");
        });
    }


    // dynamic AJAX से नया HTML आए तो भी apply हो जाए
    const observer = new MutationObserver(enableAll);
    observer.observe(document.body, { childList: true, subtree: true });
})();