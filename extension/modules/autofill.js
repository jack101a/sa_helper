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
        let _recordHoverEl = null;
        let _highlightRaf = 0;
        let _recordListenersInstalled = false;
        let _storageListenerInstalled = false;

        const SCHEMA_VERSION = 2;
        const RECORD_SESSION_KEY = '_autofillRecordSession';
        const RECORD_SESSION_TAB_KEY = '__sa_autofill_record_session';
        const RECORD_LAYER_ID = '__sa_autofill_record_highlights';
        const DEFAULT_SETTINGS = {
            skipHidden: true,
            skipLocked: true,
            skipPassword: true,
            maxRetries: 5,
            retryInterval: 1000,
            flashFeedback: true,
            debugMode: false
        };

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        function isUserPackageBuild() {
            try {
                const manifest = chrome.runtime.getManifest();
                return /\buser\b/i.test(String(manifest?.name || ''));
            } catch (_) {
                return false;
            }
        }

        function shouldShowFillFeedback(settings) {
            return !!(settings.flashFeedback && (settings.debugMode || settings.isMaster) && !isUserPackageBuild());
        }

        // ── Selection Logic ───────────────────────────────────────────────

        const cssEscape = (value) => {
            if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(String(value));
            return String(value).replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`);
        };

        function uniqueElements(items) {
            const seen = new Set();
            return (items || []).filter(el => {
                if (!el || seen.has(el)) return false;
                seen.add(el);
                return true;
            });
        }

        function walkOpenRoots(root, visitor) {
            if (!root) return;
            visitor(root);
            const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
            for (const node of nodes) {
                if (node.shadowRoot) walkOpenRoots(node.shadowRoot, visitor);
            }
        }

        function queryCssDeep(selector) {
            if (!selector) return [];
            const found = [];
            try {
                walkOpenRoots(document, root => {
                    try { found.push(...Array.from(root.querySelectorAll(selector))); } catch (_) {}
                });
            } catch (_) {}
            return uniqueElements(found);
        }

        function queryByIdDeep(id) {
            if (!id) return [];
            return queryCssDeep(`#${cssEscape(id)}`);
        }

        function queryByNameDeep(name) {
            if (!name) return [];
            return queryCssDeep(`[name="${cssEscape(name)}"]`);
        }

        function queryXPath(xpath) {
            if (!xpath) return [];
            try {
                const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                const out = [];
                for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
                return uniqueElements(out);
            } catch (_) {
                return [];
            }
        }

        function isElementVisible(el) {
            if (!el || !(el instanceof Element)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        function isElementLocked(el) {
            return !!(el && (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true'));
        }

        function normalizeSelectorCandidates(selectorObj) {
            if (!selectorObj) return [];
            const candidates = [];
            const push = (candidate, source) => {
                if (!candidate || typeof candidate !== 'object') return;
                candidates.push({ ...candidate, source: candidate.source || source });
            };
            push(selectorObj, 'primary');
            for (const candidate of Array.isArray(selectorObj.candidates) ? selectorObj.candidates : []) {
                push(candidate, 'candidate');
            }
            if (selectorObj.id || selectorObj.element_id) {
                push({ strategy: 'id', id: selectorObj.id || selectorObj.element_id }, 'field');
            }
            if (selectorObj.name) push({ strategy: 'name', name: selectorObj.name }, 'field');
            if (selectorObj.css) push({ strategy: 'css', css: selectorObj.css }, 'field');
            if (selectorObj.xpath) push({ strategy: 'xpath', xpath: selectorObj.xpath }, 'field');
            return candidates;
        }

        function candidateMatches(candidate) {
            const strategy = String(candidate.primary || candidate.strategy || '').toLowerCase();
            if ((strategy === 'id' || candidate.id) && candidate.id) return queryByIdDeep(candidate.id);
            if ((strategy === 'name' || candidate.name) && candidate.name) return queryByNameDeep(candidate.name);
            if ((strategy === 'xpath' || candidate.xpath) && candidate.xpath) return queryXPath(candidate.xpath);
            if (candidate.css) return queryCssDeep(candidate.css);
            return [];
        }

        function resolveElement(selectorObj, options = {}) {
            const candidates = normalizeSelectorCandidates(selectorObj);
            let best = null;
            for (const candidate of candidates) {
                const matches = candidateMatches(candidate);
                const visible = matches.filter(isElementVisible);
                const pool = visible.length ? visible : matches;
                const el = pool[0] || null;
                if (!el) continue;
                const confidence = Number(candidate.confidence ?? selectorObj?.confidence ?? 0) || (matches.length === 1 ? 90 : 55);
                const result = {
                    el,
                    candidate,
                    matches: matches.length,
                    visibleMatches: visible.length,
                    confidence,
                    reason: matches.length > 1 ? 'ambiguous' : 'matched'
                };
                if (!best || result.confidence > best.confidence || (result.matches === 1 && best.matches !== 1)) {
                    best = result;
                }
                if (matches.length === 1 && (!options.preferVisible || visible.length === 1)) return result;
            }
            return best || { el: null, candidate: null, matches: 0, visibleMatches: 0, confidence: 0, reason: 'not_found' };
        }

        function findBestElement(selectorObj) {
            return resolveElement(selectorObj, { preferVisible: true }).el;
        }

        function findRadioByNameValue(name, value) {
            if (!name) return null;
            const radios = queryCssDeep(`input[type="radio"][name="${cssEscape(name)}"]`);
            if (!radios.length) return null;
            const target = String(value ?? '');
            return radios.find(radio => String(radio.value) === target) || radios[0];
        }

        function dispatchNativeEvent(el, type, init = {}) {
            const opts = { bubbles: true, cancelable: true, ...init };
            const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent
                : ['click', 'mousedown', 'mouseup', 'mouseover', 'mousemove'].includes(type) ? MouseEvent
                : type === 'input' && window.InputEvent ? InputEvent
                : Event;
            try { el.dispatchEvent(new Ctor(type, opts)); }
            catch (_) { el.dispatchEvent(new Event(type, opts)); }
        }

        function setNativeValue(el, value) {
            if (el instanceof HTMLSelectElement) {
                const target = String(value).trim().toLowerCase();
                const options = Array.from(el.options || []);
                let match = options.find(opt => String(opt.value || '').trim().toLowerCase() === target)
                    || options.find(opt => String(opt.text || '').trim().toLowerCase() === target);
                if (!match && target.length >= 3) {
                    match = options.find(opt => String(opt.text || '').trim().toLowerCase().includes(target));
                }
                if (match) el.selectedIndex = options.indexOf(match);
                else el.value = value;
            } else {
                const { set: valueSetter } = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value') || {};
                if (valueSetter && valueSetter !== Object.getOwnPropertyDescriptor(el, 'value')?.set) {
                    valueSetter.call(el, value);
                } else {
                    el.value = value;
                }
            }
            dispatchNativeEvent(el, 'input', { data: String(value ?? ''), inputType: 'insertReplacementText' });
            dispatchNativeEvent(el, 'change');
        }

        function flashElement(el, ok = true) {
            if (!el || !(el instanceof HTMLElement)) return;
            const previous = el.style.outline;
            const previousShadow = el.style.boxShadow;
            el.style.outline = `3px solid ${ok ? '#22c55e' : '#ef4444'}`;
            el.style.boxShadow = `0 0 0 5px ${ok ? 'rgba(34,197,94,.22)' : 'rgba(239,68,68,.22)'}`;
            setTimeout(() => {
                try {
                    el.style.outline = previous;
                    el.style.boxShadow = previousShadow;
                } catch (_) {}
            }, 900);
        }

        async function waitForStepElement(step, fillValue, settings, execution, ruleType) {
            const runtime = step.runtime || {};
            const rawTimeout = runtime.timeout_ms ?? step.timeout_ms ?? execution.wait_timeout_ms;
            const shouldWait = String(ruleType || 'instant').toLowerCase() === 'flow' || runtime.wait_for_element === true || step.wait_for_element === true || execution.wait_for_element === true;
            const timeoutMs = shouldWait ? Math.min(15000, Math.max(100, Number(rawTimeout ?? 2500))) : 0;
            const started = Date.now();
            let last = { el: null, reason: 'not_found' };
            do {
                let resolved = resolveElement(step.selector, { preferVisible: true });
                let el = resolved.el;
                if (step.action === 'radio') {
                    el = findRadioByNameValue(step.selector?.name, fillValue) || el;
                    if (el) resolved = { ...resolved, el };
                }
                last = resolved;
                if (el) {
                    if (settings.skipHidden && !isElementVisible(el)) {
                        last.reason = 'hidden';
                    } else if (settings.skipLocked && isElementLocked(el)) {
                        last.reason = 'locked';
                    } else {
                        return { ...resolved, el, ok: true };
                    }
                }
                if (!timeoutMs || Date.now() - started >= timeoutMs) break;
                await sleep(120);
            } while (Date.now() - started <= timeoutMs);
            return { ...last, ok: false };
        }

        function verifyStepValue(el, step, expected) {
            if (!el) return false;
            if (step.action === 'click') return true;
            if (step.action === 'checkbox') return el.checked === (expected === true || expected === 'true' || expected === '1' || expected === 1);
            if (step.action === 'radio') return !!el.checked;
            if (el instanceof HTMLSelectElement) {
                const selected = el.options[el.selectedIndex];
                const target = String(expected ?? '').trim().toLowerCase();
                return String(el.value || '').trim().toLowerCase() === target
                    || String(selected?.text || '').trim().toLowerCase() === target
                    || (target.length >= 3 && String(selected?.text || '').trim().toLowerCase().includes(target));
            }
            return String(el.value ?? '') === String(expected ?? '');
        }

        async function performAction(el, step, fillValue, ruleType) {
            if (ruleType === 'flow') await window.up_humanMouse(el);
            if (typeof el.focus === 'function') {
                el.focus();
                dispatchNativeEvent(el, 'focus');
            }
            if (step.action === 'text') {
                setNativeValue(el, fillValue);
            } else if (step.action === 'select') {
                setNativeValue(el, fillValue);
            } else if (step.action === 'checkbox') {
                const desired = fillValue === true || fillValue === 'true' || fillValue === '1' || fillValue === 1;
                if (el.checked !== desired) {
                    dispatchNativeEvent(el, 'pointerdown');
                    dispatchNativeEvent(el, 'mousedown');
                    el.click();
                    dispatchNativeEvent(el, 'mouseup');
                    dispatchNativeEvent(el, 'pointerup');
                }
                if (el.checked !== desired) el.checked = desired;
                dispatchNativeEvent(el, 'input');
                dispatchNativeEvent(el, 'change');
            } else if (step.action === 'radio') {
                dispatchNativeEvent(el, 'pointerdown');
                dispatchNativeEvent(el, 'mousedown');
                if (!el.checked) el.click();
                dispatchNativeEvent(el, 'mouseup');
                dispatchNativeEvent(el, 'pointerup');
                if (!el.checked) el.checked = true;
                dispatchNativeEvent(el, 'input');
                dispatchNativeEvent(el, 'change');
            } else if (step.action === 'click') {
                dispatchNativeEvent(el, 'pointerdown');
                dispatchNativeEvent(el, 'mousedown');
                dispatchNativeEvent(el, 'mouseup');
                dispatchNativeEvent(el, 'pointerup');
                el.click();
            }
            if (typeof el.blur === 'function' && step.runtime?.blur_after_fill === true) {
                el.blur();
                dispatchNativeEvent(el, 'blur');
            }
        }

        // ── Rule Engine ───────────────────────────────────────────────────

        function matchRule(rule) {
            const url = window.location.href;
            const site = rule.site;
            if (!site?.pattern && !site?.domain && !site?.path) return false;
            if (site.domain && window.location.hostname !== site.domain) return false;
            if (site.path && !window.location.pathname.startsWith(site.path)) return false;
            if (!site.pattern && (site.domain || site.path)) return true;
            
            if (site.match_mode === 'domain') return window.location.hostname === site.pattern;
            if (site.match_mode === 'domainPath') return url.includes(site.pattern);
            if (site.match_mode === 'fullUrl') return url === site.pattern;
            if (site.match_mode === 'path') return window.location.pathname === site.pattern;
            return false;
        }

        function normalizeScopeList(value) {
            if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
            return String(value || '').split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
        }

        function normalizePlanName(value) {
            return String(value || '').trim().toLowerCase();
        }

        function ruleProfileScopeApplies(rule, context) {
            const scope = rule.profile_scope || 'default';
            if (!scope || typeof scope === 'string') return true;
            if (typeof scope !== 'object') return true;
            const mode = String(scope.mode || scope.scope || 'custom').toLowerCase();
            if (['default', 'global', 'all'].includes(mode)) return true;

            const planName = normalizePlanName(context.planName);
            const allowedPlans = new Set(normalizeScopeList(scope.plans || scope.plan_names).map(normalizePlanName));
            const keyCandidates = new Set([
                String(context.apiKeyId || '').trim(),
                String(context.keyName || '').trim(),
            ].filter(Boolean));
            const allowedUsers = new Set(normalizeScopeList(scope.users || scope.user_ids || scope.api_key_ids));

            const planMatched = !!planName && allowedPlans.has(planName);
            const userMatched = Array.from(keyCandidates).some(item => allowedUsers.has(item));
            if (mode === 'plan') return planMatched;
            if (mode === 'user') return userMatched;
            if (mode === 'custom') return planMatched || userMatched || allowedPlans.size === 0 && allowedUsers.size === 0;
            return true;
        }

        function profileForRule(rule, profiles, activeId, context) {
            const list = Array.isArray(profiles) ? profiles : [];
            const active = list.find(profile => String(profile.id) === String(activeId));
            const fallback = active || list[0] || { id: 'default', data: {} };
            const scope = rule.profile_scope || 'default';
            if (typeof scope === 'string') {
                if (!scope || scope === 'default') return fallback;
                return list.find(profile => String(profile.id) === String(scope)) || fallback;
            }
            if (scope && typeof scope === 'object') {
                const ids = normalizeScopeList(scope.profile_ids || scope.profiles || scope.ids);
                if (ids.length) {
                    return list.find(profile => String(profile.id) === String(activeId) && ids.includes(String(profile.id)))
                        || list.find(profile => ids.includes(String(profile.id)))
                        || fallback;
                }
                if (ruleProfileScopeApplies(rule, context)) return fallback;
            }
            return fallback;
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
                rule.site?.domain || '',
                rule.site?.path || '',
                step.order || '',
                step.field_key || '',
                step.action || '',
                String(step.value ?? ''),
                selector.strategy || '',
                selector.primary || '',
                selector.id || '',
                selector.element_id || '',
                selector.name || '',
                selector.css || '',
                selector.xpath || ''
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

            const execution = rule.execution || {};
            const fillValue = resolveFillValue(step, profileData);
            const ruleType = String(rule.rule_type || rule.ruleType || 'instant').toLowerCase();
            const resolved = await waitForStepElement(step, fillValue, settings, execution, ruleType);
            const el = resolved.el;
            if (!resolved.ok || !el) {
                if (settings.debugMode || settings.isMaster) {
                    debugLog('[Autofill] Step pending', { step, reason: resolved.reason, matches: resolved.matches, visibleMatches: resolved.visibleMatches });
                }
                return 'pending';
            }

            if (settings.skipPassword && el.type === 'password') return 'complete';

            if ((fillValue === '' || fillValue === null || fillValue === undefined)
                && !['click', 'checkbox'].includes(step.action)) {
                return 'complete';
            }

            try {
                await performAction(el, step, fillValue, ruleType);
                const shouldVerify = step.runtime?.verify_after_fill !== false;
                if (shouldVerify && !verifyStepValue(el, step, fillValue)) {
                    if (shouldShowFillFeedback(settings)) flashElement(el, false);
                    if (settings.debugMode || settings.isMaster) {
                        debugLog('[Autofill] Step verification failed', { step, expected: fillValue, actual: el.value, checked: el.checked });
                    }
                    return 'pending';
                }
                if (shouldShowFillFeedback(settings)) flashElement(el, true);
                _completedStepKeys.add(stepKey);
                window.up_sendMsg('INCREMENT_STAT', { key: 'statFill' });
                const delayMs = Number(step.runtime?.delay_ms ?? step.delay_ms ?? step.delayMs ?? execution.delay_ms ?? execution.delayMs ?? 100);
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
                const data = await window.up_getStorage(['rules', 'profiles', 'activeProfileId', 'autofillSettings', 'isMaster', 'planName', 'keyName', 'apiKeyId']);
                const settings = { ...DEFAULT_SETTINGS, ...data.autofillSettings, isMaster: !!data.isMaster };
                const profiles = data.profiles || [];
                const activeId = data.activeProfileId || 'default';
                const scopeContext = {
                    planName: data.planName || '',
                    keyName: data.keyName || '',
                    apiKeyId: data.apiKeyId || '',
                };
                const rules = data.rules || [];

                const matchedRules = rules
                    .filter(rule => matchRule(rule) && ruleProfileScopeApplies(rule, scopeContext))
                    .sort((a,b) => (b.priority || 100) - (a.priority || 100));
                if (!matchedRules.length) return;

                const flowMatched = matchedRules.some(rule => String(rule.rule_type || rule.ruleType || 'instant').toLowerCase() === 'flow');
                const maxRetries = Math.max(1, Number(settings.maxRetries || DEFAULT_SETTINGS.maxRetries));
                const retryInterval = flowMatched ? Math.max(150, Number(settings.retryInterval || DEFAULT_SETTINGS.retryInterval)) : 100;
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    let totalFilled = 0;
                    let totalPending = 0;
                    for (const rule of matchedRules) {
                        const profile = profileForRule(rule, profiles, activeId, scopeContext);
                        const profileData = profile?.data || {};
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
                if (val) return `[${attr}="${cssEscape(val)}"]`;
            }

            if (el.id) return `#${cssEscape(el.id)}`;
            if (el.name) return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
            
            if (el.className && typeof el.className === 'string') {
                const classes = el.className.trim().split(/\s+/).filter(c => c && !c.includes(':')).slice(0, 3);
                if (classes.length) return `${el.tagName.toLowerCase()}.${classes.map(c => cssEscape(c)).join('.')}`;
            }
            
            return el.tagName.toLowerCase();
        }

        function absoluteXPath(el) {
            if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
            if (el.id) return `//*[@id="${String(el.id).replace(/"/g, '\\"')}"]`;
            const parts = [];
            let node = el;
            while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
                const tag = node.tagName.toLowerCase();
                let index = 1;
                let sib = node.previousElementSibling;
                while (sib) {
                    if (sib.tagName.toLowerCase() === tag) index++;
                    sib = sib.previousElementSibling;
                }
                parts.unshift(`${tag}[${index}]`);
                node = node.parentElement;
            }
            return `/html/${parts.join('/')}`;
        }

        function getElementLabel(el) {
            if (!el) return '';
            const labels = [];
            if (el.id) {
                const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
                if (label?.innerText) labels.push(label.innerText.trim());
            }
            const wrappingLabel = el.closest?.('label');
            if (wrappingLabel?.innerText) labels.push(wrappingLabel.innerText.trim());
            const aria = el.getAttribute('aria-label');
            if (aria) labels.push(aria.trim());
            const placeholder = el.getAttribute('placeholder');
            if (placeholder) labels.push(placeholder.trim());
            const title = el.getAttribute('title');
            if (title) labels.push(title.trim());
            return labels.find(Boolean) || '';
        }

        function selectorMatchCount(candidate) {
            try { return candidateMatches(candidate).length; } catch (_) { return 0; }
        }

        function withSelectorScore(candidate, baseScore) {
            const matches = selectorMatchCount(candidate);
            const visibleMatches = candidateMatches(candidate).filter(isElementVisible).length;
            let confidence = baseScore;
            if (matches === 1) confidence += 10;
            else if (matches > 1) confidence -= Math.min(35, matches * 5);
            if (visibleMatches === 1) confidence += 5;
            if (matches === 0) confidence = 0;
            return {
                ...candidate,
                matches,
                visible_matches: visibleMatches,
                confidence: Math.max(0, Math.min(100, confidence))
            };
        }

        function fieldKeyFromLabel(label, fallback) {
            const source = String(label || fallback || 'field').toLowerCase();
            return source.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'field';
        }

        function generateSelector(el) {
            const candidates = [];
            const label = getElementLabel(el);
            const tag = el.tagName.toLowerCase();
            // Priority 1: Data Attributes
            const dataAttrs = ['data-testid', 'data-name', 'data-qa', 'data-cy', 'data-id'];
            for (const attr of dataAttrs) {
                const val = el.getAttribute(attr);
                if (val) candidates.push(withSelectorScore({ strategy: 'css', primary: 'css', css: `[${attr}="${cssEscape(val)}"]`, label }, 88));
            }

            // Priority 2: ID
            if (el.id && !/^\d/.test(el.id)) { // Avoid numeric IDs which are often dynamic
                candidates.push(withSelectorScore({ strategy: 'id', primary: 'id', id: el.id, element_id: el.id, css: `#${cssEscape(el.id)}`, label }, 84));
            }

            // Priority 3: Name
            if (el.name) candidates.push(withSelectorScore({ strategy: 'name', primary: 'name', name: el.name, css: `${tag}[name="${cssEscape(el.name)}"]`, label }, 72));
            const aria = el.getAttribute('aria-label');
            if (aria) candidates.push(withSelectorScore({ strategy: 'css', primary: 'css', css: `${tag}[aria-label="${cssEscape(aria)}"]`, label: aria }, 70));
            const placeholder = el.getAttribute('placeholder');
            if (placeholder) candidates.push(withSelectorScore({ strategy: 'css', primary: 'css', css: `${tag}[placeholder="${cssEscape(placeholder)}"]`, label: placeholder }, 66));
            const title = el.getAttribute('title');
            if (title) candidates.push(withSelectorScore({ strategy: 'css', primary: 'css', css: `${tag}[title="${cssEscape(title)}"]`, label: title }, 62));

            // Fallback: CSS Path
            candidates.push(withSelectorScore({ strategy: 'css', primary: 'css', css: cssPath(el), label }, 45));
            const xpath = absoluteXPath(el);
            if (xpath) candidates.push(withSelectorScore({ strategy: 'xpath', primary: 'xpath', xpath, label }, 42));
            candidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
            const primary = candidates[0] || { strategy: 'css', primary: 'css', css: cssPath(el), label, confidence: 25 };
            return { ...primary, candidates: candidates.slice(1), xpath: primary.xpath || xpath, label };
        }

        function stepSignature(rule) {
            const step = rule?.steps?.[0] || {};
            const selector = step.selector || {};
            return [
                rule?.site?.match_mode || '',
                rule?.site?.pattern || '',
                rule?.site?.domain || '',
                rule?.site?.path || '',
                step.field_key || '',
                step.action || '',
                String(step.value ?? ''),
                selector.strategy || '',
                selector.primary || '',
                selector.id || '',
                selector.element_id || '',
                selector.name || '',
                selector.css || '',
                selector.xpath || ''
            ].join('|');
        }

        function stepTargetSignature(step) {
            const selector = step?.selector || {};
            return [
                step?.action || '',
                selector.strategy || '',
                selector.id || '',
                selector.name || '',
                selector.css || '',
                selector.xpath || ''
            ].join('|');
        }

        function actionLabel(step) {
            const selector = step.selector || {};
            const selected = selector.id ? `#${selector.id}` : selector.name ? `[name="${selector.name}"]` : selector.css || selector.strategy || 'selector';
            const value = step.action === 'click' ? '' : ` = ${String(step.value ?? '').slice(0, 32)}`;
            const confidence = selector.confidence ? ` (${selector.confidence}%)` : '';
            const label = step.label ? `${step.label}: ` : '';
            return `${step.order}. ${step.action} ${label}${selected}${value}${confidence}`;
        }

        function nicePageName() {
            const path = window.location.pathname.split('/').filter(Boolean).pop() || window.location.hostname;
            return String(path)
                .replace(/\.(do|html?|xhtml|php|aspx?)$/i, '')
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/[-_]+/g, ' ')
                .replace(/\b\w/g, ch => ch.toUpperCase())
                .trim() || window.location.hostname;
        }

        function selectorShortName(step) {
            const selector = step?.selector || {};
            return step?.label
                || step?.field_key
                || selector.label
                || selector.id
                || selector.name
                || step?.element?.visible_text
                || selector.css
                || step?.action
                || 'field';
        }

        function buildRecordRuleName(session) {
            const steps = Array.isArray(session?.steps) ? session.steps : [];
            const page = nicePageName();
            if (!steps.length) return `Autofill ${page}`;
            const actions = steps.map(step => String(step.action || '').toLowerCase());
            const clickOnly = actions.every(action => action === 'click');
            const primary = selectorShortName(steps[0]);
            const cleanPrimary = String(primary).replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 42);
            if (steps.length === 1) {
                if (actions[0] === 'click') return `Click ${cleanPrimary} on ${page}`;
                return `Fill ${cleanPrimary} on ${page}`;
            }
            if (clickOnly) return `Click flow on ${page} (${steps.length} steps)`;
            return `${session.ruleType === 'flow' ? 'Flow' : 'Autofill'} ${page} (${steps.length} fields)`;
        }

        function ensureRecordSession() {
            if (_recordSession) return _recordSession;
            _recordSession = {
                id: `rec_${Date.now()}`,
                name: '',
                autoName: true,
                ruleType: 'instant',
                matchMode: 'domainPath',
                pattern: window.location.hostname + window.location.pathname,
                steps: [],
                lastDebug: 'Waiting for a field interaction',
                startedAt: new Date().toISOString(),
            };
            renderRecordPanel();
            return _recordSession;
        }

        function persistRecordSession() {
            if (!_recordSession) return;
            try {
                window.sessionStorage?.setItem(RECORD_SESSION_TAB_KEY, JSON.stringify(_recordSession));
            } catch (_) {}
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
            try {
                chrome.storage.local.set({ [RECORD_SESSION_KEY]: _recordSession });
            } catch (_) {}
            scheduleRecordHighlights();
        }

        function clearRecordSession() {
            _recordSession = null;
            try {
                window.sessionStorage?.removeItem(RECORD_SESSION_TAB_KEY);
            } catch (_) {}
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
            try {
                chrome.storage.local.remove(RECORD_SESSION_KEY);
            } catch (_) {}
            destroyRecordHighlights();
        }

        async function restoreRecordSession() {
            try {
                const raw = window.sessionStorage?.getItem(RECORD_SESSION_TAB_KEY);
                if (raw) {
                    const saved = JSON.parse(raw);
                    if (saved && typeof saved === 'object') {
                        _recordSession = {
                            ...saved,
                            steps: Array.isArray(saved.steps) ? saved.steps : [],
                            lastDebug: saved.lastDebug || 'Recorder restored after page refresh',
                        };
                        persistRecordSession();
                        return _recordSession;
                    }
                }
            } catch (_) {}
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
            const data = await window.up_getStorage([RECORD_SESSION_KEY]);
            const saved = data?.[RECORD_SESSION_KEY];
            if (!saved || typeof saved !== 'object') return null;
            _recordSession = {
                ...saved,
                steps: Array.isArray(saved.steps) ? saved.steps : [],
                lastDebug: saved.lastDebug || 'Recorder restored after page refresh',
            };
            persistRecordSession();
            return _recordSession;
        }

        function destroyRecordPanel() {
            const panel = document.getElementById('__sa_autofill_record_panel');
            if (panel) panel.remove();
        }

        function destroyRecordHighlights() {
            const layer = document.getElementById(RECORD_LAYER_ID);
            if (layer) layer.remove();
            _recordHoverEl = null;
        }

        function ensureRecordHighlightLayer() {
            let layer = document.getElementById(RECORD_LAYER_ID);
            if (layer) return layer;
            layer = document.createElement('div');
            layer.id = RECORD_LAYER_ID;
            layer.style.cssText = [
                'position:fixed',
                'inset:0',
                'z-index:2147483646',
                'pointer-events:none',
                'font:11px/1.2 ui-sans-serif,Segoe UI,system-ui,sans-serif'
            ].join(';');
            document.documentElement.appendChild(layer);
            return layer;
        }

        function overlayBoxForElement(el, options) {
            if (!el || !(el instanceof Element) || !isElementVisible(el)) return null;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            const box = document.createElement('div');
            const color = options.color || '#2563eb';
            const bg = options.bg || 'rgba(37,99,235,.08)';
            box.style.cssText = [
                'position:fixed',
                `left:${Math.max(0, rect.left - 3)}px`,
                `top:${Math.max(0, rect.top - 3)}px`,
                `width:${Math.max(8, rect.width + 6)}px`,
                `height:${Math.max(8, rect.height + 6)}px`,
                `border:2px solid ${color}`,
                `background:${bg}`,
                'border-radius:8px',
                'box-shadow:0 0 0 3px rgba(255,255,255,.78),0 8px 24px rgba(15,23,42,.14)',
                'box-sizing:border-box'
            ].join(';');
            const label = document.createElement('div');
            label.textContent = options.label || '';
            label.style.cssText = [
                'position:absolute',
                'left:-2px',
                'top:-24px',
                `background:${color}`,
                'color:white',
                'border-radius:999px',
                'padding:4px 8px',
                'font-weight:900',
                'white-space:nowrap',
                'box-shadow:0 6px 16px rgba(15,23,42,.18)',
                'max-width:260px',
                'overflow:hidden',
                'text-overflow:ellipsis'
            ].join(';');
            if (options.label) box.appendChild(label);
            return box;
        }

        function containingRecordSection(el) {
            if (!el || !el.closest) return null;
            return el.closest('form, fieldset, section, article, table, .form-group, .form-row, .row, .card, .panel');
        }

        function renderRecordHighlights() {
            if (!_recording) {
                destroyRecordHighlights();
                return;
            }
            const layer = ensureRecordHighlightLayer();
            layer.innerHTML = '';
            const session = _recordSession;
            if (!session) return;

            for (const step of session.steps || []) {
                const resolved = resolveElement(step.selector, { preferVisible: true });
                const el = resolved.el;
                const box = overlayBoxForElement(el, {
                    color: '#16a34a',
                    bg: 'rgba(22,163,74,.08)',
                    label: `${step.order || ''}. ${step.action || 'step'}${step.label ? `: ${step.label}` : ''}`
                });
                if (box) layer.appendChild(box);
            }

            if (_recordHoverEl && !session.steps?.some(step => resolveElement(step.selector, { preferVisible: true }).el === _recordHoverEl)) {
                const section = containingRecordSection(_recordHoverEl);
                if (section && section !== _recordHoverEl && isElementVisible(section)) {
                    const sectionBox = overlayBoxForElement(section, {
                        color: '#2563eb',
                        bg: 'rgba(37,99,235,.04)',
                        label: 'Recording section'
                    });
                    if (sectionBox) {
                        sectionBox.style.borderStyle = 'dashed';
                        layer.appendChild(sectionBox);
                    }
                }
                const label = getElementLabel(_recordHoverEl) || _recordHoverEl.getAttribute?.('name') || _recordHoverEl.id || _recordHoverEl.tagName?.toLowerCase() || 'field';
                const box = overlayBoxForElement(_recordHoverEl, {
                    color: '#f59e0b',
                    bg: 'rgba(245,158,11,.12)',
                    label: `Recording target: ${label}`
                });
                if (box) layer.appendChild(box);
            }
        }

        function scheduleRecordHighlights() {
            if (_highlightRaf) return;
            _highlightRaf = requestAnimationFrame(() => {
                _highlightRaf = 0;
                renderRecordHighlights();
            });
        }

        function handleRecordTargetPreview(event) {
            if (!_recording) return;
            const source = event.target;
            if (source?.closest?.('#__sa_autofill_record_panel')) return;
            const el = source?.closest?.('input, select, textarea, button, a');
            if (!el || el.type === 'password') return;
            _recordHoverEl = el;
            scheduleRecordHighlights();
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
                    'width:392px',
                    'max-width:calc(100vw - 32px)',
                    'background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%)',
                    'color:#172033',
                    'border:1px solid rgba(59,130,246,.24)',
                    'border-radius:12px',
                    'box-shadow:0 18px 50px rgba(15,23,42,.18),0 0 0 1px rgba(255,255,255,.9) inset',
                    'font:12px/1.45 ui-sans-serif,Segoe UI,Inter,system-ui,sans-serif',
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
                        persistRecordSession();
                        scheduleRecordHighlights();
                        renderRecordPanel();
                    } else if (action === 'clear') {
                        session.steps = [];
                        session.lastDebug = 'Recorder cleared. Capture the next field interaction.';
                        persistRecordSession();
                        scheduleRecordHighlights();
                        renderRecordPanel();
                    } else if (action === 'cancel') {
                        clearRecordSession();
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
                    persistRecordSession();
                    renderRecordPanel();
                }, true);
                panel.addEventListener('input', (event) => {
                    event.stopPropagation();
                    const target = event.target;
                    if (!(target instanceof HTMLInputElement)) return;
                    if (target.dataset.field === 'name') {
                        session.name = target.value;
                        session.autoName = false;
                    }
                    if (target.dataset.field === 'pattern') session.pattern = target.value;
                    persistRecordSession();
                }, true);
                document.documentElement.appendChild(panel);
            }
            const rows = session.steps.map((step, index) => `
                <div style="display:flex;gap:9px;align-items:flex-start;margin:8px 10px;padding:9px;border:1px solid #dbe7f5;background:#ffffff;border-radius:10px;box-shadow:0 4px 14px rgba(15,23,42,.06)">
                    <div style="width:22px;height:22px;border-radius:999px;background:#2563eb;color:#eff6ff;display:grid;place-items:center;font-weight:800;font-size:11px;flex:none">${index + 1}</div>
                    <div style="flex:1;min-width:0;word-break:break-word">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                            <span style="font-weight:800;color:#172033;text-transform:capitalize">${escapeHtml(step.action || 'step')}</span>
                            ${step.label ? `<span style="color:#2563eb">${escapeHtml(step.label)}</span>` : ''}
                        </div>
                        <div style="margin-top:4px;color:#475569;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px">${escapeHtml((step.selector?.id ? `#${step.selector.id}` : step.selector?.name ? `[name="${step.selector.name}"]` : step.selector?.css || step.selector?.xpath || 'selector')).slice(0, 96)}</div>
                        ${step.action !== 'click' ? `<div style="margin-top:4px;color:#64748b;font-size:11px">Value: <span style="color:#172033">${escapeHtml(String(step.value ?? '').slice(0, 64)) || '(empty)'}</span></div>` : ''}
                        <div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">
                            <span style="padding:2px 6px;border-radius:999px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">${escapeHtml(step.selector?.source || step.selector?.primary || step.selector?.strategy || 'selector')}</span>
                            ${step.selector?.confidence !== undefined ? `<span style="padding:2px 6px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0">${escapeHtml(step.selector.confidence)}% confidence</span>` : ''}
                            ${step.selector?.matches !== undefined ? `<span style="padding:2px 6px;border-radius:999px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0">${escapeHtml(step.selector.matches)} match${step.selector.matches === 1 ? '' : 'es'}</span>` : ''}
                            ${step.selector?.visible_matches !== undefined ? `<span style="padding:2px 6px;border-radius:999px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0">${escapeHtml(step.selector.visible_matches)} visible</span>` : ''}
                        </div>
                    </div>
                    <button data-action="remove" data-index="${index}" title="Delete step" style="border:1px solid #fecaca;background:#fff1f2;color:#be123c;border-radius:8px;padding:4px 7px;cursor:pointer;font-weight:800">x</button>
                </div>
            `).join('');
            const controlStyle = 'width:100%;box-sizing:border-box;background:#ffffff;color:#172033;border:1px solid #cbd5e1;border-radius:8px;padding:7px 9px;outline:none;font:700 12px ui-sans-serif,Segoe UI,system-ui,sans-serif;box-shadow:0 1px 0 rgba(15,23,42,.03)';
            const labelStyle = 'display:block;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em';
            const fieldWrap = 'display:grid;gap:4px';
            const displayName = session.autoName === false && session.name ? session.name : buildRecordRuleName(session);
            panel.innerHTML = `
                <div style="padding:12px 14px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;background:#f8fbff">
                    <div style="width:28px;height:28px;border-radius:9px;background:#2563eb;display:grid;place-items:center;color:white;font-weight:900">AF</div>
                    <div style="min-width:0">
                        <div style="font-size:13px;font-weight:900;color:#172033">Autofill Recorder</div>
                        <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(window.location.hostname)}</div>
                    </div>
                    <span style="margin-left:auto;padding:4px 8px;border-radius:999px;background:${session.steps.length ? '#ecfdf5' : '#eff6ff'};color:${session.steps.length ? '#047857' : '#1d4ed8'};border:1px solid ${session.steps.length ? '#a7f3d0' : '#bfdbfe'};font-weight:900">${session.steps.length} step${session.steps.length === 1 ? '' : 's'}</span>
                </div>
                <div style="padding:12px 14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <label style="grid-column:1/-1;${fieldWrap}"><span style="${labelStyle}">Rule name</span><input data-field="name" value="${escapeHtml(displayName)}" style="${controlStyle}"></label>
                    <label style="${fieldWrap}"><span style="${labelStyle}">Mode</span><select data-field="ruleType" style="${controlStyle}"><option value="instant"${session.ruleType === 'instant' ? ' selected' : ''}>Instant fill</option><option value="flow"${session.ruleType === 'flow' ? ' selected' : ''}>Step flow</option></select></label>
                    <label style="${fieldWrap}"><span style="${labelStyle}">Page scope</span><select data-field="matchMode" style="${controlStyle}"><option value="domainPath"${session.matchMode === 'domainPath' ? ' selected' : ''}>This page</option><option value="domain"${session.matchMode === 'domain' ? ' selected' : ''}>Whole domain</option><option value="fullUrl"${session.matchMode === 'fullUrl' ? ' selected' : ''}>Exact URL</option></select></label>
                    <label style="grid-column:1/-1;${fieldWrap}"><span style="${labelStyle}">Match pattern</span><input data-field="pattern" value="${escapeHtml(session.pattern)}" style="${controlStyle};font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:700"></label>
                    <div style="grid-column:1/-1;padding:8px 9px;border-radius:9px;background:#eff6ff;border:1px solid #bfdbfe;color:#334155;word-break:break-word">${escapeHtml(session.lastDebug || '')}</div>
                </div>
                <div style="max-height:278px;overflow:auto;padding-bottom:${session.steps.length ? '2px' : '0'}">${rows || '<div style="margin:0 14px 12px;padding:16px 12px;border:1px dashed #cbd5e1;border-radius:10px;color:#64748b;background:#f8fafc;text-align:center"><div style="font-weight:900;color:#172033;margin-bottom:4px">Ready to capture</div><div>Interact with fields, selects, checkboxes, radios, or buttons on the page.</div></div>'}</div>
                <div style="padding:11px 14px;display:flex;gap:8px;border-top:1px solid #e2e8f0;background:#f8fbff">
                    <button data-action="save" style="background:#16a34a;color:white;border:1px solid #15803d;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:900;box-shadow:0 8px 18px rgba(22,163,74,.18)">Save</button>
                    <button data-action="clear" style="background:#ffffff;color:#334155;border:1px solid #cbd5e1;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:900">Clear</button>
                    <button data-action="cancel" style="margin-left:auto;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:900">Stop</button>
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
                showRecordToast('No steps recorded', false);
                return;
            }
            const rule = {
                local_rule_id: session.id,
                name: session.name || buildRecordRuleName(session),
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
                clearRecordSession();
                chrome.storage.local.set({ isRecording: false });
                _recording = false;
                destroyRecordPanel();
                destroyRecordHighlights();
            } else {
                showRecordToast(`Save failed: ${resp?.error || 'unknown'}`, false);
            }
        }

        function handleInteraction(e) {
            if (!_recording) return;
            if (e.isTrusted === false) return;
            const source = e.submitter || e.target;
            if (source?.closest?.('#__sa_autofill_record_panel')) return;
            const el = source?.closest?.('input, select, textarea, button, a');
            if (!el || el.type === 'password') return;
            if (['pointerdown', 'mousedown', 'touchstart'].includes(e.type) && !(['BUTTON', 'A'].includes(el.tagName) || ['submit', 'button'].includes(el.type))) return;
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
            const selector = generateSelector(el);
            const label = getElementLabel(el);
            const step = {
                order: session.steps.length + 1,
                field_key: fieldKeyFromLabel(label, el.name || el.id || el.tagName),
                label,
                action,
                value,
                selector,
                element: {
                    tag: el.tagName.toLowerCase(),
                    type: el.type || '',
                    id: el.id || '',
                    name: el.name || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    aria_label: el.getAttribute('aria-label') || '',
                    title: el.getAttribute('title') || '',
                    visible_text: ['BUTTON', 'A', 'OPTION'].includes(el.tagName) ? String(el.innerText || el.textContent || '').trim().slice(0, 160) : '',
                    visible: isElementVisible(el),
                    disabled: !!el.disabled,
                    readonly: !!el.readOnly
                },
                runtime: {
                    required: true,
                    delay_ms: session.ruleType === 'instant' ? 100 : 150,
                    timeout_ms: session.ruleType === 'instant' ? 2500 : 5000,
                    verify_after_fill: true
                },
                delay_ms: session.ruleType === 'instant' ? 100 : 150,
                timeout_ms: session.ruleType === 'instant' ? 2500 : 5000,
                required: true,
                meta: {
                    tag: el.tagName.toLowerCase(),
                    element_id: el.id || '',
                    element_name: el.name || '',
                    domain: window.location.hostname,
                    path: window.location.pathname,
                    full_url: window.location.href,
                    css: selector.css || '',
                    xpath: selector.xpath || '',
                    selector_confidence: selector.confidence || 0
                }
            };
            session.lastDebug = `${action} captured from ${selector.strategy || selector.primary || 'selector'} with ${selector.confidence || 0}% confidence`;

            const signature = stepSignature({
                site: { match_mode: session.matchMode, pattern: session.pattern },
                steps: [step]
            });
            const now = Date.now();
            if (signature === _lastRecordedSignature && (now - _lastRecordedAt) < 1500) return;
            _lastRecordedSignature = signature;
            _lastRecordedAt = now;

            const lastStep = session.steps[session.steps.length - 1];
            if (['text', 'select', 'checkbox', 'radio'].includes(action) && lastStep && stepTargetSignature(lastStep) === stepTargetSignature(step)) {
                lastStep.value = value;
                lastStep.action = action;
                lastStep.meta = { ...(lastStep.meta || {}), updated_at: new Date().toISOString() };
            } else {
                session.steps.push(step);
                showRecordToast(`Recorded ${action} step`, true);
            }
            if (session.autoName !== false) session.name = buildRecordRuleName(session);
            persistRecordSession();
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
            toast.style.background = isOn ? '#15803d' : '#b91c1c';
            toast.style.color = '#ffffff';
            toast.style.opacity = '1';
            clearTimeout(toast._hideTimer);
            toast._hideTimer = setTimeout(() => {
                if (toast) toast.style.opacity = '0';
            }, 2200);
        }

        function installRecordListeners() {
            if (_recordListenersInstalled) return;
            _recordListenersInstalled = true;
            document.addEventListener('input', handleInteraction, true);
            document.addEventListener('change', handleInteraction, true);
            document.addEventListener('pointerdown', handleInteraction, true);
            document.addEventListener('mousedown', handleInteraction, true);
            document.addEventListener('touchstart', handleInteraction, true);
            document.addEventListener('click', handleInteraction, true);
            document.addEventListener('submit', handleInteraction, true);
            document.addEventListener('pointerover', handleRecordTargetPreview, true);
            document.addEventListener('focusin', handleRecordTargetPreview, true);
            window.addEventListener('scroll', scheduleRecordHighlights, true);
            window.addEventListener('resize', scheduleRecordHighlights, true);
        }

        function installStorageListener() {
            if (_storageListenerInstalled || typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
            _storageListenerInstalled = true;
            chrome.storage.onChanged.addListener(async (changes, area) => {
                if (area !== 'local' || !changes.isRecording) return;
                const next = changes.isRecording.newValue === true;
                await window.AutofillModule.toggleRecording(next);
            });
        }

        return {
            async activate() {
                const gate = await window.up_getStorage(['isRecording', 'isMaster', 'rules']);
                _recording = !!gate.isRecording && !!gate.isMaster;
                if (_recording) await restoreRecordSession();
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
                _mutationObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'style', 'class', 'aria-disabled'] });
                installRecordListeners();
                installStorageListener();
                if (_recording) {
                    renderRecordPanel();
                    scheduleRecordHighlights();
                }
                runEngine();
                debugLog('[Autofill] V26 Engine active');
            },
            async toggleRecording(state) {
                _recording = state;
                if (_recording) {
                    await restoreRecordSession();
                    ensureRecordSession();
                    renderRecordPanel();
                    scheduleRecordHighlights();
                } else {
                    clearRecordSession();
                    destroyRecordPanel();
                    destroyRecordHighlights();
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
