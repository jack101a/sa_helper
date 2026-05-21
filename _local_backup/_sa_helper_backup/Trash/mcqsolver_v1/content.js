// ═══════════════════════════════════════════════════════════════
// content.js — Sarathi STALL Solver Main Engine
// Layers: Hash → OCR → LiteLLM fallback
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ─── CONFIG ─────────────────────────────────────────────
    const CFG = {
        POLL_MS:              500,
        HASH_SIZE:            32,
        MIN_Q_LEN:            8,
        MIN_OPT_LEN:          4,
        OPT_MATCH_NEED:       2,
        SUBMIT_POLL_MS:       200,
        SUBMIT_TIMEOUT:       25000,
        OCR_TIMEOUT:          15000,
        // Exam pass logic
        TOTAL_QUESTIONS:      15,
        REQUIRED_CORRECT:     11,
        MAX_WRONG:            4,
        // Answer timing (ms)
        MIN_ANSWER_DELAY:     10500,
        MAX_ANSWER_DELAY:     28000,
        // Auto-refresh: if question doesn't advance after this many ms, reload
        AUTO_REFRESH_TIMEOUT: 36000,
    };

    // ─── STATE ──────────────────────────────────────────────
    const state = {
        lastQSrc:         null,
        processing:       false,
        ocrReady:         false,
        ocrInitializing:  false,
        tesseractWorker:  null,
        solvedCount:      0,
        totalSeen:        0,
        // Pass/fail tracking
        correctCount:     0,
        wrongCount:       0,
        prevScore:        -1,
        questionStartTime: 0,
        // Feature flags (loaded from chrome.storage, toggled via popup)
        enabled:          true,
        autoRefresh:      true,
        // Auto-refresh watchdog
        refreshTimer:     null,
    };

    // ─── PANEL UI (Shadow DOM) ──────────────────────────────
    const PANEL_CSS = `
        :host { all: initial; }
        .panel {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 999999;
            width: 300px;
            background: rgba(15, 15, 25, 0.92);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(100, 220, 255, 0.2);
            border-radius: 12px;
            padding: 14px 16px;
            font-family: 'Segoe UI', 'Inter', system-ui, sans-serif;
            font-size: 12px;
            color: #c8d6e5;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5),
                        0 0 20px rgba(100, 220, 255, 0.08);
            pointer-events: none;
            user-select: text;
            line-height: 1.5;
        }
        .panel * { pointer-events: auto; }
        .header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(100, 220, 255, 0.12);
        }
        .logo {
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #64dcff;
            box-shadow: 0 0 8px rgba(100, 220, 255, 0.6);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        .title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            color: #64dcff;
        }
        .row {
            display: flex;
            justify-content: space-between;
            padding: 3px 0;
        }
        .label { color: #7f8fa6; font-size: 11px; }
        .value { color: #f5f6fa; font-weight: 600; font-size: 11px; }
        .status-idle   { color: #7f8fa6; }
        .status-work   { color: #feca57; }
        .status-ok     { color: #55efc4; }
        .status-fail   { color: #ff6b6b; }
        .result {
            margin-top: 8px;
            padding: 8px 10px;
            background: rgba(85, 239, 196, 0.08);
            border: 1px solid rgba(85, 239, 196, 0.2);
            border-radius: 8px;
            font-size: 11px;
            color: #55efc4;
            word-break: break-word;
            max-height: 60px;
            overflow-y: auto;
        }
        .result.empty {
            background: rgba(127, 143, 166, 0.06);
            border-color: rgba(127, 143, 166, 0.12);
            color: #7f8fa6;
        }
        .risk-safe     { color: #55efc4; }
        .risk-caution  { color: #feca57; }
        .risk-critical { color: #fd9644; }
        .risk-stop     { color: #ff6b6b; font-weight: 800; animation: pulse 0.8s infinite; }
        .correct-val   { color: #55efc4; }
        .wrong-val     { color: #ff6b6b; }
    `;

    let panelEls = {};

    function createPanel() {
        const host = document.createElement('div');
        host.id = '__mcq_solver_host__';
        const shadow = host.attachShadow({ mode: 'closed' });

        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        shadow.appendChild(style);

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="header">
                <div class="logo"></div>
                <div class="title">STALL Solver</div>
            </div>
            <div class="row">
                <span class="label">Question</span>
                <span class="value" id="pQ">—</span>
            </div>
            <div class="row">
                <span class="label">Timer</span>
                <span class="value" id="pTimer">—</span>
            </div>
            <div class="row">
                <span class="label">Score</span>
                <span class="value" id="pScore">—</span>
            </div>
            <div class="row">
                <span class="label">Correct / Wrong</span>
                <span class="value">
                    <span class="correct-val" id="pCorrect">0</span>
                    <span style="color:#7f8fa6"> / </span>
                    <span class="wrong-val" id="pWrong">0</span>
                </span>
            </div>
            <div class="row">
                <span class="label">Risk</span>
                <span class="value risk-safe" id="pRisk">Safe (W=0)</span>
            </div>
            <div class="row">
                <span class="label">Status</span>
                <span class="value status-idle" id="pStatus">Idle</span>
            </div>
            <div class="result empty" id="pResult">Waiting for question…</div>
            <button id="pToggle" style="
                margin-top: 8px; width: 100%; padding: 6px;
                border-radius: 6px; border: 1px solid rgba(255,107,107,0.3);
                background: rgba(255,107,107,0.12); color: #ff6b6b;
                font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px;
            ">Disable</button>
        `;
        shadow.appendChild(panel);
        document.documentElement.appendChild(host);

        panelEls = {
            q:         shadow.getElementById('pQ'),
            timer:     shadow.getElementById('pTimer'),
            score:     shadow.getElementById('pScore'),
            correct:   shadow.getElementById('pCorrect'),
            wrong:     shadow.getElementById('pWrong'),
            risk:      shadow.getElementById('pRisk'),
            status:    shadow.getElementById('pStatus'),
            result:    shadow.getElementById('pResult'),
            toggleBtn: shadow.getElementById('pToggle'),
        };

        // Panel toggle button handler
        panelEls.toggleBtn.addEventListener('click', () => {
            const next = !state.enabled;
            chrome.storage.local.set({ solverEnabled: next });
            applyEnabled(next);
        });
    }

    function updatePanel(data) {
        if (data.q       !== undefined) panelEls.q.textContent       = data.q;
        if (data.timer   !== undefined) panelEls.timer.textContent   = data.timer;
        if (data.score   !== undefined) panelEls.score.textContent   = data.score;
        if (data.correct !== undefined) panelEls.correct.textContent = data.correct;
        if (data.wrong   !== undefined) panelEls.wrong.textContent   = data.wrong;
        if (data.risk    !== undefined) {
            panelEls.risk.textContent = data.risk.text;
            panelEls.risk.className   = 'value ' + data.risk.cls;
        }
    }

    // ─── PASS / FAIL GUARDIAN ───────────────────────────────
    function parseScore() {
        const txt = document.querySelector('h3.text-success')?.innerText || '0';
        const m = txt.match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
    }

    function getRiskInfo(w) {
        if (w === 0) return { text: 'Safe (W=0)',     cls: 'risk-safe' };
        if (w === 1) return { text: 'Safe (W=1)',     cls: 'risk-safe' };
        if (w === 2) return { text: 'Safe (W=2)',     cls: 'risk-safe' };
        if (w === 3) return { text: 'Careful (W=3)',  cls: 'risk-caution' };
        if (w === 4) return { text: 'Critical (W=4)', cls: 'risk-critical' };
        return           { text: 'STOP! (W=' + w + ')', cls: 'risk-stop' };
    }

    function abortSession() {
        console.warn('[MCQ] ABORT — W>=5, passing is impossible. Exiting exam.');
        setStatus('ABORT — W>=5 FAIL', 'status-fail');
        setResult('❌ Cannot pass (5 wrong). Exiting in 3s…', false);
        // We run inside an iframe — must navigate the TOP window to kill the session.
        // window.location only moves the iframe. top.location moves the whole tab.
        let countdown = 3;
        const iv = setInterval(() => {
            countdown--;
            setResult(`❌ Cannot pass. Exiting in ${countdown}s…`, false);
            if (countdown <= 0) {
                clearInterval(iv);
                try {
                    top.location.href = 'https://www.google.com';
                } catch (e) {
                    // Fallback: send message to background to close/redirect the tab
                    chrome.runtime.sendMessage({ type: 'ABORT_TAB' });
                }
            }
        }, 1000);
    }

    function setStatus(text, cls) {
        panelEls.status.textContent = text;
        panelEls.status.className = 'value ' + (cls || 'status-idle');
    }

    function setResult(text, isMatch) {
        panelEls.result.textContent = text;
        panelEls.result.className = isMatch ? 'result' : 'result empty';
    }

    // ─── IMAGE HASHING (Layer 1) ────────────────────────────
    // DJB2-style hash: resize to 32x32, extract RGB, bitwise shift and add
    function hashImage(base64Src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const S = CFG.HASH_SIZE;
                    const c = document.createElement('canvas');
                    c.width = S; c.height = S;
                    const ctx = c.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, S, S);
                    const data = ctx.getImageData(0, 0, S, S).data;

                    let hash = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        hash = (hash << 5) - hash + data[i] + data[i+1] + data[i+2];
                        hash |= 0; // force to 32-bit signed integer
                    }
                    resolve(Math.abs(hash).toString(16));
                } catch (e) {
                    console.warn('[MCQ] hashImage error:', e);
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = base64Src;
        });
    }

    // ─── TEXT UTILS ──────────────────────────────────────────
    function cleanText(str) {
        if (!str) return '';
        return str
            .replace(/[\s\u200B-\u200D\uFEFF\u00A0]+/g, '')   // all whitespace
            .replace(/[।,.?!:;'"()[\]{}<>\/\\|@#$%^&*~`—–\-_=+]+/g, '') // punctuation
            .toLowerCase();
    }

    // Normalize Hindi text further for fuzzy matching
    function normalizeHindi(str) {
        return cleanText(str)
            .replace(/[ँंःऽ।॥]/g, '')    // Remove anusvara, visarga etc.
            .replace(/ो/g, 'ो')           // Normalize matras
            .replace(/\d+/g, '');          // Remove digits
    }

    // ─── DB SEARCH ──────────────────────────────────────────

    // Search by question text (substring containment)
    function searchByQuestion(ocrText) {
        const cleaned = cleanText(ocrText);
        if (cleaned.length < CFG.MIN_Q_LEN) return null;

        let best = null;
        let bestScore = 0;

        for (const entry of EXAM_DB) {
            const dbQ = cleanText(entry.question_text);
            if (!dbQ) continue;

            const shorter = cleaned.length < dbQ.length ? cleaned : dbQ;
            const longer  = cleaned.length >= dbQ.length ? cleaned : dbQ;

            if (longer.includes(shorter) && shorter.length > bestScore) {
                best = entry;
                bestScore = shorter.length;
            }
        }
        return best;
    }

    // Search by sign label (from hash dict)
    // Also attempts a partial match to handle naming discrepancies
    // e.g. hash dict has "sign_narrow_bridge" but DB uses "sign_narrow_bridge_ahead"
    function searchBySign(signLabel) {
        // 1. Exact match first
        for (const entry of EXAM_DB) {
            if (entry.question_sign_label === signLabel) return entry;
        }
        // 2. Partial / prefix match fallback
        for (const entry of EXAM_DB) {
            const dbLabel = entry.question_sign_label;
            if (!dbLabel) continue;
            if (dbLabel.startsWith(signLabel) || signLabel.startsWith(dbLabel)) return entry;
        }
        return null;
    }

    // Reverse-search: match by the unique combination of 4 option texts
    function searchByOptions(ocrOptions) {
        const cleanedOCR = ocrOptions.map(o => cleanText(o));

        let best = null;
        let bestCount = 0;

        for (const entry of EXAM_DB) {
            const dbOpts = [
                cleanText(entry.option_1),
                cleanText(entry.option_2),
                cleanText(entry.option_3),
                cleanText(entry.option_4),
            ];

            let matched = 0;
            for (const ocrOpt of cleanedOCR) {
                if (ocrOpt.length < CFG.MIN_OPT_LEN) continue;
                for (const dbOpt of dbOpts) {
                    if (dbOpt.length < CFG.MIN_OPT_LEN) continue;
                    const s = ocrOpt.length < dbOpt.length ? ocrOpt : dbOpt;
                    const l = ocrOpt.length >= dbOpt.length ? ocrOpt : dbOpt;
                    if (l.includes(s)) { matched++; break; }
                }
            }

            if (matched >= CFG.OPT_MATCH_NEED && matched > bestCount) {
                best = entry;
                bestCount = matched;
            }
        }
        return best;
    }

    // Combined fuzzy search with normalized Hindi
    function fuzzySearch(ocrText, ocrOptions) {
        const normQ = normalizeHindi(ocrText);
        if (normQ.length >= CFG.MIN_Q_LEN) {
            for (const entry of EXAM_DB) {
                const normDB = normalizeHindi(entry.question_text);
                if (!normDB) continue;
                const s = normQ.length < normDB.length ? normQ : normDB;
                const l = normQ.length >= normDB.length ? normQ : normDB;
                if (s.length >= CFG.MIN_Q_LEN && l.includes(s)) return entry;
            }
        }
        // Try option-based fuzzy
        if (ocrOptions && ocrOptions.length > 0) {
            const normOpts = ocrOptions.map(o => normalizeHindi(o));
            for (const entry of EXAM_DB) {
                const dbOpts = [
                    normalizeHindi(entry.option_1),
                    normalizeHindi(entry.option_2),
                    normalizeHindi(entry.option_3),
                    normalizeHindi(entry.option_4),
                ];
                let m = 0;
                for (const no of normOpts) {
                    if (no.length < CFG.MIN_OPT_LEN) continue;
                    for (const d of dbOpts) {
                        if (d.length < CFG.MIN_OPT_LEN) continue;
                        const ss = no.length < d.length ? no : d;
                        const ll = no.length >= d.length ? no : d;
                        if (ll.includes(ss)) { m++; break; }
                    }
                }
                if (m >= CFG.OPT_MATCH_NEED) return entry;
            }
        }
        return null;
    }

    // ─── OCR ENGINE (Layer 2) ───────────────────────────────
    // KEY INSIGHT: The Tampermonkey works because Tesseract v5 fetches the
    // worker JS + WASM from CDN (jsdelivr) — normal HTTPS, CORS-enabled.
    // A blob worker inherits the PAGE origin, not the extension's permissions,
    // so it CANNOT fetch chrome-extension:// URLs reliably.
    // FIX: Let worker/WASM come from CDN (no workerPath/corePath override),
    // only override langPath so traineddata comes from our local /assets/ folder.
    async function initOCR() {
        if (state.ocrReady || state.ocrInitializing) return state.ocrReady;
        if (typeof Tesseract === 'undefined') {
            console.warn('[MCQ] Tesseract.js not loaded — OCR layer disabled');
            return false;
        }
        state.ocrInitializing = true;
        try {
            // Only langPath is local — traineddata is fetched by the main thread
            // (not inside the blob worker), so chrome-extension:// access works fine.
            const langPath = chrome.runtime.getURL('assets/');

            // Exactly mirrors the Tampermonkey: createWorker('eng+hin')
            // Worker JS + WASM → CDN defaults. Traineddata → local assets/.
            state.tesseractWorker = await Tesseract.createWorker('eng+hin', 1, {
                langPath,
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setStatus(`OCR ${Math.round((m.progress || 0) * 100)}%`, 'status-work');
                    }
                }
            });
            state.ocrReady = true;
            console.log('[MCQ] Tesseract v5 OCR ready — worker:CDN, data:local');
        } catch (e) {
            console.error('[MCQ] OCR init failed:', e);
            state.ocrReady = false;
        }
        state.ocrInitializing = false;
        return state.ocrReady;
    }

    async function ocrImage(src) {
        // Accept both data: URIs and http(s): URLs — the portal may serve images either way
        if (!state.ocrReady || !src) return '';
        if (!src.startsWith('data:') && !src.startsWith('http')) return '';
        try {
            const result = await state.tesseractWorker.recognize(src);
            return result?.data?.text || '';
        } catch (e) {
            console.warn('[MCQ] OCR failed for image:', e);
            return '';
        }
    }

    // ─── LITELLM FALLBACK (Layer 3) ─────────────────────────
    function litellmFallback(qSrc, optionSrcs, questionText) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'LITELLM_SOLVE',
                    payload: { qImage: qSrc, optionImages: optionSrcs, questionText }
                },
                (resp) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (resp?.ok) resolve(resp.data);
                    else reject(new Error(resp?.error || 'Unknown LiteLLM error'));
                }
            );
        });
    }

    // ─── AUTO INTERACTION ───────────────────────────────────
    function highlightOption(optNum) {
        // Reset all highlights
        for (let i = 1; i <= 4; i++) {
            const el = document.getElementById('option' + i);
            if (el) {
                el.style.outline = '';
                el.style.boxShadow = '';
                el.style.backgroundColor = '';
            }
        }
        // Apply highlight to correct option
        const target = document.getElementById('option' + optNum);
        if (target) {
            target.style.outline = '3px solid #55efc4';
            target.style.boxShadow = '0 0 16px rgba(85, 239, 196, 0.4)';
            target.style.backgroundColor = 'rgba(85, 239, 196, 0.08)';
        }
    }

    function clickOption(optNum) {
        const radio = document.getElementById('stallradio' + optNum);
        if (radio) {
            radio.click();
            console.log('[MCQ] Clicked stallradio' + optNum);
            return true;
        }
        return false;
    }

    // waitAndSubmit: polls confirmbut until enabled, respecting a hard deadline.
    // deadline = absolute Date.now() timestamp after which we force-attempt submit.
    function waitAndSubmit(deadline) {
        const iv = setInterval(() => {
            const btn = document.getElementById('confirmbut');
            if (!btn) { clearInterval(iv); return; }

            const now = Date.now();

            if (!btn.disabled) {
                btn.click();
                console.log('[MCQ] Clicked confirmbut (enabled)');
                clearInterval(iv);
                return;
            }

            // Hard deadline: force-click even if still disabled to avoid timeout
            if (now >= deadline) {
                console.warn('[MCQ] Deadline reached — force-clicking confirmbut');
                btn.disabled = false;
                btn.click();
                clearInterval(iv);
                return;
            }

            // Overall safety timeout
            if (now > deadline + 3000) {
                console.warn('[MCQ] waitAndSubmit: gave up after deadline+3s');
                clearInterval(iv);
            }
        }, CFG.SUBMIT_POLL_MS);
    }

    // ─── DOM EXTRACTORS ─────────────────────────────────────
    function getQNum() {
        return document.querySelector('span.mytext1')?.innerText?.trim() || '?';
    }
    function getScore() {
        return document.querySelector('h3.text-success')?.innerText?.trim() || '—';
    }
    function getTimer() {
        return document.getElementById('timer')?.innerText?.trim() || '—';
    }
    function getQImage() {
        return document.querySelector('img[name="qframe"]')?.src || null;
    }
    function getOptionImages() {
        return [
            document.getElementById('choice1')?.src || null,
            document.getElementById('choice2')?.src || null,
            document.getElementById('choice3')?.src || null,
            document.getElementById('choice4')?.src || null,
        ];
    }

    // ─── SOLVER PIPELINE ────────────────────────────────────
    async function solve(qSrc, optionSrcs) {
        // ───────── LAYER 1: Image Hash (~5ms) ─────────────
        setStatus('Hashing…', 'status-work');
        const t0 = performance.now();
        const hash = await hashImage(qSrc);
        const hashMs = Math.round(performance.now() - t0);

        if (hash) {
            // Log hash so user can populate SIGN_HASH_DICT
            console.log(`[MCQ] Q# ${getQNum()} | Hash: ${hash} | ${hashMs}ms`);
            chrome.runtime.sendMessage({ type: 'LOG_HASH', hash, qNum: getQNum() });

            if (typeof SIGN_HASH_DICT !== 'undefined' && SIGN_HASH_DICT[hash]) {
                const signLabel = SIGN_HASH_DICT[hash];
                const match = searchBySign(signLabel);
                if (match) {
                    return { match, layer: 'Hash', time: hashMs, detail: signLabel };
                }
            }
        }

        // ───────── LAYER 2: OCR + DB Search (~800ms) ──────
        setStatus('OCR…', 'status-work');
        if (await initOCR()) {
            const t1 = performance.now();

            // OCR question image
            const qText = await ocrImage(qSrc);
            console.log('[MCQ] OCR Q:', qText?.substring(0, 80));

            // Try question text match
            let match = searchByQuestion(qText);
            if (match) {
                return { match, layer: 'OCR-Q', time: Math.round(performance.now() - t1), detail: qText?.substring(0, 40) };
            }

            // OCR all option images
            const optTexts = [];
            for (let i = 0; i < optionSrcs.length; i++) {
                if (optionSrcs[i] && optionSrcs[i].startsWith('data:')) {
                    setStatus(`OCR Opt ${i + 1}…`, 'status-work');
                    const txt = await ocrImage(optionSrcs[i]);
                    optTexts.push(txt);
                    console.log(`[MCQ] OCR Opt${i + 1}:`, txt?.substring(0, 40));
                } else {
                    optTexts.push('');
                }
            }

            // Reverse-search by option texts
            match = searchByOptions(optTexts);
            if (match) {
                return { match, layer: 'OCR-Opt', time: Math.round(performance.now() - t1), detail: 'Reverse option match' };
            }

            // Fuzzy Hindi search
            match = fuzzySearch(qText, optTexts);
            if (match) {
                return { match, layer: 'OCR-Fuzzy', time: Math.round(performance.now() - t1), detail: 'Fuzzy match' };
            }
        }

        // ───────── LAYER 3: LiteLLM Fallback ─────────────
        // Pass the OCR'd question text so the AI has more context
        setStatus('AI Fallback…', 'status-work');
        let ocrQuestionText = '';
        if (state.ocrReady) {
            try { ocrQuestionText = await ocrImage(qSrc); } catch (_) {}
        }
        try {
            const t2 = performance.now();
            const aiResult = await litellmFallback(qSrc, optionSrcs, ocrQuestionText);
            if (aiResult?.optionNumber) {
                return {
                    match: { correct_option_number: aiResult.optionNumber, correct_answer_target: `AI: Option ${aiResult.optionNumber}` },
                    layer: 'AI',
                    time: Math.round(performance.now() - t2),
                    detail: aiResult.raw
                };
            }
        } catch (e) {
            console.warn('[MCQ] LiteLLM fallback failed:', e.message);
        }

        return null; // No match found
    }

    // ─── MAIN LOOP (500ms) ──────────────────────────────────
    async function mainLoop() {
        // Update live readouts every tick
        updatePanel({
            q:     getQNum(),
            timer: getTimer(),
            score: getScore(),
        });

        // Detect new question
        const qSrc = getQImage();
        if (!state.enabled) return;                               // solver disabled via popup
        if (!qSrc || qSrc === state.lastQSrc || state.processing) return;

        // ── Score reconciliation: did the PREVIOUS question pass or fail? ──
        // We check only after at least one question has been seen (prevScore is set).
        if (state.prevScore >= 0 && state.totalSeen > 0) {
            const currentScore = parseScore();
            if (currentScore > state.prevScore) {
                state.correctCount++;
            } else {
                state.wrongCount++;
            }
            console.log(`[MCQ] Reconcile Q${state.totalSeen}: score ${state.prevScore}→${currentScore} | C=${state.correctCount} W=${state.wrongCount}`);
        }
        // Snapshot score at the start of this new question
        state.prevScore = parseScore();

        // ── Pass/Fail Guardian ──────────────────────────────────────────
        const risk = getRiskInfo(state.wrongCount);
        updatePanel({
            correct: state.correctCount,
            wrong:   state.wrongCount,
            risk,
        });

        if (state.wrongCount > CFG.MAX_WRONG) {
            abortSession();
            return;
        }

        // ── New question setup ──────────────────────────────────────────
        state.lastQSrc          = qSrc;
        state.processing        = true;
        state.totalSeen++;
        state.questionStartTime = Date.now();

        // Arm auto-refresh watchdog: if page doesn't advance, reload
        armRefreshWatchdog(qSrc);

        const optionSrcs = getOptionImages();
        setStatus('Solving…', 'status-work');
        setResult('Processing question…', false);

        try {
            const result = await solve(qSrc, optionSrcs);

            if (result && result.match) {
                const optNum = result.match.correct_option_number;
                const answer = result.match.correct_answer_target || `Option ${optNum}`;
                state.solvedCount++;

                setStatus(`✓ ${result.layer} (${result.time}ms)`, 'status-ok');
                setResult(`[${result.layer}] Opt ${optNum}: ${answer}`, true);
                console.log(`[MCQ] ✓ Solved via ${result.layer} in ${result.time}ms → Option ${optNum}`);

                // ── Timing Gate: never interact before MIN_ANSWER_DELAY ──────
                // Site's loadAnsTimer() also blocks confirmbut for 10s, but we
                // enforce this independently so we never click the radio button early.
                const elapsed = Date.now() - state.questionStartTime;
                if (elapsed < CFG.MIN_ANSWER_DELAY) {
                    const waitMs = CFG.MIN_ANSWER_DELAY - elapsed;
                    console.log(`[MCQ] Timing gate: waiting ${waitMs}ms before interacting`);
                    await new Promise(r => setTimeout(r, waitMs));
                }

                // Hard deadline: must submit by MAX_ANSWER_DELAY
                const deadline = state.questionStartTime + CFG.MAX_ANSWER_DELAY;

                highlightOption(optNum);
                clickOption(optNum);
                waitAndSubmit(deadline);
            } else {
                setStatus('✗ No Match', 'status-fail');
                setResult('No match found in DB or AI.', false);
                console.log('[MCQ] ✗ No match for Q#', getQNum());
                // No interaction = question will time out and be marked wrong.
                // wrongCount will be incremented on the next question load via reconciliation.
            }
        } catch (err) {
            setStatus('✗ Error', 'status-fail');
            setResult('Error: ' + err.message, false);
            console.error('[MCQ] Solver error:', err);
        }

        updatePanel({ correct: state.correctCount, wrong: state.wrongCount });
        state.processing = false;
    }


    // ─── BOOTSTRAP ──────────────────────────────────────────
    function applyEnabled(val) {
        state.enabled = val;
        if (val) {
            setStatus('Ready', 'status-idle');
            setResult('Solver enabled — waiting for question…', false);
        } else {
            setStatus('Disabled', 'status-idle');
            setResult('Solver is OFF — use the popup to enable.', false);
        }
        // Update panel toggle button label
        if (panelEls.toggleBtn) {
            panelEls.toggleBtn.textContent = val ? 'Disable' : 'Enable';
            panelEls.toggleBtn.style.background = val
                ? 'rgba(255,107,107,0.15)'
                : 'rgba(85,239,196,0.15)';
            panelEls.toggleBtn.style.color = val ? '#ff6b6b' : '#55efc4';
            panelEls.toggleBtn.style.borderColor = val
                ? 'rgba(255,107,107,0.3)'
                : 'rgba(85,239,196,0.3)';
        }
    }

    function armRefreshWatchdog(qSrc) {
        if (state.refreshTimer) clearTimeout(state.refreshTimer);
        if (!state.autoRefresh) return;
        state.refreshTimer = setTimeout(() => {
            // If the same question is still showing after timeout, reload
            if (getQImage() === qSrc) {
                console.warn('[MCQ] Auto-refresh: question stuck, reloading page');
                window.location.reload();
            }
        }, CFG.AUTO_REFRESH_TIMEOUT);
    }

    // ── Seed state from current page (extension loaded mid-exam) ──
    // If the exam is already in progress (Q5, Q11, etc.), initialise
    // correctCount/wrongCount from the live score + question number
    // so the pass/fail guardian has accurate data immediately.
    function seedStateFromPage() {
        const currentScore = parseScore();           // e.g. 5
        const qNumText     = getQNum();              // e.g. "11"
        const currentQ     = parseInt(qNumText, 10);

        if (!isNaN(currentQ) && currentQ > 1) {
            const answered       = currentQ - 1;    // questions already submitted
            state.correctCount   = Math.min(currentScore, answered);
            state.wrongCount     = answered - state.correctCount;
            state.prevScore      = currentScore;    // baseline for next reconcile
            state.totalSeen      = answered;

            console.log(`[MCQ] Seeded from page: Q${currentQ} | Score=${currentScore} | C=${state.correctCount} W=${state.wrongCount}`);

            // Immediately update risk display
            const risk = getRiskInfo(state.wrongCount);
            updatePanel({ correct: state.correctCount, wrong: state.wrongCount, risk });

            // Abort right away if already at W>=5 when extension loads
            if (state.wrongCount > CFG.MAX_WRONG) {
                abortSession();
            }
        }
    }

    function boot() {
        console.log('[MCQ] STALL Solver v1.1 loaded');
        console.log('[MCQ] DB entries:', typeof EXAM_DB !== 'undefined' ? EXAM_DB.length : 'NOT LOADED');
        createPanel();
        seedStateFromPage();

        // ── Load persisted settings ──────────────────────────
        chrome.storage.local.get(['solverEnabled', 'autoRefresh'], (data) => {
            state.enabled     = data.solverEnabled !== false; // default ON
            state.autoRefresh = data.autoRefresh   !== false; // default ON
            applyEnabled(state.enabled);
        });

        // ── Listen for popup toggle messages ─────────────────
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === 'SET_ENABLED') {
                applyEnabled(msg.enabled);
            }
            if (msg.type === 'SET_AUTO_REFRESH') {
                state.autoRefresh = msg.autoRefresh;
                if (!msg.autoRefresh && state.refreshTimer) {
                    clearTimeout(state.refreshTimer);
                    state.refreshTimer = null;
                }
            }
        });

        // ── Poll loop ────────────────────────────────────────
        setInterval(mainLoop, CFG.POLL_MS);

        // Pre-init OCR in background (non-blocking)
        setTimeout(() => initOCR(), 2000);
    }

    // ── Only boot inside the exam iframe (stallexamaction.do) ──
    // With all_frames:true the script runs everywhere, so guard it.
    const EXAM_URL_PATTERN = /stallexamaction/i;
    if (!EXAM_URL_PATTERN.test(window.location.href)) {
        // Not the exam iframe — do nothing
        return;
    }

    // Wait for page readiness then boot
    if (document.readyState === 'complete') {
        boot();
    } else {
        window.addEventListener('load', boot);
    }
})();
