// extension/modules/captcha.js
(function () {
    'use strict';

    window.CaptchaModule = (() => {
        let _active = false;
        let _tickInterval = null;
        const _solvedMap = new Map(); // src → b64 prefix, per-captcha dedup
        const _SOLVED_MAP_LIMIT = 1000;

        function updateSolvedMap(key, value) {
            if (_solvedMap.has(key)) {
                _solvedMap.delete(key);
            } else if (_solvedMap.size >= _SOLVED_MAP_LIMIT) {
                const firstKey = _solvedMap.keys().next().value;
                _solvedMap.delete(firstKey);
            }
            _solvedMap.set(key, value);
        }

        function normHost(h) {
            return String(h || '').replace(/^www\./, '').toLowerCase();
        }

        function isSarathiHost() {
            return normHost(window.location.hostname) === 'sarathi.parivahan.gov.in';
        }

        function isStallExamSelectUrl() {
            return isSarathiHost() && window.location.pathname.toLowerCase() === '/sarathiservice/examselectaction.do';
        }

        function hasConfiguredTarget(data) {
            const host = normHost(window.location.hostname);
            const globalRoutes = data.globalFieldRoutes?.[host]
                              || data.globalFieldRoutes?.['www.' + host]
                              || [];
            const localRoutes = (data.domainFieldRoutes || []).filter(route => {
                const routeDomain = normHost(route.domain);
                return routeDomain === host || routeDomain === `www.${host}`;
            });
            const locators = { ...(data.globalLocators || {}), ...(data.customLocators || {}) };
            return globalRoutes.length > 0
                || localRoutes.length > 0
                || !!locators?.[host]
                || !!locators?.['www.' + host];
        }

        // Set value via native setter (React/Angular/Vue safe)
        function setNativeVal(el, value) {
            try {
                const proto = el instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, value);
                else el.value = value;
            } catch (_) { el.value = value; }
        }

        async function waitForImageReady(img, timeoutMs = 2000) {
            if (!img) return false;
            const ready = () => img.complete && (img.naturalWidth || img.width) > 0 && (img.naturalHeight || img.height) > 0;
            if (ready()) return true;
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                await new Promise(r => setTimeout(r, 50));
                if (ready()) return true;
            }
            return ready();
        }

        function dispatchFillEvents(inp, value) {
            let inputEvent;
            try {
                inputEvent = new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value });
            } catch (_) {
                inputEvent = new Event('input', { bubbles: true });
            }
            inp.dispatchEvent(inputEvent);
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new KeyboardEvent('keyup', { key: String(value || '').slice(-1) || 'Unidentified', bubbles: true, cancelable: true }));
        }

        async function fastFillCaptcha(inp, text) {
            if (!inp) return;
            const value = String(text || '').trim();
            if (!value) return;
            setNativeVal(inp, value);
            dispatchFillEvents(inp, value);
        }

        // Priority 1: server/local domain field routes
        function findImagePairFromRoutes(routes) {
            const imageRoutes = (routes || []).filter(r =>
                (r.task_type || r.taskType || r.source_data_type) === 'image'
            );
            for (const route of imageRoutes) {
                try {
                    const sourceSelector = route.source_selector || route.sourceSelector;
                    const targetSelector = route.target_selector || route.targetSelector;
                    const img = document.querySelector(sourceSelector);
                    const inp = document.querySelector(targetSelector);
                    if (img && inp) return { img, inp, fieldName: route.field_name || route.fieldName };
                } catch (_) {}
            }
            return null;
        }

        function getTextRoutePairs(routes) {
            const pairs = [];
            const textRoutes = (routes || []).filter(r =>
                (r.task_type || r.taskType || r.source_data_type) === 'text'
            );
            for (const route of textRoutes) {
                try {
                    const sourceSelector = route.source_selector || route.sourceSelector;
                    const targetSelector = route.target_selector || route.targetSelector;
                    const source = document.querySelector(sourceSelector);
                    const target = document.querySelector(targetSelector);
                    if (source && target) {
                        pairs.push({
                            source,
                            target,
                            fieldName: route.field_name || route.fieldName || 'text_default',
                        });
                    }
                } catch (_) {}
            }
            return pairs;
        }

        // Priority 2: server-synced globalLocators
        function findPairFromLocators(locators) {
            const host = normHost(window.location.hostname);
            const loc = locators?.[host] || locators?.['www.' + host];
            if (loc?.img && loc?.input) {
                try {
                    const img = document.querySelector(loc.img);
                    const inp = document.querySelector(loc.input);
                    if (img && inp) return { img, inp };
                } catch (_) {}
            }
            return null;
        }

        // Priority 3: heuristic fallback (common captcha selectors)
        function findPairHeuristic() {
            const SELECTORS = [
                '#capimg', '#capimg1', '#captchaImg', '#captcha-img',
                'img[src*="captcha"]', 'img[src*="captchaimage"]',
                'img[src*=".jsp"]', 'img[id*="captcha"]', 'img[class*="captcha"]',
            ];
            for (const sel of SELECTORS) {
                try {
                    const img = document.querySelector(sel);
                    if (!img) continue;
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (w < 20 || h < 10) continue;
                    const parent = img.closest('form, div, td, tr') || document.body;
                    const inp = parent.querySelector(
                        'input[id*="captcha"], input[name*="captcha"], ' +
                        'input[id*="capt"], input[name*="capt"], ' +
                        'input[type="text"], input:not([type])'
                    );
                    if (inp) return { img, inp };
                } catch (_) {}
            }
            return null;
        }

        async function solve(img, inp, fieldName) {
            if (!(await waitForImageReady(img))) return;
            const b64 = window.up_imgToB64(img);
            if (!b64) return;
            const cacheKey = img.src || b64.slice(0, 80);
            const b64Key   = b64.slice(0, 80);
            if (_solvedMap.get(cacheKey) === b64Key) return; // same image already solved

            const domain = normHost(window.location.hostname);
            const resp = await window.up_sendMsg('SOLVE_CAPTCHA', {
                taskType:   'image',
                imageB64:   b64,
                domain,
                field_name: fieldName || 'image_default',
            });
            if (!resp?.ok || !resp.result) {
                console.warn('[Captcha] Solve failed:', resp?.error);
                return;
            }

            updateSolvedMap(cacheKey, b64Key);
            await fastFillCaptcha(inp, resp.result);
            console.log(`[Captcha] ✓ "${resp.result}" in ${resp.ms}ms (${domain})`);
        }

        async function solveTextRoute(source, target, fieldName) {
            const raw = (source.value ?? source.textContent ?? '').trim();
            if (!raw) return;
            const cacheKey = `${fieldName}:${raw.slice(0, 120)}`;
            if (_solvedMap.get(cacheKey) === raw) return;

            const domain = normHost(window.location.hostname);
            const resp = await window.up_sendMsg('SOLVE_CAPTCHA', {
                taskType:   'text',
                imageB64:   window.up_utf8ToB64(raw),
                domain,
                field_name: fieldName || 'text_default',
            });
            if (!resp?.ok || !resp.result) {
                console.warn('[Captcha] Text route solve failed:', resp?.error);
                return;
            }

            updateSolvedMap(cacheKey, raw);
            await fastFillCaptcha(target, resp.result);
            console.log(`[Captcha] ✓ text route "${resp.result}" in ${resp.ms}ms (${domain})`);
        }

        async function tick() {
            if (!_active) return;
            const data = await window.up_getStorage(['globalFieldRoutes', 'domainFieldRoutes', 'globalLocators', 'customLocators', 'captchaEnabled']);
            if (data.captchaEnabled === false) return;

            const host   = normHost(window.location.hostname);
            const globalRoutes = data.globalFieldRoutes?.[host]
                              || data.globalFieldRoutes?.['www.' + host]
                              || [];
            const localRoutes = (data.domainFieldRoutes || []).filter(route => {
                const routeDomain = normHost(route.domain);
                return routeDomain === host || routeDomain === `www.${host}`;
            });
            const routes = [...globalRoutes, ...localRoutes];
            const locators = { ...(data.globalLocators || {}), ...(data.customLocators || {}) };

            const pair = findImagePairFromRoutes(routes)
                      || findPairFromLocators(locators)
                      || findPairHeuristic();

            if (pair) await solve(pair.img, pair.inp, pair.fieldName);

            const textPairs = getTextRoutePairs(routes);
            for (const item of textPairs) {
                await solveTextRoute(item.source, item.target, item.fieldName);
            }
        }

        return {
            async activate() {
                const data = await window.up_getStorage(['globalFieldRoutes', 'domainFieldRoutes', 'globalLocators', 'customLocators', 'captchaEnabled']);
                if (data.captchaEnabled === false) return;
                if (isStallExamSelectUrl()) {
                    const host = normHost(window.location.hostname);
                    const globalRoutes = data.globalFieldRoutes?.[host]
                                      || data.globalFieldRoutes?.['www.' + host]
                                      || [];
                    const localRoutes = (data.domainFieldRoutes || []).filter(route => {
                        const routeDomain = normHost(route.domain);
                        return routeDomain === host || routeDomain === `www.${host}`;
                    });
                    const locators = { ...(data.globalLocators || {}), ...(data.customLocators || {}) };
                    const visiblePair = findImagePairFromRoutes([...globalRoutes, ...localRoutes])
                                     || findPairFromLocators(locators)
                                     || findPairHeuristic();
                    if (!visiblePair) {
                        console.debug('[Captcha] Module skipped on STALL exam select (no visible captcha target)');
                        return;
                    }
                }
                if (!isSarathiHost() && !hasConfiguredTarget(data) && !findPairHeuristic()) {
                    console.debug('[Captcha] Module skipped (no route or visible captcha target)');
                    return;
                }
                _active = true;
                tick(); // immediate first try
                if (_tickInterval) clearInterval(_tickInterval);
                _tickInterval = setInterval(tick, 2500);
                console.log('[Captcha] Module active (route-aware)');
            },
            deactivate() { _active = false; if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; } },
            resetCache() { _solvedMap.clear(); }, // called when routes update
        };
    })();

})();
