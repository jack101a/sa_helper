// extension/modules/stall_automation.js
(function () {
    'use strict';

    const sendMessage = (message) => new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(message, resp => resolve(resp || null));
        } catch (_) {
            resolve(null);
        }
    });

    const getStorage = (keys) => new Promise(resolve => {
        try {
            chrome.storage.local.get(keys, resolve);
        } catch (_) {
            resolve({});
        }
    });

    const STEP4_STARTED_KEY = '_stall_step4_started_at';
    const STEP4_LOCK_KEY = '_stall_step4_lock_at';
    const STEP4_DONE_KEY = '_stall_step4_done_at';
    const STALL_FLOW_DONE_KEY = '_stall_flow_done_at';
    const STALL_LANGUAGE_DONE_KEY = '_stall_language_done_at';
    const STALL_COMPLETED_KEY = '_stall_completed_at';
    const STEP4_FALLBACK_DELAY_MS = 5000;
    const STEP4_LOCK_TTL_MS = 20000;

    function isStallRelatedUrl() {
        try {
            const url = new URL(location.href);
            if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
            const path = url.pathname.toLowerCase();
            return path === '/sarathiservice/authenticationaction.do'
                || path === '/sarathiservice/instruction.do'
                || path === '/sarathiservice/examselectaction.do'
                || path === '/sarathiservice/stallexam.do'
                || path === '/sarathiservice/stallloginsubmit.do';
        } catch (_) {
            return false;
        }
    }

    window.StallAutomation = {
        _timerId: null,
        _busy: false,
        _manualBusy: false,
        _step4Executing: false,
        _finishing: false,
        _lastActionAt: {},
        _loadStartedAt: 0,
        _pageWatcherTimer: null,
        _inputListenerInstalled: false,

        async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        async runConsoleAction(action) {
            const code = `return (function(){
                try {
                    ${action}
                } catch (e) {
                    return 'ERR:' + e.message;
                }
            })();`;
            return sendMessage({ type: 'SP_EXEC', code });
        },

        async runPageSequence(action) {
            const code = `return (async function(){
                const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                try {
                    ${action}
                } catch (e) {
                    console.error('[Automation] Page sequence error:', e);
                    return { ok: false, error: e.message || String(e) };
                }
            })();`;
            return sendMessage({ type: 'SP_EXEC', code });
        },

        async runExactContinueSnippet(source = 'watcher') {
            const guardKey = `__stall_continue_${source}_${location.pathname}`;
            if (window[guardKey]) return { ok: true, alreadyRan: true };
            const btn = document.querySelector('input[type="submit"][value="CONTINUE"]');
            if (!btn) return { ok: false, missing: true };
            window[guardKey] = true;
            console.log(`[Automation] Running Continue snippet via ${source}`);
            return this.runPageSequence(`
                const humanDelay = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
                await sleep(humanDelay(220, 620));
                (function() {
                    'use strict';
                    document.querySelector('input[type="submit"][value="CONTINUE"]').click();
                })();
                await sleep(humanDelay(260, 720));
                return { ok: true, clicked: true };
            `);
        },

        async runExactLanguageSnippet(source = 'watcher') {
            const guardKey = `__stall_language_${source}_${location.pathname}`;
            if (window[guardKey]) return { ok: true, alreadyRan: true };
            if (!document.getElementById('language')
                || !document.getElementById('subm')
                || !document.getElementsByName('disclaimer1')[0]
                || !document.getElementsByName('disclaimer2')[0]) {
                return { ok: false, missing: true };
            }
            window[guardKey] = true;
            console.log(`[Automation] Running Language snippet via ${source}`);
            return this.runPageSequence(`
                const humanDelay = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
                (function() {
                  'use strict';

                  const languageSelect = document.getElementById("language");
                  setTimeout(() => {
                    languageSelect.value = "HINDI";
                    languageSelect.dispatchEvent(new Event('change'));
                  }, humanDelay(180, 420));

                  ["disclaimer1", "disclaimer2"].forEach((name, index) => {
                    setTimeout(() => {
                      const checkbox = document.getElementsByName(name)[0];
                      checkbox.checked = true;
                      checkbox.dispatchEvent(new Event('click'));
                    }, humanDelay(430 + (index * 280), 760 + (index * 360)));
                  });

                  setTimeout(() => {
                    document.getElementById("subm").click();
                  }, humanDelay(1250, 1900));
                })();
                await sleep(2200);
                return { ok: true, clicked: true };
            `);
        },

        async completeFlow(source = 'local') {
            if (this._finishing === 'done') return;
            this._finishing = 'done';
            await chrome.storage.local.set({
                [STALL_LANGUAGE_DONE_KEY]: Date.now(),
                [STALL_COMPLETED_KEY]: Date.now()
            });
            await sendMessage({ type: 'UPDATE_STALL_STEP', step: 7 });
            console.log(`[Automation] STALL page automation completed via ${source}`);
            this.stop();
        },

        async runStallPageUserscriptWatcher() {
            const resp = await sendMessage({ type: 'GET_STALL_STATE' });
            if (!resp?.ok || !resp.state?.active) {
                this.stop();
                return;
            }
            if (Number(resp.state.step || 0) >= 7) {
                await this.completeFlow('watcher-state');
                return;
            }

            const url = location.href;
            if (url.includes('/sarathiservice/authenticationaction.do')) {
                const flowData = await chrome.storage.local.get([STALL_FLOW_DONE_KEY, STEP4_DONE_KEY, STALL_COMPLETED_KEY]);
                if (flowData[STALL_COMPLETED_KEY]) {
                    this.stop();
                    return;
                }
                if (!flowData[STALL_FLOW_DONE_KEY] && !flowData[STEP4_DONE_KEY]) return;
                const result = await this.runExactContinueSnippet('watcher');
                if (result?.ok !== false && result?.missing !== true) {
                    await sendMessage({ type: 'UPDATE_STALL_STEP', step: 6 });
                }
                return;
            }

            if (url.includes('/sarathiservice/instruction.do')) {
                const result = await this.runExactLanguageSnippet('watcher');
                if (result?.ok !== false && result?.missing !== true) {
                    await this.completeFlow('watcher-language');
                }
            }
        },

        async retry(label, fn, attempts = 3) {
            let lastResp = null;
            let lastErr = null;
            for (let i = 1; i <= attempts; i++) {
                try {
                    const resp = await fn();
                    if (resp?.ok !== false) return resp;
                    lastResp = resp;
                    lastErr = resp?.error || 'unknown error';
                } catch (e) {
                    lastErr = e?.message || String(e);
                }
                if (i < attempts) {
                    console.warn(`[Automation] ${label} failed (${i}/${attempts}):`, lastErr);
                    await this.sleep(400 * i);
                }
            }
            return lastResp || { ok: false, error: lastErr || `${label} failed` };
        },

        findInput(selectors) {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) return el;
            }
            return null;
        },

        readFieldValue(selectors) {
            const el = this.findInput(selectors);
            return el ? String(el.value || '').trim() : '';
        },

        async captureStepInputs() {
            const appNo = this.readFieldValue(['#llappln', '[name="llappln"]']);
            const captcha = this.readFieldValue(['#txtCaptcha', '#entcaptxt', '[name="entcaptxt"]']);
            const values = {};
            if (appNo) values._stall_appNo = appNo;
            if (captcha) values._stall_captcha = captcha;
            if (Object.keys(values).length) await chrome.storage.local.set(values);
            return { appNo, captcha };
        },

        readManualFields() {
            const appNo = this.readFieldValue(['#llappln', '[name="llappln"]']);
            const dob = this.readFieldValue(['#dob', '[name="dob"]']);
            const pwd = this.readFieldValue(['[name="pwd"]', '#pwd', 'input[type="password"]']);
            const captcha = this.readFieldValue(['#txtCaptcha', '#entcaptxt', '[name="entcaptxt"]']);
            return { appNo, dob, pwd, captcha };
        },

        validateManualFields(fields) {
            if (!fields.appNo || fields.appNo.length < 5) return 'Fill application number first.';
            if (!fields.captcha) return 'Fill captcha first.';
            return '';
        },

        setStartNowStatus(text, tone) {
            const status = document.getElementById('stall-start-now-status');
            if (!status) return;
            status.textContent = text || '';
            status.style.color = tone === 'error' ? '#b91c1c' : '#334155';
        },

        async hasStallAccess() {
            const data = await getStorage(['enabledServices']);
            const services = data.enabledServices && typeof data.enabledServices === 'object' && !Array.isArray(data.enabledServices)
                ? data.enabledServices
                : {};
            return services.stall !== false;
        },

        async hasSolverAccess() {
            const data = await getStorage(['solverEnabled', 'enabledServices']);
            const services = data.enabledServices && typeof data.enabledServices === 'object' && !Array.isArray(data.enabledServices)
                ? data.enabledServices
                : {};
            return data.solverEnabled !== false && services.solver !== false;
        },

        async ensureStartNowButton() {
            if (!location.href.includes('authenticationaction.do')) return;
            if (document.getElementById('stall-start-now-wrap')) return;
            if (!(await this.hasStallAccess())) return;

            const wrap = document.createElement('div');
            wrap.id = 'stall-start-now-wrap';
            wrap.style.cssText = [
                'position:fixed',
                'right:18px',
                'bottom:18px',
                'z-index:2147483647',
                'display:flex',
                'flex-direction:column',
                'gap:6px',
                'align-items:stretch',
                'font-family:Arial,sans-serif'
            ].join(';');

            const btn = document.createElement('button');
            btn.id = 'stall-start-now-btn';
            btn.type = 'button';
            btn.textContent = 'Start STALL';
            btn.style.cssText = [
                'border:0',
                'border-radius:999px',
                'padding:11px 18px',
                'font-size:13px',
                'font-weight:800',
                'cursor:pointer',
                'color:#fff',
                'letter-spacing:.02em',
                'background:linear-gradient(135deg,#0f766e,#2563eb)',
                'box-shadow:0 10px 24px rgba(15,23,42,.28)'
            ].join(';');

            const status = document.createElement('div');
            status.id = 'stall-start-now-status';
            status.style.cssText = [
                'max-width:220px',
                'min-height:18px',
                'padding:0 4px',
                'border-radius:6px',
                'font-size:12px',
                'font-weight:800',
                'line-height:1.3',
                'text-align:center',
                'color:#334155'
            ].join(';');
            status.textContent = '';

            btn.addEventListener('click', () => this.runManualStartNow());
            wrap.appendChild(btn);
            wrap.appendChild(status);
            (document.body || document.documentElement).appendChild(wrap);
        },

        async runManualStartNow() {
            if (this._manualBusy) return;
            this._manualBusy = true;
            const btn = document.getElementById('stall-start-now-btn');
            try {
                if (!(await this.hasStallAccess())) {
                    this.setStartNowStatus('disabled', 'error');
                    return;
                }
                const resp = await sendMessage({ type: 'GET_STALL_STATE' });
                if (!resp?.ok || !resp.state?.active) {
                    this.setStartNowStatus('failed', 'error');
                    return;
                }

                const fields = this.readManualFields();
                const error = this.validateManualFields(fields);
                if (error) {
                    this.setStartNowStatus('failed', 'error');
                    return;
                }

                await chrome.storage.local.set({
                    _stall_appNo: fields.appNo,
                    _stall_captcha: fields.captcha
                });
                await chrome.storage.local.remove([STEP4_STARTED_KEY, STEP4_LOCK_KEY, STEP4_DONE_KEY, STALL_FLOW_DONE_KEY, STALL_LANGUAGE_DONE_KEY, STALL_COMPLETED_KEY]);

                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'wait';
                    btn.style.opacity = '0.8';
                    btn.style.cursor = 'wait';
                }
                this.setStartNowStatus('wait', 'ok');
                await sendMessage({ type: 'UPDATE_STALL_STEP', step: 3 });
                const hasSolver = await this.hasSolverAccess();
                const flowResp = await this.executePayload(hasSolver ? 'stall-flow' : 'step3');
                if (flowResp?.ok === false) {
                    throw new Error(flowResp.error || 'STALL flow failed');
                }

                this.setStartNowStatus('wait', 'ok');
                if (hasSolver) {
                    await chrome.storage.local.set({
                        [STALL_FLOW_DONE_KEY]: Date.now(),
                        [STEP4_DONE_KEY]: Date.now()
                    });
                    await sendMessage({ type: 'UPDATE_STALL_STEP', step: 5 });
                }
            } catch (e) {
                console.error('[Automation] Start STALL error:', e);
                this.setStartNowStatus('failed', 'error');
            } finally {
                this._manualBusy = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Start STALL';
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            }
        },

        async executePayload(stepId) {
            const resp = await this.retry(`fetch ${stepId}`, () => sendMessage({ type: 'FETCH_STALL_PAYLOAD', stepId }));
            if (resp?.ok && resp.payload) {
                let payload = String(resp.payload || '');
                let wrappedPayload = '';
                try {
                    await this.captureStepInputs();
                    // Get saved credentials from storage
                    const data = await chrome.storage.local.get(['_stall_appNo', '_stall_captcha']);
                    const appNo = data._stall_appNo || '';
                    const captcha = data._stall_captcha || '';
                    const appNoLiteral = JSON.stringify(appNo);
                    const captchaLiteral = JSON.stringify(captcha);
                    
                    const prelude = `
                        var appNo = ${appNoLiteral};
                        var captcha = ${captchaLiteral};
                        var ensureField = function(name, id, value) {
                            var el = document.querySelector('[name="' + name + '"]') || (id ? document.getElementById(id) : null);
                            if (!el) {
                                el = document.createElement('input');
                                el.type = 'hidden';
                                el.name = name;
                                if (id) el.id = id;
                                (document.body || document.documentElement).appendChild(el);
                            }
                            if (value) {
                                el.value = value;
                                el.setAttribute('value', value);
                                try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
                                try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                            }
                            return el;
                        };
                        ensureField('llappln', 'llappln', appNo);
                        ensureField('entcaptxt', 'entcaptxt', captcha);
                        var visibleCaptcha = document.getElementById('txtCaptcha');
                        if (visibleCaptcha && captcha) {
                            visibleCaptcha.value = captcha;
                            visibleCaptcha.setAttribute('value', captcha);
                        }
                    `;

                    if (stepId === 'stall-flow') {
                        wrappedPayload = `return (async function(){
                            try {
                                ${prelude}
                                ${payload}
                            } catch (e) {
                                console.error('[Automation] Script Error:', e);
                                throw e;
                            }
                        })();`;
                    } else {
                        wrappedPayload = `(function(){
                        try {
                            ${prelude}
                            ${payload}
                        } catch (e) { console.error('[Automation] Script Error:', e); }
                    })()`;
                    }
                    return await this.retry(`execute ${stepId}`, () => sendMessage({ type: 'SP_EXEC', code: wrappedPayload }));
                } finally {
                    payload = '';
                    wrappedPayload = '';
                }
            }
            return resp;
        },

        async executeStep4Once(source = 'local') {
            if (!(await this.hasSolverAccess())) return { ok: false, error: 'Solver is not enabled for this API key.' };
            if (this._step4Executing) return { ok: true, alreadyRunning: true };

            const now = Date.now();
            const data = await chrome.storage.local.get([STEP4_DONE_KEY, STEP4_LOCK_KEY]);
            if (data[STEP4_DONE_KEY]) return { ok: true, alreadyDone: true };
            if (data[STEP4_LOCK_KEY] && now - Number(data[STEP4_LOCK_KEY]) < STEP4_LOCK_TTL_MS) {
                return { ok: true, alreadyRunning: true };
            }

            this._step4Executing = true;
            await chrome.storage.local.set({ [STEP4_LOCK_KEY]: now });
            try {
                console.log(`[Automation] Executing Step 4 via ${source}`);
                const resp = await this.executePayload('step4');
                if (resp?.ok !== false) {
                    await chrome.storage.local.set({ [STEP4_DONE_KEY]: Date.now() });
                    await sendMessage({ type: 'UPDATE_STALL_STEP', step: 5 });
                }
                return resp;
            } finally {
                this._step4Executing = false;
                await chrome.storage.local.remove(STEP4_LOCK_KEY);
            }
        },

        async maybeExecuteStep4Fallback(now) {
            if (this._step4Executing) return;
            if (!(await this.hasSolverAccess())) return;
            const data = await chrome.storage.local.get([STEP4_STARTED_KEY, STEP4_DONE_KEY]);
            if (data[STEP4_DONE_KEY]) return;

            let startedAt = Number(data[STEP4_STARTED_KEY] || 0);
            if (!startedAt) {
                startedAt = now;
                await chrome.storage.local.set({ [STEP4_STARTED_KEY]: startedAt });
            }
            if (now - startedAt < STEP4_FALLBACK_DELAY_MS) return;

            this.setStartNowStatus('Running Step 4...', 'ok');
            await this.executeStep4Once('local-fallback');
        },

        handlePopups() {
            try {
                const okButtons = [
                    ...document.querySelectorAll('button'),
                    ...document.querySelectorAll('input[type="button"]'),
                    ...document.querySelectorAll('.ui-button')
                ];
                for (const btn of okButtons) {
                    const txt = (btn.innerText || btn.value || '').toLowerCase();
                    if (['ok', 'close', 'agree', 'accept'].includes(txt)) {
                        if (btn.offsetParent !== null) btn.click();
                    }
                }
            } catch (_) {}
        },

        async tick() {
            if (this._busy) return;
            this._busy = true;
            try {
                const now = Date.now();
                if (!this._loadStartedAt) this._loadStartedAt = now;

                const resp = await sendMessage({ type: 'GET_STALL_STATE' });
                if (!resp?.ok || !resp.state?.active) {
                    this._loadStartedAt = 0;
                    this.stop();
                    return;
                }

                const { state } = resp;
                const url = location.href;

                if (Number(state.step || 0) >= 7) {
                    await this.completeFlow('tick-state');
                    return;
                }

                if (now - this._loadStartedAt < 3000) return; // Wait 3s

                this.handlePopups();
                this.ensureStartNowButton();

                if (state.step < 3 && url.includes('authenticationaction.do')) {
                    await this.captureStepInputs();
                    return;
                }

                // --- STEP 4: server payload, with local fallback for Android/Lemur missed messages ---
                if (state.step === 4) {
                    await this.maybeExecuteStep4Fallback(now);
                    return;
                }

                // --- STEP 5: Continue ---
                if (state.step === 5) {
                    if (url.includes('authenticationaction.do')) {
                        this.setStartNowStatus('Continuing to instructions...', 'ok');
                        const resp = await this.runExactContinueSnippet('step5');
                        if (resp?.ok !== false && resp?.missing !== true) {
                            await sendMessage({ type: 'UPDATE_STALL_STEP', step: 6 });
                        }
                    }
                    return;
                }

                // --- STEP 6: Language & Finish ---
                if (state.step === 6 && url.includes('instruction.do')) {
                    if (this._finishing) return;

                    const btn = document.getElementById('subm');
                    if (btn) {
                        this._finishing = true;
                        this.setStartNowStatus('Selecting Hindi and continuing...', 'ok');
                        const resp = await this.runExactLanguageSnippet('step6');
                        if (resp?.ok !== false && resp?.missing !== true) {
                            await this.completeFlow('step6-language');
                        } else {
                            this._finishing = false;
                        }
                    }
                    return;
                }

            } catch (e) {
                console.error('[Automation] Tick error:', e);
            } finally {
                this._busy = false;
            }
        },

        async start() {
            if (this._timerId) return;
            if (!isStallRelatedUrl()) return;
            this._loadStartedAt = Date.now();
            
            // Real-time listener to capture Application No and Captcha as user types
            if (!this._inputListenerInstalled) {
                document.addEventListener('input', (e) => {
                    const id = e.target.id;
                    const name = e.target.name;
                    if (id === 'llappln' || name === 'llappln') {
                        chrome.storage.local.set({ _stall_appNo: e.target.value });
                    } else if (id === 'txtCaptcha' || id === 'entcaptxt' || name === 'entcaptxt') {
                        chrome.storage.local.set({ _stall_captcha: e.target.value });
                    }
                });
                this._inputListenerInstalled = true;
            }

            this.tick();
            this._timerId = setInterval(() => this.tick(), 1000);
            this.runStallPageUserscriptWatcher();
            this._pageWatcherTimer = setInterval(() => this.runStallPageUserscriptWatcher(), 700);
        },

        stop() {
            if (this._timerId) {
                clearInterval(this._timerId);
                this._timerId = null;
            }
            if (this._pageWatcherTimer) {
                clearInterval(this._pageWatcherTimer);
                this._pageWatcherTimer = null;
            }
        },

        run() {
            this.start();
            chrome.runtime.onMessage.addListener((m) => {
                if (m.type === 'EXECUTE_STALL_STEP') this.tick();
            });
        }
    };
})();
