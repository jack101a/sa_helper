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

    window.StallAutomation = {
        _timerId: null,
        _busy: false,
        _manualBusy: false,
        _finishing: false,
        _lastActionAt: {},
        _loadStartedAt: 0,

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
            status.style.color = tone === 'error' ? '#fecaca' : tone === 'ok' ? '#bbf7d0' : '#e0f2fe';
        },

        ensureStartNowButton() {
            if (!location.href.includes('authenticationaction.do')) return;
            if (document.getElementById('stall-start-now-wrap')) return;

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
            btn.textContent = 'Start Now';
            btn.style.cssText = [
                'border:0',
                'border-radius:8px',
                'padding:10px 16px',
                'font-size:14px',
                'font-weight:700',
                'cursor:pointer',
                'color:#fff',
                'background:#2563eb',
                'box-shadow:0 6px 18px rgba(0,0,0,.25)'
            ].join(';');

            const status = document.createElement('div');
            status.id = 'stall-start-now-status';
            status.style.cssText = [
                'max-width:220px',
                'padding:6px 8px',
                'border-radius:6px',
                'font-size:11px',
                'line-height:1.3',
                'color:#e0f2fe',
                'background:rgba(15,23,42,.92)',
                'box-shadow:0 4px 14px rgba(0,0,0,.2)'
            ].join(';');
            status.textContent = 'Fill details, then click Start Now.';

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
                const resp = await sendMessage({ type: 'GET_STALL_STATE' });
                if (!resp?.ok || !resp.state?.active) {
                    this.setStartNowStatus('STALL session is not active.', 'error');
                    return;
                }

                const fields = this.readManualFields();
                const error = this.validateManualFields(fields);
                if (error) {
                    this.setStartNowStatus(error, 'error');
                    return;
                }

                await chrome.storage.local.set({
                    _stall_appNo: fields.appNo,
                    _stall_captcha: fields.captcha
                });

                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Running...';
                    btn.style.opacity = '0.8';
                    btn.style.cursor = 'wait';
                }
                this.setStartNowStatus('Running Step 3...', 'ok');
                await sendMessage({ type: 'UPDATE_STALL_STEP', step: 3 });
                await this.executePayload('step3');

                this.setStartNowStatus('Waiting 5 seconds for Step 4...', 'ok');
                await sendMessage({ type: 'UPDATE_STALL_STEP', step: 4 });
            } catch (e) {
                console.error('[Automation] Start Now error:', e);
                this.setStartNowStatus('Start Now failed. Check console.', 'error');
            } finally {
                this._manualBusy = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Start Now';
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
            }
        },

        async executePayload(stepId) {
            const resp = await sendMessage({ type: 'FETCH_STALL_PAYLOAD', stepId });
            if (resp?.ok && resp.payload) {
                await this.captureStepInputs();
                // Get saved credentials from storage
                const data = await chrome.storage.local.get(['_stall_appNo', '_stall_captcha']);
                const appNo = data._stall_appNo || '';
                const captcha = data._stall_captcha || '';
                const appNoLiteral = JSON.stringify(appNo);
                const captchaLiteral = JSON.stringify(captcha);
                
                const wrappedPayload = `(function(){
                    try {
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
                        ${resp.payload}
                    } catch (e) { console.error('[Automation] Script Error:', e); }
                })()`;
                return sendMessage({ type: 'SP_EXEC', code: wrappedPayload });
            }
            return resp;
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

                if (now - this._loadStartedAt < 3000) return; // Wait 3s

                this.handlePopups();
                this.ensureStartNowButton();

                if (state.step < 3 && url.includes('authenticationaction.do')) {
                    await this.captureStepInputs();
                    return;
                }

                // --- STEP 5: Continue ---
                if (state.step === 5) {
                    if (url.includes('authenticationaction.do')) {
                        const btn = document.querySelector('input[value="CONTINUE"]');
                        if (btn) {
                            await this.runConsoleAction(`
                                if (typeof validateExamSelection === 'function') validateExamSelection();
                                var b = document.querySelector('input[value="CONTINUE"]');
                                if (b) b.click();
                            `);
                            await sendMessage({ type: 'UPDATE_STALL_STEP', step: 6 });
                        }
                    }
                    return;
                }

                // --- STEP 6: Language & Finish ---
                if (state.step === 6 && (url.includes('ExamDisclaimer') || url.includes('examSelection'))) {
                    if (this._finishing) return;

                    const btn = document.getElementById('subm');
                    if (btn) {
                        this._finishing = true;
                        this.setStartNowStatus('Finishing...', 'ok');
                        await this.runConsoleAction(`
                            const langSelect = document.getElementById("language");
                            if (langSelect) {
                                langSelect.value = "HINDI";
                                langSelect.dispatchEvent(new Event("change", { bubbles: true }));
                            }

                            const d1 = document.querySelector('input[name="disclaimer1"]');
                            const d2 = document.querySelector('input[name="disclaimer2"]');
                            const b = document.getElementById('subm');

                            [d1, d2].forEach(el => {
                                if (el) {
                                    el.checked = true;
                                    el.dispatchEvent(new Event('click', { bubbles: true }));
                                }
                            });

                            if (b) {
                                setTimeout(() => b.click(), 500);
                            }
                        `);
                        await sendMessage({ type: 'UPDATE_STALL_STEP', step: 7 });
                    }
                    return;
                }

            } catch (e) {
                console.error('[Automation] Tick error:', e);
            } finally {
                this._busy = false;
            }
        },

        start() {
            if (this._timerId) return;
            this._loadStartedAt = Date.now();
            
            // Real-time listener to capture Application No and Captcha as user types
            document.addEventListener('input', (e) => {
                const id = e.target.id;
                const name = e.target.name;
                if (id === 'llappln' || name === 'llappln') {
                    chrome.storage.local.set({ _stall_appNo: e.target.value });
                } else if (id === 'txtCaptcha' || id === 'entcaptxt' || name === 'entcaptxt') {
                    chrome.storage.local.set({ _stall_captcha: e.target.value });
                }
            });

            this.tick();
            this._timerId = setInterval(() => this.tick(), 1000);
        },

        stop() {
            if (this._timerId) {
                clearInterval(this._timerId);
                this._timerId = null;
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
