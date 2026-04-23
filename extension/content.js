// content.js — Unified Platform Extension
// Three autonomous modules: CaptchaModule, ExamModule, AutofillModule
// Each detects its own trigger condition and acts independently.

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // SHARED UTILITIES
    // ═══════════════════════════════════════════════════════════════════════

    function getStorage(keys) {
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }

    function imgToB64(imgEl) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width  = imgEl.naturalWidth  || imgEl.width  || 200;
            canvas.height = imgEl.naturalHeight || imgEl.height || 60;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        } catch (_) { return null; }
    }

    function sendMsg(type, payload) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage({ type, ...payload }, resolve);
        });
    }

    function rndInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async function humanMouse(el) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + rndInt(5, Math.max(6, r.width  - 5));
        const cy = r.top  + rndInt(3, Math.max(4, r.height - 3));
        const o  = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        el.dispatchEvent(new MouseEvent('mouseover',  o));
        await new Promise(r => setTimeout(r, rndInt(60, 180)));
        el.dispatchEvent(new MouseEvent('mousemove',  o));
        await new Promise(r => setTimeout(r, rndInt(40, 120)));
        el.dispatchEvent(new MouseEvent('mouseenter', o));
        await new Promise(r => setTimeout(r, rndInt(30, 90)));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODULE 1 — TEXT CAPTCHA
    // Detects <img> + <input> captcha pairs and auto-fills the answer.
    // ═══════════════════════════════════════════════════════════════════════

    const CaptchaModule = (() => {
        let _active = false;
        let _lastSolved = '';

        function findCaptchaPair() {
            // Common patterns: image near text input
            const imgs = [...document.querySelectorAll('img')].filter(img => {
                const src  = img.src || '';
                const w    = img.naturalWidth  || img.width;
                const h    = img.naturalHeight || img.height;
                return (w > 40 && w < 400 && h > 20 && h < 100) &&
                       (src.includes('captcha') || src.includes('verify') ||
                        src.includes('code') || img.id?.toLowerCase().includes('captcha') ||
                        img.className?.toLowerCase().includes('captcha'));
            });
            for (const img of imgs) {
                // Find nearest text input
                const parent = img.closest('form, div, td, tr') || document.body;
                const inp = parent.querySelector(
                    'input[type="text"], input[type="tel"], input:not([type])'
                );
                if (inp) return { img, inp };
            }
            return null;
        }

        async function solve(img, inp) {
            const b64 = imgToB64(img);
            if (!b64) return;
            const key = b64.slice(0, 60);
            if (key === _lastSolved) return;
            _lastSolved = key;

            const domain = window.location.hostname;
            const resp = await sendMsg('SOLVE_CAPTCHA', { imageB64: b64, domain });
            if (!resp?.ok) return;

            await humanMouse(inp);
            inp.focus();
            inp.value = resp.result;
            inp.dispatchEvent(new Event('input',  { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`[Captcha] Solved: "${resp.result}" in ${resp.ms}ms`);
        }

        function tick() {
            if (!_active) return;
            const pair = findCaptchaPair();
            if (pair) solve(pair.img, pair.inp);
        }

        return {
            activate() { _active = true; setInterval(tick, 2000); console.log('[Captcha] Module active'); },
            deactivate() { _active = false; },
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════
    // MODULE 2 — EXAM SOLVER (Sarathi STALL)
    // Only activates on stallexamaction.do — everything else returns early.
    // ═══════════════════════════════════════════════════════════════════════

    const ExamModule = (() => {
        const CFG = {
            POLL_MS:           500,
            TOTAL_QUESTIONS:   15,
            REQUIRED_CORRECT:  9,
            MAX_WRONG:         6,
            ABORT_MIN_Q:       14,
            CLICK_MIN:         12000,
            CLICK_MAX:         19000,
            DEADLINE:          29000,
            SUBMIT_POLL:       300,
            AUTO_REFRESH:      36000,
        };

        const state = {
            lastQSrc:      null,
            processing:    false,
            correctCount:  0,
            wrongCount:    0,
            prevScore:     -1,
            totalSeen:     0,
            examComplete:  false,
            questionStart: 0,
            refreshTimer:  null,
            enabled:       true,
        };

        // ── Panel UI ──────────────────────────────────────────────────────

        let panelEls = null;

        function createPanel() {
            const host = document.createElement('div');
            host.id = 'mcq-panel-host';
            document.documentElement.appendChild(host);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `
            <style>
                *{box-sizing:border-box;font-family:'Segoe UI',sans-serif}
                #panel{position:fixed;bottom:16px;right:16px;width:240px;background:#111827;
                    border:1px solid #374151;border-radius:12px;padding:12px;z-index:2147483647;
                    color:#f3f4f6;font-size:12px;box-shadow:0 4px 24px rgba(0,0,0,.6)}
                h3{margin:0 0 8px;font-size:13px;color:#10b981;letter-spacing:.5px}
                .row{display:flex;justify-content:space-between;margin:3px 0;color:#9ca3af}
                .row span:last-child{color:#f3f4f6;font-weight:600}
                #status{margin-top:8px;padding:6px 8px;border-radius:6px;background:#1f2937;font-size:11px;color:#6ee7b7}
                #result{margin-top:4px;font-size:10px;color:#9ca3af;min-height:14px}
                .ok{color:#6ee7b7}.work{color:#fbbf24}.fail{color:#f87171}.idle{color:#9ca3af}
            </style>
            <div id="panel">
                <h3>🎯 STALL Solver</h3>
                <div class="row"><span>Question</span><span id="q">?</span></div>
                <div class="row"><span>Timer</span><span id="timer">—</span></div>
                <div class="row"><span>Score</span><span id="score">—</span></div>
                <div class="row"><span>C / W</span><span id="cw">0 / 0</span></div>
                <div class="row"><span>Risk</span><span id="risk">Safe</span></div>
                <div id="status" class="idle">Ready</div>
                <div id="result"></div>
            </div>`;
            panelEls = {
                q:      shadow.getElementById('q'),
                timer:  shadow.getElementById('timer'),
                score:  shadow.getElementById('score'),
                cw:     shadow.getElementById('cw'),
                risk:   shadow.getElementById('risk'),
                status: shadow.getElementById('status'),
                result: shadow.getElementById('result'),
            };
        }

        function setStatus(text, cls = 'idle') {
            if (!panelEls) return;
            panelEls.status.textContent = text;
            panelEls.status.className   = cls;
        }
        function setResult(text) {
            if (!panelEls) return;
            panelEls.result.textContent = text;
        }

        // ── DOM helpers ───────────────────────────────────────────────────
        const getQNum  = () => document.querySelector('span.mytext1')?.innerText?.trim() || '?';
        const getTimer = () => document.getElementById('timer')?.innerText?.trim()       || '—';
        const getScore = () => document.getElementById('score')?.innerText?.trim()       || '—';
        const getQImage  = () => document.querySelector('img[name="qframe"]')?.src       || null;
        const getOptImgs = () => [1,2,3,4].map(i => {
            const el = document.getElementById('choice' + i);
            return el ? (el.src || null) : null;
        }).filter(Boolean);
        const parseScore = () => parseFloat(getScore()) || 0;

        function updatePanel() {
            if (!panelEls) return;
            panelEls.q.textContent     = getQNum();
            panelEls.timer.textContent = getTimer();
            panelEls.score.textContent = getScore();
            panelEls.cw.textContent    = `${state.correctCount} / ${state.wrongCount}`;
            const canPass = (15 - state.wrongCount) + state.correctCount >= CFG.REQUIRED_CORRECT;
            panelEls.risk.textContent  = state.wrongCount > CFG.MAX_WRONG ? 'FAIL!' :
                                         state.wrongCount >= 4              ? 'Warning' : 'Safe';
        }

        function seedFromPage() {
            const qNum = parseInt(getQNum(), 10);
            const sc   = parseScore();
            if (!isNaN(qNum) && qNum > 1) {
                const answered     = qNum - 1;
                state.correctCount = Math.min(sc, answered);
                state.wrongCount   = answered - state.correctCount;
                state.prevScore    = sc;
                state.totalSeen    = answered;
                updatePanel();
                if (state.wrongCount > CFG.MAX_WRONG) abortSession();
            }
        }

        function abortSession() {
            setStatus('ABORT — W>=7 FAIL', 'fail');
            setResult('❌ Cannot pass. Exiting in 3s…');
            let c = 3;
            const iv = setInterval(() => {
                c--;
                setResult(`❌ Cannot pass. Exiting in ${c}s…`);
                if (c <= 0) {
                    clearInterval(iv);
                    try { top.location.href = 'https://www.google.com'; }
                    catch (_) { chrome.runtime.sendMessage({ type: 'ABORT_TAB' }); }
                }
            }, 1000);
        }

        function armWatchdog(qSrc) {
            if (!state.enabled) return;
            if (state.refreshTimer) clearTimeout(state.refreshTimer);
            state.refreshTimer = setTimeout(() => {
                if (getQImage() === qSrc) window.location.reload();
            }, CFG.AUTO_REFRESH);
        }

        async function clickOption(optNum) {
            const radio = document.getElementById('stallradio' + optNum);
            if (!radio) return false;
            await humanMouse(radio);
            radio.click();
            return true;
        }

        function waitAndSubmit(deadline, isLast) {
            const iv = setInterval(async () => {
                const btn = document.getElementById('confirmbut');
                if (!btn) { clearInterval(iv); return; }
                const doSubmit = async () => {
                    clearInterval(iv);
                    await humanMouse(btn);
                    await new Promise(r => setTimeout(r, rndInt(80, 300)));
                    btn.disabled = false;
                    btn.click();
                    if (isLast) {
                        state.examComplete = true;
                        if (state.refreshTimer) clearTimeout(state.refreshTimer);
                        watchForResult();
                    }
                };
                if (!btn.disabled) { await doSubmit(); return; }
                if (Date.now() >= deadline) { await doSubmit(); return; }
                if (Date.now() > deadline + 3000) clearInterval(iv);
            }, CFG.SUBMIT_POLL);
        }

        function watchForResult() {
            setStatus('Exam Done ✓', 'ok');
            const iv = setInterval(() => {
                try {
                    const text = (document.body?.innerText || '') + ' ' + (top.document.body?.innerText || '');
                    if (/congratulations|you have passed|licence generated/i.test(text)) {
                        clearInterval(iv);
                        setStatus('🎉 PASSED!', 'ok');
                        setTimeout(() => chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }), 2500);
                    }
                } catch (_) {}
            }, 1000);
            setTimeout(() => clearInterval(iv), 180000);
        }

        async function mainLoop() {
            updatePanel();
            if (!state.enabled || state.examComplete) return;
            const qSrc = getQImage();
            if (!qSrc || qSrc === state.lastQSrc || state.processing) return;

            // Score reconciliation
            if (state.prevScore >= 0 && state.totalSeen > 0) {
                const curr = parseScore();
                if (curr > state.prevScore) state.correctCount++;
                else state.wrongCount++;
            }
            state.prevScore = parseScore();

            updatePanel();
            const currentQ = parseInt(getQNum(), 10) || 0;
            if (state.wrongCount > CFG.MAX_WRONG && currentQ >= CFG.ABORT_MIN_Q) {
                abortSession(); return;
            }

            state.lastQSrc     = qSrc;
            state.processing   = true;
            state.totalSeen++;
            state.questionStart = Date.now();
            armWatchdog(qSrc);

            const optImgs = getOptImgs();
            setStatus('Solving…', 'work');

            try {
                const optB64s = optImgs.map(src => {
                    // If src is an absolute URL the backend can fetch it,
                    // otherwise capture via canvas
                    return src.startsWith('data:') ? src : src;
                });

                const resp = await sendMsg('SOLVE_EXAM', {
                    questionB64: qSrc,
                    optionB64s:  optB64s,
                    domain:      window.location.hostname,
                });

                if (resp?.ok && resp.data?.option_number) {
                    const optNum = resp.data.option_number;
                    setStatus(`✓ ${resp.data.method} (${resp.data.processing_ms}ms)`, 'ok');
                    setResult(`Option ${optNum}: ${resp.data.answer_text || ''}`);

                    // Human-like timing gate
                    const delay = rndInt(CFG.CLICK_MIN, CFG.CLICK_MAX);
                    const elapsed = Date.now() - state.questionStart;
                    if (elapsed < delay) await new Promise(r => setTimeout(r, delay - elapsed));

                    const isLast = state.totalSeen >= CFG.TOTAL_QUESTIONS;
                    const deadline = state.questionStart + CFG.DEADLINE;

                    await clickOption(optNum);
                    waitAndSubmit(deadline, isLast);
                } else {
                    setStatus('✗ No Match', 'fail');
                    setResult(resp?.error || 'No answer found — question will time out');
                }
            } catch (err) {
                setStatus('✗ Error', 'fail');
                setResult(err.message);
            }

            state.processing = false;
        }

        return {
            activate() {
                if (!/stallexamaction/i.test(window.location.href)) return;
                createPanel();
                getStorage(['solverEnabled', 'autoRefresh']).then(d => {
                    state.enabled = d.solverEnabled !== false;
                });
                seedFromPage();
                setInterval(mainLoop, CFG.POLL_MS);
                console.log('[Exam] Module active');
            },
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════
    // MODULE 3 — AUTOFILL
    // Detects forms and fills them using server-resolved field mappings.
    // ═══════════════════════════════════════════════════════════════════════

    const AutofillModule = (() => {
        let _active = false;
        let _filled = new WeakSet();

        function collectFields() {
            const inputs = document.querySelectorAll(
                'input[type="text"], input[type="email"], input[type="tel"], ' +
                'input[type="date"], input[type="number"], input:not([type]), ' +
                'textarea, select'
            );
            const out = [];
            for (const inp of inputs) {
                if (_filled.has(inp)) continue;
                if (inp.value?.trim()) continue; // already has a value
                const id    = inp.id || '';
                const name  = inp.name || '';
                const label = (
                    document.querySelector(`label[for="${id}"]`)?.innerText ||
                    inp.placeholder || inp.getAttribute('aria-label') || name || id
                ).trim();
                if (!label) continue;
                // Use the most stable selector available
                const sel = id ? `#${id}` : (name ? `[name="${name}"]` : null);
                if (sel) out.push({ selector: sel, label });
            }
            return out;
        }

        async function fill() {
            const { autofillEnabled, profileData } = await getStorage(['autofillEnabled', 'profileData']);
            if (!autofillEnabled) return;
            const profile = profileData || {};
            if (!Object.keys(profile).length) return;

            const fields = collectFields();
            if (!fields.length) return;

            const domain = window.location.hostname;
            const resp   = await sendMsg('AUTOFILL_FILL', { domain, fields, profileData: profile });
            if (!resp?.ok || !resp.fills?.length) return;

            for (const { selector, value } of resp.fills) {
                try {
                    const el = document.querySelector(selector);
                    if (!el || el.value?.trim()) continue;
                    await humanMouse(el);
                    el.focus();
                    el.value = value;
                    el.dispatchEvent(new Event('input',  { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.blur();
                    _filled.add(el);
                } catch (_) {}
            }
            console.log(`[Autofill] Filled ${resp.fills.length} fields on ${domain}`);
        }

        return {
            activate() {
                _active = true;
                // Fill on page load
                if (document.readyState === 'complete') fill();
                else window.addEventListener('load', fill);
                // Observe DOM for dynamically injected forms
                new MutationObserver(() => { if (_active) fill(); })
                    .observe(document.body, { childList: true, subtree: true });
                console.log('[Autofill] Module active');
            },
            deactivate() { _active = false; },
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════
    // BOOT — decide which modules to activate on this page
    // ═══════════════════════════════════════════════════════════════════════

    async function boot() {
        const { solverEnabled, autofillEnabled, captchaEnabled } = await getStorage([
            'solverEnabled', 'autofillEnabled', 'captchaEnabled'
        ]);

        // Exam module — Sarathi STALL iframe only
        if (solverEnabled !== false) {
            ExamModule.activate();
        }

        // Captcha module — any page with text captcha image
        if (captchaEnabled !== false) {
            CaptchaModule.activate();
        }

        // Autofill module — any page with a form
        if (autofillEnabled !== false) {
            AutofillModule.activate();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
