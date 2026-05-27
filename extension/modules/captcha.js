// extension/modules/captcha.js
(function () {
    'use strict';

    window.CaptchaModule = (() => {
        const DEBUG_LOGS = false;
        const debugLog = (...args) => { if (DEBUG_LOGS) console.log(...args); };
        let _active = false;
        let _tickInterval = null;
        let _lastForcedSyncAt = 0;
        let _forcedSyncInFlight = null;
        const _solvedMap = new Map(); // src → b64 prefix, per-captcha dedup
        const _SOLVED_MAP_LIMIT = 1000;
        const FORCE_SYNC_COOLDOWN_MS = 30000;
        const DEBUG_STATE_KEY = '_captchaLastStatus';

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

        function setStatus(status, extra = {}) {
            const payload = {
                status,
                host: normHost(window.location.hostname),
                path: window.location.pathname,
                ts: Date.now(),
                ...extra,
            };
            debugLog('[Captcha]', payload);
            try { chrome.storage?.local?.set({ [DEBUG_STATE_KEY]: payload }); } catch (_) {}
        }

        function isVisible(el) {
            if (!el || !(el instanceof Element)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        function queryBest(selector) {
            const nodes = Array.from(document.querySelectorAll(selector || ''));
            return nodes.find(isVisible) || nodes[0] || null;
        }

        function queryVisible(selector) {
            return Array.from(document.querySelectorAll(selector || '')).filter(isVisible);
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
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: String(value || '').slice(-1) || 'Unidentified', bubbles: true, cancelable: true }));
            inp.dispatchEvent(new KeyboardEvent('keypress', { key: String(value || '').slice(-1) || 'Unidentified', bubbles: true, cancelable: true }));
            inp.dispatchEvent(inputEvent);
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new KeyboardEvent('keyup', { key: String(value || '').slice(-1) || 'Unidentified', bubbles: true, cancelable: true }));
        }

        async function fastFillCaptcha(inp, text) {
            if (!inp) return;
            const value = String(text || '').trim();
            if (!value) return;
            if (typeof inp.focus === 'function') inp.focus();
            setNativeVal(inp, value);
            dispatchFillEvents(inp, value);
            if (typeof window.EnableDisableMB === 'function') {
                try { window.EnableDisableMB(); } catch (_) {}
            }
            if (typeof inp.blur === 'function') inp.blur();
        }

        // Priority 1: server/local domain field routes
        function findImagePairFromRoutes(routes) {
            const imageRoutes = (routes || []).filter(r =>
                (r.task_type || r.taskType || r.source_data_type) === 'image'
            );
            const misses = [];
            for (const route of imageRoutes) {
                try {
                    const sourceSelector = route.source_selector || route.sourceSelector;
                    const targetSelector = route.target_selector || route.targetSelector;
                    const visibleImages = queryVisible(sourceSelector);
                    const visibleInputs = queryVisible(targetSelector);
                    if (visibleImages.length && visibleInputs.length) {
                        return {
                            img: visibleImages[0],
                            inp: visibleInputs[0],
                            fieldName: route.field_name || route.fieldName,
                            sourceSelector,
                            targetSelector,
                        };
                    }
                    const img = queryBest(sourceSelector);
                    const inp = queryBest(targetSelector);
                    misses.push({
                        sourceSelector,
                        targetSelector,
                        imageFound: !!img,
                        inputFound: !!inp,
                        imageVisible: isVisible(img),
                        inputVisible: isVisible(inp),
                    });
                } catch (_) {}
            }
            if (imageRoutes.length) setStatus('route_not_visible', { routeCount: imageRoutes.length, misses: misses.slice(0, 8) });
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
                    const img = queryBest(loc.img);
                    const inp = queryBest(loc.input);
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
                    const img = queryBest(sel);
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

        async function forceRouteSync(reason) {
            const now = Date.now();
            if (_forcedSyncInFlight) return _forcedSyncInFlight;
            if (now - _lastForcedSyncAt < FORCE_SYNC_COOLDOWN_MS) return null;
            _lastForcedSyncAt = now;
            debugLog(`[Captcha] Forcing route sync: ${reason}`);
            _forcedSyncInFlight = window.up_sendMsg('SYNC_NOW', {})
                .catch(error => ({ ok: false, error: error?.message || String(error) }))
                .finally(() => { _forcedSyncInFlight = null; });
            return _forcedSyncInFlight;
        }

        async function solve(img, inp, fieldName, routeInfo = {}) {
            if (!(await waitForImageReady(img))) {
                setStatus('image_not_ready', { fieldName, imageId: img?.id || '', imageSrc: img?.src || '', ...routeInfo });
                return;
            }
            const b64 = window.up_imgToB64(img);
            if (!b64) {
                setStatus('image_capture_failed', { fieldName, imageId: img?.id || '', imageSrc: img?.src || '', ...routeInfo });
                return;
            }
            const cacheKey = img.src || b64.slice(0, 80);
            const b64Key   = b64.slice(0, 80);
            const cached = _solvedMap.get(cacheKey);
            const cachedB64 = typeof cached === 'object' ? cached.b64Key : cached;
            const cachedResult = typeof cached === 'object' ? cached.result : '';
            if (cachedB64 === b64Key) {
                if (cachedResult && String(inp.value || '').trim() !== String(cachedResult).trim()) {
                    await fastFillCaptcha(inp, cachedResult);
                    setStatus('filled_cached_same_image', { fieldName, resultLength: String(cachedResult || '').length, target: inp?.id || inp?.name || '', ...routeInfo });
                    return;
                }
                setStatus('skipped_same_image', { fieldName, target: inp?.id || inp?.name || '', targetValueLength: String(inp.value || '').trim().length, ...routeInfo });
                return;
            }

            const domain = normHost(window.location.hostname);
            setStatus('solving', { fieldName: fieldName || 'image_default', imageId: img?.id || '', target: inp?.id || inp?.name || '', ...routeInfo });
            const resp = await window.up_sendMsg('SOLVE_CAPTCHA', {
                taskType:   'image',
                imageB64:   b64,
                domain,
                field_name: fieldName || 'image_default',
            });
            if (!resp?.ok || !resp.result) {
                console.warn('[Captcha] Solve failed:', resp?.error);
                setStatus('solve_failed', { fieldName, error: resp?.error || 'empty result', ...routeInfo });
                return;
            }

            updateSolvedMap(cacheKey, { b64Key, result: String(resp.result || '').trim() });
            await fastFillCaptcha(inp, resp.result);
            setStatus('filled', { fieldName, resultLength: String(resp.result || '').length, target: inp?.id || inp?.name || '', ...routeInfo });
            debugLog(`[Captcha] ✓ "${resp.result}" in ${resp.ms}ms (${domain})`);
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
            debugLog(`[Captcha] ✓ text route "${resp.result}" in ${resp.ms}ms (${domain})`);
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

            let routePair = findImagePairFromRoutes(routes);
            let locatorPair = findPairFromLocators(locators);
            let heuristicPair = findPairHeuristic();
            let pair = routePair || locatorPair || heuristicPair;

            if (heuristicPair && !routePair) {
                await forceRouteSync('visible captcha found but no matching synced route for host');
                const refreshed = await window.up_getStorage(['globalFieldRoutes', 'domainFieldRoutes', 'globalLocators', 'customLocators']);
                const refreshedRoutes = [
                    ...(refreshed.globalFieldRoutes?.[host] || refreshed.globalFieldRoutes?.['www.' + host] || []),
                    ...((refreshed.domainFieldRoutes || []).filter(route => {
                        const routeDomain = normHost(route.domain);
                        return routeDomain === host || routeDomain === `www.${host}`;
                    })),
                ];
                const refreshedLocators = { ...(refreshed.globalLocators || {}), ...(refreshed.customLocators || {}) };
                const refreshedPair = findImagePairFromRoutes(refreshedRoutes) || findPairFromLocators(refreshedLocators);
                if (refreshedPair) {
                    await solve(refreshedPair.img, refreshedPair.inp, refreshedPair.fieldName, {
                        sourceSelector: refreshedPair.sourceSelector || '',
                        targetSelector: refreshedPair.targetSelector || '',
                    });
                    return;
                }
                pair = locatorPair || heuristicPair;
            }

            if (pair) {
                await solve(pair.img, pair.inp, pair.fieldName, {
                    sourceSelector: pair.sourceSelector || '',
                    targetSelector: pair.targetSelector || '',
                });
            }

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
                debugLog('[Captcha] Module active (route-aware)');
            },
            deactivate() { _active = false; if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; } },
            resetCache() { _solvedMap.clear(); }, // called when routes update
        };
    })();

})();
