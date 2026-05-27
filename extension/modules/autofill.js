// extension/modules/autofill.js
(function () {
    'use strict';

    window.AutofillModule = (() => {
        const DEBUG_LOGS = false;
        const debugLog = (...args) => { if (DEBUG_LOGS) console.log(...args); };
        let _active = false;
        let _recording = false;
        let _filledElements = new WeakSet();
        let _mutationObs = null;
        let _lastRecordedSignature = '';
        let _lastRecordedAt = 0;
        let _running = false;
        let _pageKey = '';
        let _completedStepKeys = new Set();
        let _cooldownUntil = 0;
        let _recordSession = null;

        const SCHEMA_VERSION = 2;
        const DEFAULT_SETTINGS = {
            skipHidden: true,
            skipLocked: true,
            skipPassword: true,
            maxRetries: 5,
            retryInterval: 1000
        };

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // ── Selection Logic ───────────────────────────────────────────────

        function findBestElement(selectorObj) {
            if (!selectorObj) return null;
            const { strategy, id, name, css } = selectorObj;
            const candidates = Array.isArray(selectorObj.candidates) ? selectorObj.candidates : [];
            
            // Try explicit strategy first
            if (strategy === 'id' && id) {
                const el = document.getElementById(id);
                if (el) return el;
            }
            if (strategy === 'name' && name) {
                const el = document.querySelector(`[name="${CSS.escape(name)}"]`);
                if (el) return el;
            }
            if (strategy === 'css' && css) {
                const el = document.querySelector(css);
                if (el) return el;
            }

            // Fallback: try whatever is available
            if (id) {
                const el = document.getElementById(id);
                if (el) return el;
            }
            if (name) {
                const el = document.querySelector(`[name="${CSS.escape(name)}"]`);
                if (el) return el;
            }
            if (css) {
                try {
                    const el = document.querySelector(css);
                    if (el) return el;
                } catch (_) {}
            }
            for (const candidate of candidates) {
                if (!candidate || typeof candidate !== 'object') continue;
                const found = findBestElement(candidate);
                if (found) return found;
            }
            return null;
        }

        function findRadioByNameValue(name, value) {
            if (!name) return null;
            const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
            if (!radios.length) return null;
            const target = String(value ?? '');
            return radios.find(radio => String(radio.value) === target) || radios[0];
        }

        function setNativeValue(el, value) {
            if (el instanceof HTMLSelectElement) {
                // Fuzzy Selection Logic (Legacy port)
                const target = String(value).trim().toLowerCase();
                let found = false;
                for (let i = 0; i < el.options.length; i++) {
                    const opt = el.options[i];
                    if (opt.value.trim().toLowerCase() === target || opt.text.trim().toLowerCase() === target) {
                        el.selectedIndex = i;
                        found = true;
                        break;
                    }
                }
                if (!found) el.value = value; // Fallback
            } else {
                const { set: valueSetter } = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value') || {};
                if (valueSetter && valueSetter !== Object.getOwnPropertyDescriptor(el, 'value')?.set) {
                    valueSetter.call(el, value);
                } else {
                    el.value = value;
                }
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // ── Rule Engine ───────────────────────────────────────────────────

        function matchRule(rule) {
            const url = window.location.href;
            const site = rule.site;
            if (!site?.pattern) return false;
            
            if (site.match_mode === 'domain') return window.location.hostname === site.pattern;
            if (site.match_mode === 'domainPath') return url.includes(site.pattern);
            if (site.match_mode === 'fullUrl') return url === site.pattern;
            return false;
        }

        function isStallExamSelectUrl() {
            return window.location.hostname === 'sarathi.parivahan.gov.in'
                && window.location.pathname.toLowerCase() === '/sarathiservice/examselectaction.do';
        }

        function currentPageKey() {
            return `${window.location.hostname}${window.location.pathname}${window.location.search}`;
        }

        function resetPageStateIfNeeded() {
            const key = currentPageKey();
            if (_pageKey === key) return;
            _pageKey = key;
            _completedStepKeys = new Set();
            _cooldownUntil = 0;
            _filledElements = new WeakSet();
        }

        function executionStepKey(rule, step) {
            const selector = step.selector || {};
            return [
                rule.local_rule_id || rule.server_rule_id || rule.name || '',
                rule.site?.pattern || '',
                step.order || '',
                step.action || '',
                String(step.value ?? ''),
                selector.strategy || '',
                selector.id || '',
                selector.name || '',
                selector.css || ''
            ].join('|');
        }

        function resolveFillValue(step, profileData) {
            let fillValue = step.value ?? '';
            if (typeof fillValue === 'string' && fillValue.startsWith('{{') && fillValue.endsWith('}}')) {
                const key = fillValue.slice(2, -2);
                fillValue = profileData[key] || '';
            }
            return fillValue;
        }

        async function executeStep(rule, step, profileData, settings) {
            const stepKey = executionStepKey(rule, step);
            if (_completedStepKeys.has(stepKey)) return 'complete';

            let el = findBestElement(step.selector);
            if (step.action === 'radio') {
                el = findRadioByNameValue(step.selector?.name, resolveFillValue(step, profileData)) || el;
            }
            if (!el || _filledElements.has(el)) return 'pending';

            // Guards
            if (settings.skipHidden && el.offsetParent === null) return 'pending';
            if (settings.skipLocked && (el.disabled || el.readOnly)) return 'pending';
            if (settings.skipPassword && el.type === 'password') return 'complete';

            const fillValue = resolveFillValue(step, profileData);
            if (!fillValue && step.action !== 'click') return 'complete';

            try {
                const ruleType = String(rule.rule_type || rule.ruleType || 'instant').toLowerCase();
                if (ruleType === 'flow') await window.up_humanMouse(el);
                else if (typeof el.focus === 'function') el.focus();
                if (step.action === 'text') {
                    setNativeValue(el, fillValue);
                } else if (step.action === 'select') {
                    setNativeValue(el, fillValue);
                } else if (step.action === 'checkbox') {
                    el.checked = (fillValue === 'true' || fillValue === true || fillValue === '1');
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (step.action === 'radio') {
                    el.checked = true;
                    el.click();
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (step.action === 'click') {
                    el.click();
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
                _filledElements.add(el);
                _completedStepKeys.add(stepKey);
                window.up_sendMsg('INCREMENT_STAT', { key: 'statFill' });
                const execution = rule.execution || {};
                const delayMs = Number(step.delay_ms ?? step.delayMs ?? execution.delay_ms ?? execution.delayMs ?? 100);
                if (delayMs > 0) await sleep(Math.min(Math.max(delayMs, 0), 5000));
                return 'filled';
            } catch (e) {
                console.error('[Autofill] Step failed:', e);
                return 'pending';
            }
        }

        async function executeRule(rule, profileData, settings) {
            if (!rule.steps?.length) return { filled: 0, pending: 0 };
            let filled = 0;
            let pending = 0;
            const steps = [...rule.steps].sort((a, b) => (a.order || 0) - (b.order || 0));
            const ruleType = String(rule.rule_type || rule.ruleType || 'instant').toLowerCase();
            const execution = rule.execution || {};
            for (const step of steps) {
                if (_completedStepKeys.has(executionStepKey(rule, step))) continue;
                const el = findBestElement(step.selector);
                if (!el && step.action !== 'radio') {
                    pending++;
                    if (ruleType === 'flow' && execution.stop_on_error !== false && step.required !== false) break;
                    continue;
                }
                const result = await executeStep(rule, step, profileData, settings);
                if (result === 'filled') filled++;
                if (result === 'pending') pending++;
                if (ruleType === 'flow' && result === 'pending' && execution.stop_on_error !== false && step.required !== false) break;
            }
            return { filled, pending };
        }

        async function runEngine() {
            if (!_active || _recording || _running || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
            resetPageStateIfNeeded();
            if (Date.now() < _cooldownUntil) return;
            _running = true;
            try {
                const data = await window.up_getStorage(['rules', 'profiles', 'activeProfileId', 'autofillSettings']);
                const settings = { ...DEFAULT_SETTINGS, ...data.autofillSettings };
                const profiles = data.profiles || [];
                const activeId = data.activeProfileId || 'default';
                const profile = profiles.find(p => p.id === activeId) || profiles[0] || { data: {} };
                const profileData = profile?.data || {};
                const rules = data.rules || [];

                const matchedRules = rules.filter(matchRule).sort((a,b) => (b.priority || 100) - (a.priority || 100));
                if (!matchedRules.length) return;

                const flowMatched = matchedRules.some(rule => String(rule.rule_type || rule.ruleType || 'instant').toLowerCase() === 'flow');
                const maxRetries = Math.max(1, Number(settings.maxRetries || DEFAULT_SETTINGS.maxRetries));
                const retryInterval = flowMatched ? Math.max(150, Number(settings.retryInterval || DEFAULT_SETTINGS.retryInterval)) : 100;
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    let totalFilled = 0;
                    let totalPending = 0;
                    for (const rule of matchedRules) {
                        const result = await executeRule(rule, profileData, settings);
                        totalFilled += result.filled;
                        totalPending += result.pending;
                    }
                    if (totalPending === 0) {
                        _cooldownUntil = Date.now() + 30000;
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, retryInterval));
                }
                _cooldownUntil = Date.now() + 5000;
            } finally {
                _running = false;
            }
        }

        // ── Recorder ──────────────────────────────────────────────────────

        function cssPath(el) {
            // Prioritize Data Attributes (Standard for robust automation)
            const dataAttrs = ['data-testid', 'data-name', 'data-qa', 'data-cy', 'data-id'];
            for (const attr of dataAttrs) {
                const val = el.getAttribute(attr);
                if (val) return `[${attr}="${CSS.escape(val)}"]`;
            }

            if (el.id) return `#${CSS.escape(el.id)}`;
            if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
            
            if (el.className && typeof el.className === 'string') {
                const classes = el.className.trim().split(/\s+/).filter(c => c && !c.includes(':')).slice(0, 3);
                if (classes.length) return `${el.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
            }
            
            return el.tagName.toLowerCase();
        }

        function generateSelector(el) {
            const candidates = [];
            // Priority 1: Data Attributes
            const dataAttrs = ['data-testid', 'data-name', 'data-qa', 'data-cy', 'data-id'];
            for (const attr of dataAttrs) {
                const val = el.getAttribute(attr);
                if (val) candidates.push({ strategy: 'css', css: `[${attr}="${CSS.escape(val)}"]` });
            }

            // Priority 2: ID
            if (el.id && !/^\d/.test(el.id)) { // Avoid numeric IDs which are often dynamic
                candidates.push({ strategy: 'id', id: el.id, css: `#${CSS.escape(el.id)}` });
            }

            // Priority 3: Name
            if (el.name) candidates.push({ strategy: 'name', name: el.name, css: cssPath(el) });
            const aria = el.getAttribute('aria-label');
            if (aria) candidates.push({ strategy: 'css', css: `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]` });
            const placeholder = el.getAttribute('placeholder');
            if (placeholder) candidates.push({ strategy: 'css', css: `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(placeholder)}"]` });

            // Fallback: CSS Path
            candidates.push({ strategy: 'css', css: cssPath(el) });
            const primary = candidates[0] || { strategy: 'css', css: cssPath(el) };
            return { ...primary, candidates: candidates.slice(1) };
        }

        function stepSignature(rule) {
            const step = rule?.steps?.[0] || {};
            const selector = step.selector || {};
            return [
                rule?.site?.match_mode || '',
                rule?.site?.pattern || '',
                step.action || '',
                String(step.value ?? ''),
                selector.strategy || '',
                selector.id || '',
                selector.name || '',
                selector.css || ''
            ].join('|');
        }

        function actionLabel(step) {
            const selector = step.selector || {};
            const selected = selector.id ? `#${selector.id}` : selector.name ? `[name="${selector.name}"]` : selector.css || selector.strategy || 'selector';
            const value = step.action === 'click' ? '' : ` = ${String(step.value ?? '').slice(0, 32)}`;
            return `${step.order}. ${step.action} ${selected}${value}`;
        }

        function ensureRecordSession() {
            if (_recordSession) return _recordSession;
            _recordSession = {
                id: `rec_${Date.now()}`,
                ruleType: 'instant',
                matchMode: 'domainPath',
                pattern: window.location.hostname + window.location.pathname,
                steps: [],
                startedAt: new Date().toISOString(),
            };
            renderRecordPanel();
            return _recordSession;
        }

        function destroyRecordPanel() {
            const panel = document.getElementById('__sa_autofill_record_panel');
            if (panel) panel.remove();
        }

        function renderRecordPanel() {
            if (!_recording) {
                destroyRecordPanel();
                return;
            }
            const session = ensureRecordSession();
            let panel = document.getElementById('__sa_autofill_record_panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = '__sa_autofill_record_panel';
                panel.style.cssText = [
                    'position:fixed',
                    'right:16px',
                    'top:72px',
                    'z-index:2147483647',
                    'width:360px',
                    'max-width:calc(100vw - 32px)',
                    'background:#0f172a',
                    'color:#e2e8f0',
                    'border:1px solid rgba(148,163,184,.35)',
                    'border-radius:8px',
                    'box-shadow:0 18px 45px rgba(0,0,0,.35)',
                    'font:12px/1.35 system-ui,sans-serif',
                    'overflow:hidden'
                ].join(';');
                panel.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const target = event.target;
                    if (!(target instanceof HTMLElement)) return;
                    const action = target.dataset.action;
                    if (!action) return;
                    if (action === 'remove') {
                        const index = Number(target.dataset.index);
                        session.steps.splice(index, 1);
                        session.steps.forEach((step, idx) => { step.order = idx + 1; });
                        renderRecordPanel();
                    } else if (action === 'clear') {
                        session.steps = [];
                        renderRecordPanel();
                    } else if (action === 'cancel') {
                        _recordSession = null;
                        chrome.storage.local.set({ isRecording: false });
                        _recording = false;
                        destroyRecordPanel();
                    } else if (action === 'save') {
                        saveRecordSession();
                    }
                }, true);
                panel.addEventListener('change', (event) => {
                    event.stopPropagation();
                    const target = event.target;
                    if (!(target instanceof HTMLSelectElement)) return;
                    if (target.dataset.field === 'ruleType') session.ruleType = target.value;
                    if (target.dataset.field === 'matchMode') {
                        session.matchMode = target.value;
                        if (target.value === 'domain') session.pattern = window.location.hostname;
                        if (target.value === 'domainPath') session.pattern = window.location.hostname + window.location.pathname;
                        if (target.value === 'fullUrl') session.pattern = window.location.href;
                    }
                    renderRecordPanel();
                }, true);
                document.documentElement.appendChild(panel);
            }
            const rows = session.steps.map((step, index) => `
                <div style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-top:1px solid rgba(148,163,184,.18)">
                    <div style="flex:1;min-width:0;word-break:break-word">${escapeHtml(actionLabel(step))}</div>
                    <button data-action="remove" data-index="${index}" style="border:0;background:#7f1d1d;color:white;border-radius:5px;padding:2px 6px;cursor:pointer">Delete</button>
                </div>
            `).join('');
            panel.innerHTML = `
                <div style="padding:10px;border-bottom:1px solid rgba(148,163,184,.25);display:flex;align-items:center;gap:8px">
                    <strong style="font-size:13px">Autofill Recorder</strong>
                    <span style="margin-left:auto;color:#93c5fd">${session.steps.length} step${session.steps.length === 1 ? '' : 's'}</span>
                </div>
                <div style="padding:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <label>Rule type<br><select data-field="ruleType" style="width:100%"><option value="instant"${session.ruleType === 'instant' ? ' selected' : ''}>Instant</option><option value="flow"${session.ruleType === 'flow' ? ' selected' : ''}>Flow</option></select></label>
                    <label>Scope<br><select data-field="matchMode" style="width:100%"><option value="domainPath"${session.matchMode === 'domainPath' ? ' selected' : ''}>This page</option><option value="domain"${session.matchMode === 'domain' ? ' selected' : ''}>Whole domain</option><option value="fullUrl"${session.matchMode === 'fullUrl' ? ' selected' : ''}>Exact URL</option></select></label>
                    <div style="grid-column:1/-1;color:#94a3b8;word-break:break-all">${escapeHtml(session.pattern)}</div>
                </div>
                <div style="max-height:260px;overflow:auto">${rows || '<div style="padding:14px 10px;color:#94a3b8">Interact with text fields, selects, checkboxes, radios, or buttons.</div>'}</div>
                <div style="padding:10px;display:flex;gap:8px;border-top:1px solid rgba(148,163,184,.25)">
                    <button data-action="save" style="background:#16a34a;color:white;border:0;border-radius:6px;padding:6px 10px;cursor:pointer">Save</button>
                    <button data-action="clear" style="background:#475569;color:white;border:0;border-radius:6px;padding:6px 10px;cursor:pointer">Clear</button>
                    <button data-action="cancel" style="margin-left:auto;background:#334155;color:white;border:0;border-radius:6px;padding:6px 10px;cursor:pointer">Stop</button>
                </div>
            `;
        }

        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[ch]));
        }

        async function saveRecordSession() {
            const session = ensureRecordSession();
            if (!session.steps.length) {
                showRecordToast('No steps recorded', true);
                return;
            }
            const rule = {
                local_rule_id: session.id,
                name: `${session.ruleType} ${window.location.hostname}`,
                status: 'pending',
                enabled: true,
                rule_type: session.ruleType,
                access_scope: 'global',
                services: ['autofill'],
                plans: [],
                api_key_ids: [],
                site: { match_mode: session.matchMode, pattern: session.pattern },
                profile_scope: 'default',
                frame_path: 'any',
                priority: 100,
                execution: {
                    delay_ms: session.ruleType === 'instant' ? 100 : 150,
                    run_once: true,
                    wait_timeout_ms: session.ruleType === 'instant' ? 2500 : 5000,
                    stop_on_error: session.ruleType === 'flow'
                },
                steps: session.steps,
                meta: {
                    recorded_at: session.startedAt,
                    saved_at: new Date().toISOString(),
                    recorder: 'session_panel'
                }
            };
            const resp = await window.up_sendMsg('RECORD_RULE', { rule });
            if (resp && resp.ok) {
                showRecordToast('Autofill rule saved for review', true);
                _recordSession = null;
                chrome.storage.local.set({ isRecording: false });
                _recording = false;
                destroyRecordPanel();
            } else {
                showRecordToast(`Save failed: ${resp?.error || 'unknown'}`, true);
            }
        }

        function handleInteraction(e) {
            if (!_recording) return;
            if (e.isTrusted === false) return;
            if (e.target?.closest?.('#__sa_autofill_record_panel')) return;
            const el = e.target.closest('input, select, textarea, button, a');
            if (!el || el.type === 'password') return;
            if (e.type === 'click' && el.tagName === 'INPUT' && ['text', 'email', 'number', 'tel'].includes(el.type)) return;

            let action = 'text';
            let value = el.value;
            if (el.type === 'checkbox') {
                action = 'checkbox';
                value = el.checked;
            } else if (el.type === 'radio') {
                if (!el.checked) return;
                action = 'radio';
                value = el.value;
            } else if (el.tagName === 'SELECT') {
                action = 'select';
            } else if (['BUTTON', 'A'].includes(el.tagName) || ['submit', 'button'].includes(el.type)) {
                action = 'click';
                value = '';
            }

            const session = ensureRecordSession();
            if (['BUTTON', 'A'].includes(el.tagName) || ['submit', 'button'].includes(el.type)) {
                session.ruleType = 'flow';
            }
            const step = {
                order: session.steps.length + 1,
                action,
                value,
                selector: generateSelector(el),
                delay_ms: session.ruleType === 'instant' ? 100 : 150,
                timeout_ms: session.ruleType === 'instant' ? 2500 : 5000,
                required: true,
                meta: {
                    tag: el.tagName.toLowerCase(),
                    element_id: el.id || '',
                    element_name: el.name || '',
                }
            };

            const signature = stepSignature({
                site: { match_mode: session.matchMode, pattern: session.pattern },
                steps: [step]
            });
            const now = Date.now();
            if (signature === _lastRecordedSignature && (now - _lastRecordedAt) < 1500) return;
            _lastRecordedSignature = signature;
            _lastRecordedAt = now;

            session.steps.push(step);
            debugLog('[Autofill] Recorded interaction:', step);
            renderRecordPanel();
        }

        function showRecordToast(text, isOn) {
            const id = '__unified_record_toast';
            let toast = document.getElementById(id);
            if (!toast) {
                toast = document.createElement('div');
                toast.id = id;
                toast.style.position = 'fixed';
                toast.style.right = '16px';
                toast.style.bottom = '16px';
                toast.style.zIndex = '2147483647';
                toast.style.padding = '8px 12px';
                toast.style.borderRadius = '8px';
                toast.style.font = '600 12px/1.2 system-ui, sans-serif';
                toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.25)';
                document.documentElement.appendChild(toast);
            }
            toast.textContent = text;
            toast.style.background = isOn ? '#15803d' : '#334155';
            toast.style.color = '#ffffff';
            toast.style.opacity = '1';
            clearTimeout(toast._hideTimer);
            toast._hideTimer = setTimeout(() => {
                if (toast) toast.style.opacity = '0';
            }, 2200);
        }

        return {
            async activate() {
                const gate = await window.up_getStorage(['isRecording', 'isMaster', 'rules']);
                _recording = !!gate.isRecording && !!gate.isMaster;
                if (isStallExamSelectUrl() && !_recording) {
                    console.debug('[Autofill] Module skipped on STALL exam select');
                    return;
                }
                const hasMatchedRule = (gate.rules || []).some(matchRule);
                if (!_recording && !hasMatchedRule) {
                    console.debug('[Autofill] Module skipped (no matching rule and recording off)');
                    return;
                }
                _active = true;
                // Debounce: avoid flooding runEngine() on rapid DOM mutations (SPA routing)
                let _mutationTimer = null;
                _mutationObs = new MutationObserver(() => {
                    if (_mutationTimer) return;
                    _mutationTimer = setTimeout(() => {
                        _mutationTimer = null;
                        runEngine();
                    }, 300);
                });
                _mutationObs.observe(document.body, { childList: true, subtree: true });
                document.addEventListener('change', handleInteraction, true);
                document.addEventListener('click', handleInteraction, true);
                if (_recording) renderRecordPanel();
                runEngine();
                debugLog('[Autofill] V26 Engine active');
            },
            toggleRecording(state) {
                _recording = state;
                if (_recording) {
                    ensureRecordSession();
                } else {
                    _recordSession = null;
                    destroyRecordPanel();
                }
                debugLog(`[Autofill] Recording: ${_recording}`);
                showRecordToast(_recording ? 'Autofill recording ON' : 'Autofill recording OFF', _recording);
            },
            runNow() {
                runEngine();
            }
        };
    })();

})();
