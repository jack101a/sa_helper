// ==UserScript==
// @name         Authentication Handler
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Handle authentication and WebSocket connections
// @author       You
// @match        *://*/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-sha256/0.9.0/sha256.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Your existing variables
    var socket;
    var serverToken;

    // Make functions global
    window.create_hs = create_hs;
    window.applStatus = applStatus;
    window.logout = logout;

    function create_hs(appl_no, authType) {
        var smartDiv = document.getElementById('smartLock');
        var faceAuth = document.getElementById('faceAuthReq');
        var proctorReq = document.getElementById('proctorReq');

        if(authType==='Anugyna') {
            socket = new WebSocket('ws://localhost:8000/');
            if (window.smartLogout) smartLogout.style.display = "block";
        }

        if(authType==="faceAuthReq") {
            if (window.faceAuthReq) faceAuthReq.style.display = "block";
            if (window.smartLogout) smartLogout.style.display = "none";
        }
        else if(authType!='Anugyna') {
            // Handle all other auth types
            handleAuthTypes(authType);

            // Hide all other elements
            hideAllElements();
        }

        // WebSocket event listeners
        setupWebSocketListeners(appl_no, authType);
    }

    function handleAuthTypes(authType) {
        const elements = {
            "NoExam": ["smartNoExam", "NoFaceAuthReq"],
            "completeFlow": ["smartcompleteFlow", "NoFaceAuthReq"],
            "scheduleDate": ["scheduleDate", "NoFaceAuthReq"],
            "NOfaceAuthReq": ["NoFaceAuthReq"],
            "bioAuth": ["NoFaceAuthReq"],
            "attemptMaxtimes": ["faceauthmaxtimeallowed", "NoFaceAuthReq"],
            "attemptMaxtimeDL": ["smartfaceauthmaxtimeallowedDL", "NoFaceAuthReq"],
            "attemptMaxtimeslot": ["faceauthmaxtimeallowedslot", "NoFaceAuthReq"],
            "alreadyCompleted": ["alreadyCompleted", "NoFaceAuthReq"],
            "expiredApplication": ["expiredApplication", "NoFaceAuthReq"],
            "photoUpload": ["smartphotoUpload", "NoFaceAuthReq"],
            "capturePhoto": ["capturePhoto", "NoFaceAuthReq"],
            "maxLogins": ["maxLogins", "NoFaceAuthReq"],
            "quotaFlag": ["quotaFlag", "NoFaceAuthReq"]
        };

        if (elements[authType]) {
            const [showElement, hideElement] = elements[authType];
            if (window[showElement]) window[showElement].style.display = "block";
            if (hideElement && window[hideElement]) window[hideElement].style.display = "none";
        }
    }

    function hideAllElements() {
        const elementsToHide = [
            'photoUpload', 'completeFlow', 'NoExam', 'faceauthmaxtimeallowedDL',
            'faceauthmaxtimeallowedslot', 'faceAuthReq', 'proctorReq'
        ];

        elementsToHide.forEach(element => {
            if (window[element]) window[element].style.display = "none";
        });

        if (window.smartLogout) smartLogout.style.display = "block";
    }

    function setupWebSocketListeners(appl_no, authType) {
        if (!socket) return;

        // Connection opened
        socket.addEventListener('open', function (ev) {
            if(authType==='Anugyna' && appl_no!=null) {
                var reqOb = {
                    type: "Authentication",
                    token: '1234',
                    userid: appl_no
                };
                serverToken = "12345";
                var request = JSON.stringify(reqOb);
                socket.send(request);

                var smartDiv = document.getElementById('smartLock');
                if (smartDiv) smartDiv.style.display = "none";
                sessionStorage.setItem('authType', 'Anugyna');
            }
        });

        // Listen for messages
        socket.addEventListener('message', function (event) {
            var res = JSON.parse(event.data);
            if (res['type'] == 'Authentication') {
                if (sha256(serverToken) == res['token_hash']) {
                    console.log({status: "success"}, "allSet");
                } else {
                    console.log({status: "failed"});
                }
            }
        });

        // Connection closed
        socket.addEventListener("close", function (event) {
            handleConnectionClose(authType, appl_no);
        });

        // Error handling
        socket.addEventListener("error", function (event) {
            handleConnectionError(authType, appl_no);
        });
    }

    function handleConnectionClose(authType, appl_no) {
        sessionStorage.clear();
        if(authType==='Anugyna' && appl_no==='12345') {
            var pname = window.location.pathname.split('/');
            var newurl = window.location.origin+"/"+pname[1]+"/403.jsp";
            // window.location.href = newurl;
        } else {
            resetAllDisplays();
        }
        console.log("disconnected!");
    }

    function handleConnectionError(authType, appl_no) {
        sessionStorage.clear();
        if(authType==='Anugyna' && appl_no==='12345') {
            var pname = window.location.pathname.split('/');
            var newurl = window.location.origin+"/"+pname[1]+"/403.jsp";
            // window.location.href = newurl;
        } else {
            resetAllDisplays();
        }
        console.log("some error occurred!");
    }

    function resetAllDisplays() {
        const elements = [
            'smartLock', 'faceAuthReq', 'proctorReq', 'smartLogout',
            'NoFaceAuthReq', 'maxLogins', 'capturePhoto', 'photoUpload',
            'alreadyCompleted', 'expiredApplication', 'faceauthmaxtimeallowedslot',
            'faceauthmaxtimeallowedDL', 'faceauthmaxtimeallowed', 'scheduleDate',
            'completeFlow', 'NoExam', 'smartphotoUpload', 'smartcompleteFlow',
            'smartNoExam', 'smartfaceauthmaxtimeallowedDL', 'smartfaceauthmaxtimeallowedslot',
            'faceAuthReq'
        ];

        elements.forEach(element => {
            if (window[element]) window[element].style.display = "none";
        });
    }

    function applStatus(url, slot, appl_no) {
        if (!socket) return;

        // Handle overloaded function signature
        if (arguments.length === 1) {
            url = arguments[0];
            slot = null;
            appl_no = document.forms["authentication"]?.llappln?.value;
        } else if (arguments.length === 2) {
            url = arguments[0];
            slot = arguments[1];
            appl_no = document.forms["authentication"]?.llappln?.value;
        }

        var newobj = {
            type: 'GenerateLicence',
            userid: appl_no
        };

        if(slot === "slots") {
            newobj.url = location.origin + "//" + url;
        } else {
            newobj.url = location.origin + location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1) + url;
        }

        var newrequest = JSON.stringify(newobj);

        setTimeout(() => {
            socket.send(newrequest);
        }, slot ? 1000 : 0);
    }

    function logout() {
        if (!socket) return;

        setTimeout(() => {
            socket.send('{"type":"LOGOUT"}');
        }, 1000);
    }
})();