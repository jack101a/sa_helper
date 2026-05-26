// extension/modules/autofill.js
(function () {
    'use strict';

    window.AutofillModule = (() => {
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

        const SCHEMA_VERSION = 2;
        const DEFAULT_SETTINGS = {
            skipHidden: true,
            skipLocked: true,
            skipPassword: true,
            maxRetries: 5,
            retryInterval: 1000
        };

        // ── Selection Logic ───────────────────────────────────────────────

        function findBestElement(selectorObj) {
            if (!selectorObj) return null;
            const { strategy, id, name, css } = selectorObj;
            
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
                await window.up_humanMouse(el);
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
            for (const step of steps) {
                if (_completedStepKeys.has(executionStepKey(rule, step))) continue;
                const el = findBestElement(step.selector);
                if (!el && step.action !== 'radio') {
                    pending++;
                    continue;
                }
                const result = await executeStep(rule, step, profileData, settings);
                if (result === 'filled') filled++;
                if (result === 'pending') pending++;
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

                const maxRetries = Math.max(1, Number(settings.maxRetries || DEFAULT_SETTINGS.maxRetries));
                const retryInterval = Math.max(150, Number(settings.retryInterval || DEFAULT_SETTINGS.retryInterval));
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
            // Priority 1: Data Attributes
            const dataAttrs = ['data-testid', 'data-name', 'data-qa', 'data-cy', 'data-id'];
            for (const attr of dataAttrs) {
                const val = el.getAttribute(attr);
                if (val) return { strategy: 'css', css: `[${attr}="${CSS.escape(val)}"]` };
            }

            // Priority 2: ID
            if (el.id && !/^\d/.test(el.id)) { // Avoid numeric IDs which are often dynamic
                return { strategy: 'id', id: el.id, css: `#${CSS.escape(el.id)}` };
            }

            // Priority 3: Name
            if (el.name) return { strategy: 'name', name: el.name, css: cssPath(el) };

            // Fallback: CSS Path
            return { strategy: 'css', css: cssPath(el) };
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

        function handleInteraction(e) {
            if (!_recording) return;
            if (e.isTrusted === false) return;
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

            const rule = {
                local_rule_id: `local_${Date.now()}`,
                name: `${action} ${window.location.hostname}`,
                site: { match_mode: 'domainPath', pattern: window.location.hostname + window.location.pathname },
                steps: [{
                    order: 1,
                    action,
                    value,
                    selector: generateSelector(el)
                }],
                meta: {
                    recorded_at: new Date().toISOString(),
                    tag: el.tagName.toLowerCase(),
                    element_id: el.id || '',
                    element_name: el.name || '',
                }
            };

            const signature = stepSignature(rule);
            const now = Date.now();
            if (signature === _lastRecordedSignature && (now - _lastRecordedAt) < 1500) return;
            _lastRecordedSignature = signature;
            _lastRecordedAt = now;

            console.log('[Autofill] Recorded interaction:', rule);
            window.up_sendMsg('RECORD_STEP', { rule });
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
                runEngine();
                console.log('[Autofill] V26 Engine active');
            },
            toggleRecording(state) {
                _recording = state;
                console.log(`[Autofill] Recording: ${_recording}`);
                showRecordToast(_recording ? 'Autofill recording ON' : 'Autofill recording OFF', _recording);
            },
            runNow() {
                runEngine();
            }
        };
    })();

})();
