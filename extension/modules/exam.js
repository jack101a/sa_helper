// extension/modules/exam.js
(function () {
    'use strict';

    window.ExamModule = (() => {
        const CFG = {
            POLL_MS:           500,
            TOTAL_QUESTIONS:   15,
            REQUIRED_CORRECT:  9,
            MAX_WRONG:         6,
            ABORT_MIN_Q:       14,   // only abort if failing is certain at the very end
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
            enabled:       true,
            learningEnabled: true,
            lastSolve:     null,  // { questionB64, optionB64s, selectedOption, method, processingMs }
            pendingChecked: false,
        };

        let panelEls = null;
        const PENDING_FEEDBACK_KEY = 'examPendingFeedback';

        function createPanel() {
            if (document.getElementById('mcq-panel-host')) return;
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

        const getQNum  = () => document.querySelector('span.mytext1')?.innerText?.trim() || '?';
        const getTimer = () => document.getElementById('timer')?.innerText?.trim()       || '—';
        const getScore = () => {
            const el = document.getElementById('score');
            if (el && el.innerText.trim()) return el.innerText.trim();
            const alt = document.querySelector('h3.text-success');
            return alt ? alt.innerText.trim() : '—';
        };
        const getQImageEl = () => document.querySelector('img[name="qframe"]') || null;
        const getQImage  = () => getQImageEl()?.src || null;
        const getOptImgEls = () => [1,2,3,4].map(i => document.getElementById('choice' + i)).filter(Boolean);
        const parseScore = () => {
            const txt = getScore();
            const m = txt.match(/\d+/);
            return m ? parseInt(m[0], 10) : 0;
        };

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

        async function clickOption(optNum) {
            const radio = document.getElementById('stallradio' + optNum);
            if (!radio) return false;
            await window.up_humanMouse(radio);
            radio.click();
            return true;
        }

        function imageToPayload(imgEl) {
            if (!imgEl) return null;
            if (typeof window.up_imgToB64 === 'function') {
                const dataUrl = window.up_imgToB64(imgEl);
                if (dataUrl) return dataUrl;
            }
            const src = imgEl.src || '';
            return src.startsWith('data:image/') ? src : null;
        }

        function waitAndSubmit(deadline, isLast) {
            const iv = setInterval(async () => {
                const btn = document.getElementById('confirmbut');
                if (!btn) { clearInterval(iv); return; }
                const doSubmit = async () => {
                    clearInterval(iv);
                    await window.up_humanMouse(btn);
                    btn.disabled = false;
                    btn.click();
                    if (isLast) {
                        state.examComplete = true;
                        watchForResult();
                    }
                };
                if (!btn.disabled || Date.now() >= deadline) { await doSubmit(); return; }
            }, CFG.SUBMIT_POLL);
        }

        function watchForResult() {
            if (state._watching) return;
            state._watching = true;
            setStatus('Exam Done ✓', 'ok');
            const iv = setInterval(() => {
                try {
                    let text = document.body?.innerText || '';
                    try {
                        if (top.location.origin === window.location.origin) {
                            text += ' ' + (top.document.body?.innerText || '');
                        }
                    } catch (_) {}

                    // Precise matching based on user screenshot
                    const pass = /congratulations you have passed|licence generated successfully|your license number is/i.test(text);
                    if (pass) {
                        clearInterval(iv);
                        setStatus('🎉 PASSED!', 'ok');
                        setTimeout(() => {
                            console.log('[Exam] Triggering screenshot');
                            chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });
                        }, 2500);
                    }
                } catch (_) {}
            }, 1000);
            setTimeout(() => {
                clearInterval(iv);
                state._watching = false;
            }, 180000);
        }

        function sendFeedback(wasCorrect) {
            if (!state.learningEnabled || !state.lastSolve) return;
            const payload = {
                type: 'EXAM_FEEDBACK',
                questionB64: state.lastSolve.questionB64,
                optionB64s:  state.lastSolve.optionB64s,
                selectedOption: state.lastSolve.selectedOption,
                wasCorrect:  wasCorrect,
                method:      state.lastSolve.method,
                processingMs: state.lastSolve.processingMs,
                domain:      window.location.hostname,
                questionNum: state.totalSeen,
            };
            try {
                window.up_sendMsg('EXAM_FEEDBACK', payload).then(resp => {
                    if (resp?.ok) {
                        console.log('[Exam] Feedback recorded:', wasCorrect ? 'CORRECT' : 'WRONG', resp.data);
                    } else {
                        console.warn('[Exam] Feedback failed:', resp?.error || 'No response');
                    }
                });
            } catch (e) {
                console.warn('[Exam] Feedback failed:', e.message);
            }
            state.lastSolve = null; // Clear after sending
        }

        async function storePendingFeedback(solveData) {
            if (!state.learningEnabled || !solveData) return;
            try {
                await chrome.storage.local.set({
                    [PENDING_FEEDBACK_KEY]: {
                        ...solveData,
                        scoreBefore: state.prevScore,
                        questionNum: state.totalSeen,
                        createdAt: Date.now(),
                    }
                });
            } catch (e) {
                console.warn('[Exam] Pending feedback save failed:', e.message);
            }
        }

        async function checkPendingFeedback() {
            if (state.pendingChecked || !state.learningEnabled) return;
            state.pendingChecked = true;
            try {
                const data = await window.up_getStorage([PENDING_FEEDBACK_KEY]);
                const pending = data[PENDING_FEEDBACK_KEY];
                if (!pending || !pending.questionB64 || !pending.selectedOption) return;

                const qNum = parseInt(getQNum(), 10) || 0;
                if (qNum && pending.questionNum && qNum <= pending.questionNum) {
                    state.pendingChecked = false;
                    return;
                }

                const scoreBefore = Number.isFinite(Number(pending.scoreBefore)) ? Number(pending.scoreBefore) : 0;
                const currScore = parseScore();
                const wasCorrect = currScore > scoreBefore;
                state.lastSolve = pending;
                sendFeedback(wasCorrect);
                await chrome.storage.local.remove(PENDING_FEEDBACK_KEY);
            } catch (e) {
                console.warn('[Exam] Pending feedback check failed:', e.message);
            }
        }

        async function mainLoop() {
            const qSrc = getQImage();
            
            // Lazy create panel only when a question image is actually found
            if (!panelEls && qSrc) {
                createPanel();
            }

            updatePanel();
            if (!state.enabled || state.examComplete) return;

            if (!qSrc || qSrc === state.lastQSrc || state.processing) return;

            await checkPendingFeedback();

            if (state.prevScore >= 0 && state.totalSeen > 0) {
                const curr = parseScore();
                if (curr > state.prevScore) {
                    state.correctCount++;
                    // Send feedback: answer was CORRECT
                    sendFeedback(true);
                } else {
                    state.wrongCount++;
                    // Send feedback: answer was WRONG
                    sendFeedback(false);
                }
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

            setStatus('Solving…', 'work');

            try {
                const questionPayload = imageToPayload(getQImageEl());
                const optImgs = getOptImgEls().map(imageToPayload).filter(Boolean);
                if (!questionPayload || optImgs.length < 2) {
                    setStatus('Waiting for images...', 'work');
                    state.processing = false;
                    return;
                }
                
                // Solve with a 20-second timeout. If it takes longer, we'll click randomly.
                const solvePromise = window.up_sendMsg('SOLVE_EXAM', {
                    questionB64: questionPayload,
                    optionB64s:  optImgs,
                    domain:      window.location.hostname,
                });

                const timeout = new Promise(r => setTimeout(() => r({ ok: false, error: 'TIMEOUT_29S' }), 28500));
                const resp = await Promise.race([solvePromise, timeout]);

                if (resp?.ok && resp.data?.option_number) {
                    const optNum = resp.data.option_number;
                    setStatus(`✓ ${resp.data.method} (${resp.data.processing_ms}ms)`, 'ok');
                    setResult(`Option ${optNum}: ${resp.data.answer_text || ''}`);

                    // Store for feedback when score is checked next cycle
                    state.lastSolve = {
                        questionB64: questionPayload,
                        optionB64s:  optImgs,
                        selectedOption: optNum,
                        method:      resp.data.method,
                        processingMs: resp.data.processing_ms,
                    };
                    await storePendingFeedback(state.lastSolve);

                    const delay = window.up_rndInt(CFG.CLICK_MIN, CFG.CLICK_MAX);
                    const elapsed = Date.now() - state.questionStart;
                    if (elapsed < delay) await new Promise(r => setTimeout(r, delay - elapsed));

                    const isLast = state.totalSeen >= CFG.TOTAL_QUESTIONS;
                    const deadline = state.questionStart + CFG.DEADLINE;

                    await clickOption(optNum);
                    waitAndSubmit(deadline, isLast);
                } else {
                    // ── Improved error handling ──────────────────────────
                    const errMsg = resp?.error || '';
                    const isTimeout = errMsg === 'TIMEOUT_29S';

                    // Auth / config errors — show clear message, don't interact
                    if (/no api key|api key invalid|unauthorized|forbidden|blocked|inactive|payment pending/i.test(errMsg)) {
                        setStatus('⚙️ Setup Needed', 'fail');
                        setResult('API key not configured or invalid. Open extension popup → enter key.');
                        state.processing = false;
                        return;
                    }

                    // Network errors — skip this question, don't click random
                    if (/network|fetch|failed to fetch|timeout/i.test(errMsg) && !isTimeout) {
                        setStatus('🌐 Network Error', 'fail');
                        setResult('Cannot reach server. Check your connection.');
                        state.processing = false;
                        return;
                    }

                    // FALLBACK: Pick random option at the very last second (29s)
                    
                    // If we got "No Match" early, we MUST wait until 29s before clicking random
                    if (!isTimeout) {
                        const now = Date.now();
                        const targetTime = state.questionStart + 29000;
                        const waitTime = targetTime - now;
                        if (waitTime > 0) {
                            setStatus('✗ No Match (Wait 29s)', 'fail');
                            await new Promise(r => setTimeout(r, waitTime));
                        }
                    }

                    const optCount = optImgs.length || 3;
                    const randomOpt = window.up_rndInt(1, optCount);
                    
                    setStatus(isTimeout ? '⏰ Time Limit!' : '✗ Random Fallback', 'fail');
                    setResult(`${isTimeout ? '29s reached.' : 'No result.'} Picking random: ${randomOpt}`);
                    
                    // Store for feedback (random fallback — likely wrong, but track anyway)
                    state.lastSolve = {
                        questionB64: questionPayload,
                        optionB64s:  optImgs,
                        selectedOption: randomOpt,
                        method:      isTimeout ? 'timeout' : 'random_fallback',
                        processingMs: 0,
                    };
                    await storePendingFeedback(state.lastSolve);
                    
                    const isLast = state.totalSeen >= CFG.TOTAL_QUESTIONS;
                    await clickOption(randomOpt);
                    waitAndSubmit(Date.now(), isLast);
                }
            } catch (err) {
                setStatus('✗ Error', 'fail');
                setResult(err.message);
            }
            state.processing = false;
        }

        return {
            activate() {
                const isExam = /stallexamaction|examselectaction/i.test(window.location.href);
                if (!isExam) return;
                // createPanel() is now called lazily in mainLoop()
                window.up_getStorage(['solverEnabled', 'learningEnabled']).then(d => {
                    state.enabled = d.solverEnabled !== false;
                    state.learningEnabled = d.learningEnabled !== false;
                });
                seedFromPage();
                setInterval(mainLoop, CFG.POLL_MS);
                console.log('[Exam] Module active (lazy UI)');
            },

        };
    })();

})();
