// extension/modules/autofill.js
(function () {
    'use strict';

    window.AutofillModule = (() => {
        let _active = false;
        let _recording = false;
        let _filledElements = new WeakSet();
        let _mutationObs = null;

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

        async function executeRule(rule, profileData, settings) {
            if (!rule.steps?.length) return;
            for (const step of rule.steps) {
                const el = findBestElement(step.selector);
                if (!el || _filledElements.has(el)) continue;

                // Guards
                if (settings.skipHidden && el.offsetParent === null) continue;
                if (settings.skipLocked && (el.disabled || el.readOnly)) continue;
                if (settings.skipPassword && el.type === 'password') continue;

                // Resolve Value (Profile Tokens)
                let fillValue = step.value ?? '';
                if (typeof fillValue === 'string' && fillValue.startsWith('{{') && fillValue.endsWith('}}')) {
                    const key = fillValue.slice(2, -2);
                    fillValue = profileData[key] || '';
                }

                if (!fillValue && step.action !== 'click') continue;

                try {
                    await window.up_humanMouse(el);
                    if (step.action === 'text') {
                        setNativeValue(el, fillValue);
                    } else if (step.action === 'select') {
                        setNativeValue(el, fillValue);
                    } else if (step.action === 'checkbox' || step.action === 'radio') {
                        el.checked = (fillValue === 'true' || fillValue === true || fillValue === '1');
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    } else if (step.action === 'click') {
                        el.click();
                    }
                    _filledElements.add(el);
                    window.up_flashElement(el, '#10b981'); // Green flash
                    window.up_sendMsg('INCREMENT_STAT', { key: 'statFill' });
                } catch (e) {
                    console.error('[Autofill] Step failed:', e);
                }
            }
        }

        async function runEngine() {
            if (!_active || _recording || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
            const data = await window.up_getStorage(['rules', 'profiles', 'activeProfileId', 'autofillSettings']);
            const settings = { ...DEFAULT_SETTINGS, ...data.autofillSettings };
            const profiles = data.profiles || [];
            const activeId = data.activeProfileId || 'default';
            const profile = profiles.find(p => p.id === activeId) || profiles[0] || { data: {} };
            const profileData = profile?.data || {};
            const rules = data.rules || [];

            const matchedRules = rules.filter(matchRule).sort((a,b) => (b.priority || 100) - (a.priority || 100));
            if (!matchedRules.length) return;

            for (const rule of matchedRules) {
                await executeRule(rule, profileData, settings);
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

        function handleInteraction(e) {
            if (!_recording) return;
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

            console.log('[Autofill] Recorded interaction:', rule);
            window.up_flashElement(el, '#f43f5e'); // Red flash
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
            activate() {
                _active = true;
                window.up_getStorage(['isRecording', 'isMaster']).then(d => {
                    _recording = !!d.isRecording && !!d.isMaster;
                });
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
