// ==UserScript==
// @name         Enable All Form Fields (for stall user)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Remove disabled and readonly from all inputs/selects/textareas
// @match        https://sarathi.parivahan.gov.in/*
// @tag          stall
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


    function start() {
        enableAll();
        const target = document.body || document.documentElement;
        if (!target) return;
        const observer = new MutationObserver(enableAll);
        observer.observe(target, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
