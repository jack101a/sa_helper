// ==UserScript==
// @name         Sarathi Mock Test Looper
// @namespace    http://tampermonkey.net/
// @vrsion      1.0
// @description  Automates the navigation flow for the Sarathi LL Mock Test
// @author       You
// @match        https://sarathi.parivahan.gov.in/sarathiservice/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const currentURL = window.location.href;

    // STEP 1: If we are on the Home page, click the Mock Test link
    if (currentURL.includes("sarathiHomePublic.do")) {
        console.log("Sarathi Automator: On Home Page. Looking for Mock Test link...");

        // 2-second delay to let the page render properly
        setTimeout(() => {
            const links = document.querySelectorAll('a.dropdown-item');

            for (let link of links) {
                if (link.getAttribute('href') === 'stalllogin.do' && link.textContent.includes('Mock Test for LL')) {
                    console.log("Sarathi Automator: Link found! Clicking...");
                    // Remove target="_blank" so it opens in the same tab (prevents infinite tabs)
                    link.removeAttribute('target');
                    link.click();
                    break;
                }
            }
        }, 2000);
    }

    // STEP 2 & 3: If we reach the Exam Review page, start the flow again
    else if (currentURL.includes("examreview.do")) {
        console.log("Sarathi Automator: Reached Exam Review. Restarting flow in 3 seconds...");

        // 3-second delay before restarting to prevent overwhelming the server
        setTimeout(() => {
            window.location.href = "https://sarathi.parivahan.gov.in/sarathiservice/sarathiHomePublic.do";
        }, 3000);
    }

})();