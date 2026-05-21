
// extension/modules/vcam_inject.js
// This script runs in the page context (MAIN world) to shim navigator.mediaDevices.getUserMedia.
// It allows us to stream custom images/video into the site's webcam feeds.

(function () {
    'use strict';

    if (window.__SARATHI_VCAM_INSTALLED__) return;
    window.__SARATHI_VCAM_INSTALLED__ = true;

    const VCAM_ID = 'sarathi-web-vcam';
    const VCAM_LABEL = 'Sarathi Virtual Camera';
    let VCAM_ENABLED = false;
    let VCAM_FPS = 15;
    let CURRENT_IMAGE = '';
    let ZOOM = 1.3;
    let FORCE_ALL = true;

    // Create a hidden canvas to draw our frames
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    let ctx = canvas.getContext('2d', { alpha: true });

    let img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    let drawTimer = null;
    let stream = null;

    function draw() {
        const ch = canvas.height;
        const cw = canvas.width;
        ctx.clearRect(0, 0, cw, ch);
        if (CURRENT_IMAGE && CURRENT_IMAGE.startsWith('data:image/')) {
            if (img.src !== CURRENT_IMAGE) img.src = CURRENT_IMAGE;
            if (img.complete && img.naturalWidth > 0) {
                const iw = img.naturalWidth, ih = img.naturalHeight;
                const scale = (ch / ih) * Math.max(0.25, Math.min(4, ZOOM));
                const dw = Math.max(1, Math.floor(iw * scale));
                const dh = ch;

                if (canvas.width !== dw) {
                    canvas.width = dw;
                    ctx = canvas.getContext('2d', { alpha: true });
                }

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, dw, dh);
            }
        }
    }

    function startLoop() {
        stopLoop();
        drawTimer = setInterval(draw, Math.floor(1000 / VCAM_FPS));
    }

    function stopLoop() {
        if (drawTimer) {
            clearInterval(drawTimer);
            drawTimer = null;
        }
    }

    function deactivateVcam() {
        stopLoop();
        if (stream) {
            try { stream.getTracks().forEach(track => track.stop()); } catch (e) {}
            stream = null;
        }
        if (audioTrack) {
            try { audioTrack.stop(); } catch (e) {}
            audioTrack = null;
        }
    }

    function getVcamStream() {
        if (!stream) {
            try {
                stream = canvas.captureStream(VCAM_FPS);
            } catch (e) {
                stream = canvas.captureStream();
            }
            startLoop();
            draw();
        }
        return stream;
    }

    // --- MediaDevices Shims ---

    const _enum = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
    if (_enum) {
        navigator.mediaDevices.enumerateDevices = function () {
            return _enum().then(list => {
                try {
                    if (!Array.isArray(list)) list = [];
                    if (VCAM_ENABLED) {
                        const vdev = { kind: 'videoinput', deviceId: VCAM_ID, groupId: VCAM_ID, label: VCAM_LABEL };
                        if (!list.some(d => (d.kind === 'videoinput') && (d.deviceId === VCAM_ID))) {
                            list.unshift(vdev);
                        }
                    }
                } catch (e) { }
                return list;
            });
        };
    }

    // Total Merge: Silent Audio Support
    let audioTrack = null;
    function ensureSilentAudioTrack() {
        if (audioTrack && audioTrack.readyState === 'live') return audioTrack;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            const ac = new AC({ sampleRate: 48000 });
            const dest = ac.createMediaStreamDestination();
            const osc = ac.createOscillator();
            const g = ac.createGain(); g.gain.value = 0;
            osc.connect(g).connect(dest); osc.start();
            audioTrack = dest.stream.getAudioTracks()[0] || null;
            return audioTrack;
        } catch (e) { return null; }
    }

    // Total Merge: Advanced Constraint Picker
    function pickDimsFrom(constraints) {
        try {
            const v = (constraints && (constraints.video === true ? {} : (constraints.video || {}))) || {};
            const num = x => (typeof x === 'number' && isFinite(x)) ? x : undefined;
            const w = num(v.width?.exact) ?? num(v.width?.ideal) ?? num(v.width);
            const h = num(v.height?.exact) ?? num(v.height?.ideal) ?? num(v.height);
            return { w, h };
        } catch { return { w: undefined, h: undefined }; }
    }

    const _gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (_gum) {
        navigator.mediaDevices.getUserMedia = function (constraints) {
            const v = constraints && constraints.video;
            const isRequested = v && (typeof v === 'object') && (v.deviceId === VCAM_ID || (v.deviceId && v.deviceId.exact === VCAM_ID));

            if (VCAM_ENABLED && (FORCE_ALL || isRequested || (v && !v.deviceId))) {
                console.log('[VCAM] Providing virtual stream (Total Merge Shim)');

                const dims = pickDimsFrom(constraints);
                if (dims.w) canvas.width = dims.w;
                if (dims.h) canvas.height = dims.h;

                const s = getVcamStream();

                if (constraints.audio) {
                    const at = ensureSilentAudioTrack();
                    if (at) s.addTrack(at);
                }

                return Promise.resolve(s);
            }
            return _gum(constraints);
        };
    }

    // Listen for state updates from the extension world
    window.addEventListener('message', e => {
        const d = e.data || {};
        if (d.__sp_vcam_state === true) {
            VCAM_ENABLED = !!d.enabled;
            VCAM_FPS = Number(d.fps || 15);
            if (typeof d.zoom === 'number' && isFinite(d.zoom)) {
                ZOOM = Math.max(0.25, Math.min(4, d.zoom));
            }
            if (typeof d.force === 'boolean') {
                FORCE_ALL = !!d.force;
            } else if (typeof d.forceAll === 'boolean') {
                FORCE_ALL = !!d.forceAll;
            }
            if (typeof d.image === 'string' && d.image.startsWith('data:image/')) {
                CURRENT_IMAGE = d.image;
            }
            if (!VCAM_ENABLED) {
                deactivateVcam();
            } else if (stream) {
                startLoop();
            } else {
                getVcamStream();
            }
            console.log('[VCAM] State updated:', { VCAM_ENABLED, VCAM_FPS, ZOOM, FORCE_ALL });
        } else if (d.__sp_vcam_toggle) {
            VCAM_ENABLED = !!d.enabled;
            if (!VCAM_ENABLED) {
                deactivateVcam();
            } else if (stream) {
                startLoop();
            } else {
                getVcamStream();
            }
        } else if (d.__sp_vcam_force) {
            FORCE_ALL = !!d.forceAll;
        } else if (d.__sp_vcam_frame) {
            if (typeof d.dataUrl === 'string' && d.dataUrl.startsWith('data:image/')) {
                CURRENT_IMAGE = d.dataUrl;
                if (stream) draw();
            }
        } else if (d.__sp_vcam_zoom) {
            const z = Number(d.zoom);
            if (isFinite(z)) {
                ZOOM = Math.max(0.25, Math.min(4, z));
                if (stream) draw();
            }
        }
    }, false);

    console.log('[VCAM] Virtual Camera Shim installed in MAIN world');
})();
