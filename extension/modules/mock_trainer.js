// extension/modules/mock_trainer.js
(function () {
    'use strict';

    window.MockTrainerModule = (() => {
        const MOCK_EXAM_PATH = /\/sarathiservice\/stallexam\.do/i;
        const MOCK_LOGIN_PATH = /\/sarathiservice\/stallLoginSubmit\.do/i;
        const CFG = {
            POLL_MS: 900,
            PARSE_RETRY_MS: 250,
            PARSE_TIMEOUT_MS: 3500,
            SUBMIT_DELAY_MIN: 500,
            SUBMIT_DELAY_MAX: 1100,
            DEFAULT_NAME: 'darshan',
            DEFAULT_DOB: '01-02-2003',
            DEFAULT_LANGUAGE: 'HINDI',
            DEFAULT_STATE: 'MH',
            MIN_OPTIONS: 3,
        };

        let interval = null;
        let processing = false;
        let lastQuestionKey = '';
        let loginSubmitted = false;

        function isSarathiHost() {
            return location.hostname === 'sarathi.parivahan.gov.in';
        }

        function hasLoginFormDom() {
            return !!(
                document.getElementById('stallLoginSubmit_ApplicantName')
                && document.getElementById('dob')
                && document.getElementById('sel')
                && document.getElementById('mockstate')
            );
        }

        function hasMockQuestionDom() {
            return !!(
                (getQImageEl() || getQuestionText().length > 0)
                && getOptionSlots().length >= CFG.MIN_OPTIONS
            );
        }

        function isMockPage() {
            return isSarathiHost() && (
                MOCK_LOGIN_PATH.test(location.pathname)
                || MOCK_EXAM_PATH.test(location.pathname)
                || hasLoginFormDom()
                || hasMockQuestionDom()
            );
        }

        function isMockExamPage() {
            return isSarathiHost() && (MOCK_EXAM_PATH.test(location.pathname) || hasMockQuestionDom());
        }

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        function setValue(el, value) {
            if (!el) return false;
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
            return true;
        }

        function getQNum() {
            const hidden = parseInt(document.getElementById('examform_sno')?.value || '', 10);
            if (Number.isFinite(hidden) && hidden > 0) return hidden;
            const text = document.querySelector('span.mytext1')?.innerText || '';
            const match = text.match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
        }

        function getQImageEl() {
            return document.querySelector('img[name="qframe"]');
        }

        function getQuestionText() {
            const selectors = [
                '.question-text',
                'td.quesText',
                '#questionDiv',
                '.qtext',
                'td[class*="ques"]',
                '.ques',
                '[id*="question"]'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                const txt = (el?.innerText || '').trim();
                if (txt.length > 4) return txt;
            }
            return '';
        }

        function getOptionSlots() {
            const slots = [];
            for (let i = 1; i <= 4; i++) {
                const radio = getRadio(i);
                if (!radio) continue;
                const byLabel = radio.id ? document.querySelector(`label[for="${radio.id}"]`) : null;
                const byLab = document.getElementById('lab' + i);
                const container = byLab
                    || byLabel
                    || radio.closest('tr')
                    || radio.closest('li')
                    || radio.closest('.option')
                    || radio.closest('.answer')
                    || radio.parentElement;
                slots.push({ option: i, radio, container });
            }
            return slots;
        }

        function getOptionImageEls() {
            const byChoice = [1, 2, 3, 4].map(i =>
                document.getElementById('choice' + i)
                || document.querySelector(`img[name="choice${i}"]`)
            ).filter(Boolean);
            if (byChoice.length >= CFG.MIN_OPTIONS) return byChoice;
            const slots = getOptionSlots();
            return slots.map(slot => slot.container?.querySelector('img')).filter(Boolean);
        }

        function imageToPayload(imgEl) {
            if (!imgEl || typeof window.up_imgToB64 !== 'function') return null;
            const dataUrl = window.up_imgToB64(imgEl);
            return dataUrl || null;
        }

        function textToPayload(text, prefix = '') {
            const clean = String(text || '').replace(/\s+/g, ' ').trim();
            if (!clean) return null;
            const canvas = document.createElement('canvas');
            canvas.width = 900;
            canvas.height = 120;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#111';
            ctx.font = '20px Arial';
            const textLine = `${prefix}${clean}`.slice(0, 180);
            ctx.fillText(textLine, 12, 68);
            return canvas.toDataURL('image/png');
        }

        function getRadio(option) {
            return document.getElementById('stallradio' + option)
                || document.getElementById('radio' + option + option)
                || document.querySelector(`input[type="radio"][value="${option}"]`);
        }

        function getSubmitButton() {
            return document.getElementById('examform_confirm')
                || document.getElementById('confirmbut')
                || document.getElementById('submitbut')
                || document.getElementById('nextbut')
                || document.querySelector('button[type="submit"], input[type="submit"], input[type="button"]');
        }

        async function clickCorrectAndSubmit(option) {
            const radio = getRadio(option);
            if (radio) {
                if (typeof window.up_humanMouse === 'function') await window.up_humanMouse(radio);
                radio.disabled = false;
                radio.click();
                radio.checked = true;
                radio.dispatchEvent(new Event('input', { bubbles: true }));
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await sleep(window.up_rndInt ? window.up_rndInt(CFG.SUBMIT_DELAY_MIN, CFG.SUBMIT_DELAY_MAX) : 750);
            const btn = getSubmitButton();
            if (btn) {
                if (typeof window.up_humanMouse === 'function') await window.up_humanMouse(btn);
                btn.disabled = false;
                btn.click();
            }
        }

        async function parseTeacherAnswer() {
            const deadline = Date.now() + CFG.PARSE_TIMEOUT_MS;
            let last = { ok: false, option: null, reason: 'not_started' };
            while (Date.now() < deadline) {
                last = await window.up_sendMsg('MOCK_PARSE_SHOW_ANSWER');
                if (last?.ok && last.option) return last;
                await sleep(CFG.PARSE_RETRY_MS);
            }
            return last || { ok: false, option: null, reason: 'parse_timeout' };
        }

        async function trainCurrentQuestion() {
            const qImg = getQImageEl();
            const qText = getQuestionText();
            const slots = getOptionSlots();
            if (slots.length < CFG.MIN_OPTIONS) {
                console.log(`[MockTrainer] waiting: less than ${CFG.MIN_OPTIONS} option slots`);
                return;
            }

            const qPayload = imageToPayload(qImg) || textToPayload(qText, 'Q: ');
            const optPayloads = slots.map(slot => {
                const img = slot.container?.querySelector('img')
                    || document.getElementById('choice' + slot.option)
                    || document.querySelector(`img[name="choice${slot.option}"]`);
                const byImage = imageToPayload(img);
                if (byImage) return byImage;
                const txt = (slot.container?.innerText || '').replace(/\s+/g, ' ').trim();
                return textToPayload(txt, `O${slot.option}: `);
            }).filter(Boolean);
            if (!qPayload || optPayloads.length < CFG.MIN_OPTIONS) {
                console.log('[MockTrainer] waiting: missing payloads', { qPayload: !!qPayload, options: optPayloads.length });
                return;
            }

            const qNum = getQNum();
            const key = `${qNum}|${qImg?.src || qPayload.slice(0, 80)}`;
            if (key === lastQuestionKey) return;

            processing = true;
            try {
                const teacher = await parseTeacherAnswer();
                if (!(teacher?.ok && teacher.option >= 1 && teacher.option <= 4)) {
                    console.warn('[MockTrainer] Teacher answer unavailable:', teacher?.reason || 'unknown');
                    return;
                }
                if (!slots.some(slot => slot.option === teacher.option)) {
                    console.warn('[MockTrainer] Teacher answer points to missing option slot:', teacher.option);
                    return;
                }

                lastQuestionKey = key;
                const feedback = await window.up_sendMsg('EXAM_FEEDBACK', {
                    questionB64: qPayload,
                    optionB64s: optPayloads,
                    selectedOption: teacher.option,
                    wasCorrect: true,
                    method: 'mock_phase1_teacher',
                    processingMs: 0,
                    domain: window.location.hostname,
                    questionNum: qNum,
                });
                if (feedback?.ok) {
                    console.log('[MockTrainer] Learned confirmed option', teacher.option, feedback.data);
                } else {
                    console.warn('[MockTrainer] Feedback failed:', feedback?.error || 'no response');
                }
                await clickCorrectAndSubmit(teacher.option);
            } finally {
                processing = false;
            }
        }

        function findLoginSubmit() {
            const form = document.getElementById('stallLoginSubmit')?.closest('form')
                || document.querySelector('form');
            const candidates = Array.from((form || document).querySelectorAll('button, input[type="submit"], input[type="button"]'));
            return candidates.find(el => {
                const text = String(el.innerText || el.value || '').trim().toLowerCase();
                return text.includes('submit') || text.includes('start') || text.includes('continue') || text.includes('proceed');
            }) || candidates[0] || null;
        }

        async function fillMockLogin() {
            const name = document.getElementById('stallLoginSubmit_ApplicantName');
            const dob = document.getElementById('dob');
            const language = document.getElementById('sel');
            const state = document.getElementById('mockstate');
            const radio = document.getElementById('radio1') || document.querySelector('input[name="examselection"][value="woaudio"]');
            if (!name || !dob || !language || !state || !radio) {
                return false;
            }

            setValue(name, CFG.DEFAULT_NAME);
            setValue(dob, CFG.DEFAULT_DOB);
            setValue(language, CFG.DEFAULT_LANGUAGE);
            setValue(state, CFG.DEFAULT_STATE);
            radio.checked = true;
            radio.dispatchEvent(new Event('click', { bubbles: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true }));

            // Fallback in page MAIN world (userscript-like context) for pages
            // that ignore isolated-world value assignments.
            await window.up_sendMsg('EXECUTE_IN_MAIN', {
                id: 'mock_trainer_login_main_world',
                code: `
                    (function () {
                        try {
                            const set = (el, val) => {
                                if (!el) return;
                                el.focus();
                                el.value = val;
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                el.blur();
                            };
                            set(document.getElementById('stallLoginSubmit_ApplicantName'), 'darshan');
                            set(document.getElementById('dob'), '01-02-2003');
                            set(document.getElementById('sel'), 'HINDI');
                            set(document.getElementById('mockstate'), 'MH');
                            const radio = document.getElementById('radio1')
                                || document.querySelector('input[name="examselection"][value="woaudio"]');
                            if (radio) {
                                radio.checked = true;
                                radio.dispatchEvent(new Event('click', { bubbles: true }));
                                radio.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        } catch (_) {}
                    })();
                `
            }).catch(() => {});

            if (!loginSubmitted) {
                loginSubmitted = true;
                await sleep(window.up_rndInt ? window.up_rndInt(500, 900) : 700);
                const submit = findLoginSubmit();
                if (submit) submit.click();
            }
            return true;
        }

        async function tick() {
            if (processing || !isMockPage()) return;
            const settings = await window.up_getStorage(['solverEnabled', 'learningEnabled', 'mockTrainingEnabled']);
            if (settings.solverEnabled === false || settings.learningEnabled === false || settings.mockTrainingEnabled === false) return;
            if (!isMockExamPage()) {
                await fillMockLogin();
                return;
            }
            await trainCurrentQuestion();
        }

        return {
            activate() {
                if (!isSarathiHost()) return;
                if (interval) clearInterval(interval);
                interval = setInterval(() => tick().catch(e => console.warn('[MockTrainer] tick failed:', e.message)), CFG.POLL_MS);
                setTimeout(() => tick().catch(() => {}), 500);
                console.log('[MockTrainer] active on Sarathi mock test');
            }
        };
    })();
})();
