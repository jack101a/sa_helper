// modules/userscript_engine.js - ta-ta Extension
// Lightweight Userscript Engine (Content Script)

(async function() {
    'use strict';

    if (window.__USERSCRIPT_ENGINE_INITIALIZED__) return;
    window.__USERSCRIPT_ENGINE_INITIALIZED__ = true;

    function isExcludedHost() {
        const host = String(location.hostname || '').replace(/^www\./, '').toLowerCase();
        return host === 'web.whatsapp.com' || host === 'google.com' || host.endsWith('.google.com') || host.endsWith('.bank.in');
    }

    if (!/^https?:$/i.test(location.protocol) || isExcludedHost()) return;

    console.log('[Userscript Engine] Booting...');

    const GM_SHIM = `
(function() {
    if (window.__UP_GM_SHIM_READY__) return;
    window.__UP_GM_SHIM_READY__ = true;
    const callbacks = {};
    const valueListeners = {};
    function request(action, payload, scriptId) {
        const requestId = Math.random().toString(36).slice(2);
        window.postMessage({ type: 'GM_REQUEST', action, requestId, scriptId, ...payload }, '*');
        return new Promise((resolve, reject) => {
            callbacks[requestId] = { resolve, reject };
            setTimeout(() => {
                if (callbacks[requestId]) {
                    delete callbacks[requestId];
                    reject(new Error('GM request timed out'));
                }
            }, 30000);
        });
    }
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.type !== 'GM_RESPONSE') return;
        const cb = callbacks[e.data.requestId];
        if (!cb) return;
        delete callbacks[e.data.requestId];
        if (e.data.error) cb.reject(new Error(e.data.error));
        else cb.resolve(e.data);
    });
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.type !== 'GM_VALUE_CHANGED') return;
        const scriptId = e.data.scriptId || 'global';
        const hooks = valueListeners[scriptId] || {};
        const oldStore = e.data.oldValue || {};
        const newStore = e.data.newValue || {};
        const keys = new Set([...Object.keys(oldStore), ...Object.keys(newStore)]);
        keys.forEach(key => {
            Object.values(hooks[key] || {}).forEach(fn => {
                try { fn(key, oldStore[key], newStore[key], true); } catch (err) { console.error(err); }
            });
        });
    });
    window.__createGMApi = function(scriptId, info) {
        const addStyle = (css) => {
            const style = document.createElement('style');
            style.textContent = String(css || '');
            (document.head || document.documentElement).appendChild(style);
            return style;
        };
        const addElement = (parent, tag, attrs) => {
            if (typeof parent === 'string') {
                attrs = tag;
                tag = parent;
                parent = document.head || document.documentElement;
            }
            const el = document.createElement(String(tag || 'div'));
            Object.entries(attrs || {}).forEach(([name, val]) => {
                if (name === 'textContent') el.textContent = val;
                else if (name === 'innerHTML') el.innerHTML = val;
                else el.setAttribute(name, val);
            });
            (parent || document.head || document.documentElement).appendChild(el);
            return el;
        };
        const addValueChangeListener = (key, fn) => {
            if (typeof fn !== 'function') return '';
            const id = Math.random().toString(36).slice(2);
            const bucket = valueListeners[scriptId] = valueListeners[scriptId] || {};
            const hooks = bucket[key] = bucket[key] || {};
            hooks[id] = fn;
            request('addValueChangeListener', { key, listenerId: id }, scriptId).catch(() => {});
            return id;
        };
        const removeValueChangeListener = (listenerId) => {
            Object.values(valueListeners[scriptId] || {}).forEach(hooks => delete hooks[listenerId]);
            request('removeValueChangeListener', { listenerId }, scriptId).catch(() => {});
        };
        const api = {
            info: info || {},
            addStyle,
            addElement,
            getValue: (key, defaultValue) => request('getValue', { key, defaultValue }, scriptId).then(r => r.value),
            setValue: (key, value) => request('setValue', { key, value }, scriptId).then(r => r.ok),
            deleteValue: (key) => request('deleteValue', { key }, scriptId).then(r => r.ok),
            listValues: () => request('listValues', {}, scriptId).then(r => r.values || []),
            addValueChangeListener,
            removeValueChangeListener,
            notification: (details) => request('notification', { details }, scriptId).catch(() => ({ ok: false })),
            openInTab: (url, opts) => request('openInTab', { details: { ...(opts || {}), url } }, scriptId),
            download: (details, name) => request('download', { details: typeof details === 'string' ? { url: details, name } : details }, scriptId),
            registerMenuCommand: (text, cb, opts) => {
                const id = opts?.id || Math.random().toString(36).slice(2);
                request('registerMenuCommand', { details: { id, text } }, scriptId).catch(() => {});
                return id;
            },
            unregisterMenuCommand: (id) => request('unregisterMenuCommand', { details: { id } }, scriptId).catch(() => {}),
            log: (...args) => request('log', { details: { args } }, scriptId).catch(() => console.log(...args)),
            setClipboard: (text) => navigator.clipboard?.writeText ? navigator.clipboard.writeText(String(text || '')) : Promise.reject(new Error('clipboard unavailable')),
            xmlhttpRequest: (details) => {
                details = details || {};
                const xhrId = Math.random().toString(36).slice(2);
                let aborted = false;
                const fire = (name, payload) => {
                    try {
                        const fn = details && details['on' + name];
                        if (typeof fn === 'function') fn(payload);
                    } catch (err) {
                        console.error('[GM_xmlhttpRequest callback]', err);
                    }
                };
                const safe = {
                    method: details?.method || 'GET',
                    url: details?.url || '',
                    headers: details?.headers || {},
                    data: details?.data ?? null,
                    timeout: Number(details?.timeout || 0) || 0,
                    responseType: details?.responseType || '',
                    anonymous: !!details?.anonymous,
                    xhrId,
                };
                fire('loadstart', { readyState: 1, responseText: '', response: null });
                fire('readystatechange', { readyState: 1, responseText: '', response: null });
                request('xmlhttpRequest', { details: safe }, scriptId)
                    .then(r => {
                        if (aborted || r.aborted) {
                            fire('abort', { readyState: 4, error: r.error || 'aborted' });
                        } else if (r.timedOut) {
                            fire('timeout', { readyState: 4, error: r.error || 'timeout' });
                        } else if (r.error) {
                            fire('error', { readyState: 4, error: r.error });
                        } else if (r.response) {
                            fire('readystatechange', r.response);
                            fire('progress', { ...r.response, lengthComputable: false, loaded: String(r.response.responseText || '').length, total: 0 });
                            fire('load', r.response);
                        }
                        fire('loadend', r.response || { readyState: 4, error: r.error });
                    })
                    .catch(err => {
                        fire(aborted ? 'abort' : 'error', { readyState: 4, error: err.message });
                        fire('loadend', { readyState: 4, error: err.message });
                    });
                return {
                    abort() {
                        aborted = true;
                        request('xmlhttpAbort', { details: { xhrId } }, scriptId).catch(() => {});
                    }
                };
            },
        };
        return api;
    };
    window.GM_addStyle = window.GM_addStyle || ((css) => window.__createGMApi('global').addStyle(css));
    window.GM_addElement = window.GM_addElement || ((parent, tag, attrs) => window.__createGMApi('global').addElement(parent, tag, attrs));
    window.GM_getValue = window.GM_getValue || ((key, fallback) => window.__createGMApi('global').getValue(key, fallback));
    window.GM_setValue = window.GM_setValue || ((key, value) => window.__createGMApi('global').setValue(key, value));
    window.GM_deleteValue = window.GM_deleteValue || ((key) => window.__createGMApi('global').deleteValue(key));
    window.GM_listValues = window.GM_listValues || (() => window.__createGMApi('global').listValues());
    window.GM_addValueChangeListener = window.GM_addValueChangeListener || ((key, fn) => window.__createGMApi('global').addValueChangeListener(key, fn));
    window.GM_removeValueChangeListener = window.GM_removeValueChangeListener || ((id) => window.__createGMApi('global').removeValueChangeListener(id));
    window.GM_xmlhttpRequest = window.GM_xmlhttpRequest || ((details) => window.__createGMApi('global').xmlhttpRequest(details));
    window.GM_notification = window.GM_notification || ((details) => window.__createGMApi('global').notification(details));
    window.GM_setClipboard = window.GM_setClipboard || ((text) => window.__createGMApi('global').setClipboard(text));
    window.GM_openInTab = window.GM_openInTab || ((url, opts) => window.__createGMApi('global').openInTab(url, opts));
    window.GM_download = window.GM_download || ((details, name) => window.__createGMApi('global').download(details, name));
    window.GM_registerMenuCommand = window.GM_registerMenuCommand || ((text, cb, opts) => window.__createGMApi('global').registerMenuCommand(text, cb, opts));
    window.GM_unregisterMenuCommand = window.GM_unregisterMenuCommand || ((id) => window.__createGMApi('global').unregisterMenuCommand(id));
    window.GM_log = window.GM_log || ((...args) => window.__createGMApi('global').log(...args));
    window.GM = window.GM || window.__createGMApi('global');
})();
`;

    async function injectShim() {
        if (!chrome.runtime?.id) return;
        try {
            await chrome.runtime.sendMessage({
                type: 'EXECUTE_IN_MAIN',
                code: GM_SHIM,
                name: 'GM Shim'
            });
            console.log('[Userscript Engine] GM shim execution requested');
        } catch (e) {
            console.debug('[Userscript Engine] Failed to request GM shim injection:', e);
        }
    }

    window.addEventListener('message', async (e) => {
        if (e.data && e.data.type === 'GM_REQUEST') {
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'GM_API_CALL',
                    ...e.data
                });
                window.postMessage({
                    type: 'GM_RESPONSE',
                    requestId: e.data.requestId,
                    ...response
                }, '*');
            } catch (err) {
                window.postMessage({
                    type: 'GM_RESPONSE',
                    requestId: e.data.requestId,
                    error: err.message
                }, '*');
            }
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type !== 'USERSCRIPT_VALUE_CHANGED') return false;
        window.postMessage({
            type: 'GM_VALUE_CHANGED',
            scriptId: msg.scriptId,
            oldValue: msg.oldValue || {},
            newValue: msg.newValue || {}
        }, '*');
        return false;
    });

    const matcher = window.UserscriptMatcher;
    const runtime = window.UserscriptRuntime;

    function scriptNeedsGMShim(scriptData) {
        const meta = scriptData.parsedMeta || {};
        const grants = Array.isArray(meta.grants) ? meta.grants : [];
        const resources = Array.isArray(meta.resources) ? meta.resources : [];
        if (resources.length > 0 || (scriptData.bundledResources || []).length > 0) return true;
        return grants.some(grant => {
            const clean = String(grant || '').trim();
            return clean && clean !== 'none';
        });
    }

    function isAuthenticationHandlerScript(scriptData) {
        const id = String(scriptData.id || '').toLowerCase();
        const file = String(scriptData.file || scriptData.filename || scriptData.sourceFile || '').toLowerCase();
        const name = String(scriptData.name || scriptData.parsedMeta?.name || '').toLowerCase();
        return id.includes('authentication_handler')
            || file.includes('authentication_handler')
            || name === 'authentication handler';
    }

    function isEnableAllFormFieldsScript(scriptData) {
        const id = String(scriptData.id || '').toLowerCase();
        const file = String(scriptData.file || scriptData.filename || scriptData.sourceFile || '').toLowerCase();
        const name = String(scriptData.name || scriptData.parsedMeta?.name || '').toLowerCase();
        return id.includes('enable_all_form_fields')
            || file.includes('enable_all_form_fields')
            || name === 'enable all form fields';
    }

    function isBypassSarathiRestrictionsScript(scriptData) {
        const id = String(scriptData.id || '').toLowerCase();
        const file = String(scriptData.file || scriptData.filename || scriptData.sourceFile || '').toLowerCase();
        const name = String(scriptData.name || scriptData.parsedMeta?.name || '').toLowerCase();
        return id.includes('bypass_sarathi_restrictions')
            || file.includes('bypass_sarathi_restrictions')
            || name.includes('bypass sarathi restrictions');
    }

    function isStallFormUnlockerScript(scriptData) {
        const id = String(scriptData.id || '').toLowerCase();
        const file = String(scriptData.file || scriptData.filename || scriptData.sourceFile || '').toLowerCase();
        const name = String(scriptData.name || scriptData.parsedMeta?.name || '').toLowerCase();
        return id.includes('enable_all_form_fields_for_stall')
            || file.includes('enable_all_form_fields_for_stall')
            || name.includes('for stall user');
    }

    function stringList(value) {
        return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
    }

    function accessScope(scriptData) {
        return String(scriptData.accessScope || scriptData.access_scope || scriptData.access || '').trim().toLowerCase();
    }

    function serviceList(scriptData) {
        const raw = scriptData.services || scriptData.serviceNames || scriptData.service_names || scriptData.service || [];
        if (Array.isArray(raw)) return raw.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
        const single = String(raw || '').trim().toLowerCase();
        return single ? [single] : [];
    }

    function hasStallServiceEntitlement(scriptData) {
        return accessScope(scriptData) === 'service' && serviceList(scriptData).includes('stall');
    }

    function runtimeRoles(scriptData) {
        const roles = stringList(scriptData.runtimeRoles || scriptData.runtime_roles);
        const role = String(scriptData.runtimeRole || scriptData.runtime_role || '').trim();
        if (role) roles.push(role);
        return roles.map(item => item.toLowerCase());
    }

    function hasRuntimeRole(scriptData, role) {
        return runtimeRoles(scriptData).includes(String(role || '').toLowerCase());
    }

    function scriptTags(scriptData) {
        const tags = stringList(scriptData.tags || scriptData.scriptTags || scriptData.script_tags || scriptData.runtimeTags || scriptData.runtime_tags);
        const metaTags = stringList(scriptData.parsedMeta?.tags);
        return [...tags, ...metaTags].map(item => item.toLowerCase());
    }

    function hasScriptTag(scriptData, tag) {
        return scriptTags(scriptData).includes(String(tag || '').toLowerCase());
    }

    function isKnownStallServiceScript(scriptData) {
        return hasScriptTag(scriptData, 'stall')
            || hasRuntimeRole(scriptData, 'stall_core')
            || isAuthenticationHandlerScript(scriptData)
            || isBypassSarathiRestrictionsScript(scriptData)
            || isStallFormUnlockerScript(scriptData);
    }

    function isStallCoreScript(scriptData) {
        if (!isKnownStallServiceScript(scriptData)) return false;
        if (hasScriptTag(scriptData, 'stall')) return true;
        if (hasRuntimeRole(scriptData, 'stall_core')) return true;
        return isAuthenticationHandlerScript(scriptData)
            || isBypassSarathiRestrictionsScript(scriptData)
            || isStallFormUnlockerScript(scriptData);
    }

    function stallRunMode(scriptData) {
        const explicit = String(scriptData.stallRunMode || scriptData.stall_run_mode || '').trim().toLowerCase();
        if (explicit) return explicit;
        if (isAuthenticationHandlerScript(scriptData)) return 'stall_pages';
        if (isEnableAllFormFieldsScript(scriptData)) return 'stall_pages';
        return 'stall_pages';
    }

    function isStallRelatedUrl(urlValue = location.href) {
        try {
            const url = new URL(urlValue);
            if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
            const path = url.pathname.toLowerCase();
            return path === '/sarathiservice/authenticationaction.do'
                || path === '/sarathiservice/instruction.do'
                || path === '/sarathiservice/examselectaction.do'
                || path === '/sarathiservice/stallexam.do'
                || path === '/sarathiservice/stallexamaction.do'
                || path === '/sarathiservice/stallloginsubmit.do';
        } catch (_) {
            return false;
        }
    }

    function isAllowedStallAuthUrl(urlValue = location.href) {
        try {
            const url = new URL(urlValue);
            if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
            const path = url.pathname.toLowerCase();
            if (path !== '/sarathiservice/authenticationaction.do'
                && path !== '/sarathiservice/instruction.do'
                && path !== '/sarathiservice/examselectaction.do') {
                return false;
            }
            if (path === '/sarathiservice/authenticationaction.do') {
                const authType = (url.searchParams.get('authtype') || url.searchParams.get('authType') || '').toLowerCase();
                return authType === 'anugyna' || authType === 'anugnya';
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function stallCoreAllowedForUrl(scriptData, url) {
        if (!isStallRelatedUrl(url) || !isStallCoreScript(scriptData)) return false;
        const mode = stallRunMode(scriptData);
        if (mode === 'auth_pages') return isAllowedStallAuthUrl(url);
        if (mode === 'stall_pages') return true;
        if (mode === 'all_sarathi_pages') {
            try {
                const parsed = new URL(url);
                return parsed.hostname === 'sarathi.parivahan.gov.in';
            } catch (_) {
                return false;
            }
        }
        return false;
    }

    async function resolveStallWorkspaceActive(storedData) {
        if (storedData.stallWorkspaceActive === true || storedData._automationState?.active === true) return true;
        if (!isStallRelatedUrl(location.href) || !chrome.runtime?.id) return false;
        try {
            const resp = await chrome.runtime.sendMessage({ type: 'GET_STALL_STATE' });
            if (resp?.ok && resp.state?.active) {
                chrome.storage.local.set({ stallWorkspaceActive: true }, () => void chrome.runtime.lastError);
                return true;
            }
        } catch (_) {}
        return false;
    }

    function buildWrappedCode(scriptData) {
        const meta = scriptData.parsedMeta || {};
        const id = scriptData.id || scriptData.name || 'unknown';
        const name = scriptData.name || meta.name || id;
        const safeName = String(name).replace(/'/g, "\\'");
        const gmInfo = {
            script: {
                name,
                namespace: meta.namespace || '',
                version: scriptData.version || meta.version || '',
                description: meta.description || '',
                matches: meta.matches || [],
                includes: meta.includes || [],
                excludes: meta.exclude || [],
                resources: meta.resources || []
            },
            scriptHandler: 'ta-ta',
            version: '2.2.0'
        };
        const resourceMap = {};
        for (const item of scriptData.bundledResources || []) {
            if (item && item.name) resourceMap[item.name] = { text: item.text || '', dataUrl: item.dataUrl || '' };
        }
        return `
(function(){
  const unsafeWindow = window;
  const __resources = ${JSON.stringify(resourceMap)};
  const GM_info = ${JSON.stringify(gmInfo)};
  const GM = window.__createGMApi ? window.__createGMApi(${JSON.stringify(id)}, GM_info) : window.GM;
  const GM_addStyle = GM && GM.addStyle ? GM.addStyle.bind(GM) : function(){};
  const GM_addElement = GM && GM.addElement ? GM.addElement.bind(GM) : function(){};
  const GM_getValue = GM && GM.getValue ? GM.getValue.bind(GM) : function(key, fallback){ return Promise.resolve(fallback); };
  const GM_setValue = GM && GM.setValue ? GM.setValue.bind(GM) : function(){ return Promise.resolve(false); };
  const GM_deleteValue = GM && GM.deleteValue ? GM.deleteValue.bind(GM) : function(){ return Promise.resolve(false); };
  const GM_listValues = GM && GM.listValues ? GM.listValues.bind(GM) : function(){ return Promise.resolve([]); };
  const GM_addValueChangeListener = GM && GM.addValueChangeListener ? GM.addValueChangeListener.bind(GM) : function(){ return ''; };
  const GM_removeValueChangeListener = GM && GM.removeValueChangeListener ? GM.removeValueChangeListener.bind(GM) : function(){};
  const GM_xmlhttpRequest = GM && GM.xmlhttpRequest ? GM.xmlhttpRequest.bind(GM) : function(){};
  const GM_notification = GM && GM.notification ? GM.notification.bind(GM) : function(){};
  const GM_setClipboard = GM && GM.setClipboard ? GM.setClipboard.bind(GM) : function(){};
  const GM_openInTab = GM && GM.openInTab ? GM.openInTab.bind(GM) : function(){};
  const GM_download = GM && GM.download ? GM.download.bind(GM) : function(){};
  const GM_registerMenuCommand = GM && GM.registerMenuCommand ? GM.registerMenuCommand.bind(GM) : function(){ return ''; };
  const GM_unregisterMenuCommand = GM && GM.unregisterMenuCommand ? GM.unregisterMenuCommand.bind(GM) : function(){};
  const GM_log = GM && GM.log ? GM.log.bind(GM) : console.log.bind(console);
  const GM_getResourceText = function(name){ return (__resources[name] && __resources[name].text) || ''; };
  const GM_getResourceURL = function(name){ return (__resources[name] && __resources[name].dataUrl) || ''; };
  try {
${scriptData.bundledRequireCode || ''}

${scriptData.rawCode || ''}
  } catch (error) {
    console.error('[Userscript:${safeName}]', error);
    throw error;
  }
})();`;
    }

    async function executeScriptData(scriptData) {
        try {
            if (scriptNeedsGMShim(scriptData)) {
                await injectShim();
            }
            const response = await chrome.runtime.sendMessage({
                type: 'EXECUTE_IN_MAIN',
                code: buildWrappedCode(scriptData),
                name: scriptData.name,
                id: scriptData.executionId || scriptData.id
            });
            if (response?.ok === false) throw new Error(response.error || 'execution failed');
            console.log(`[Userscript Engine] Executed script: ${scriptData.name}`);
        } catch (e) {
            console.error(`[Userscript Engine] Error injecting script ${scriptData.name}:`, e);
            chrome.runtime.sendMessage({
                type: 'USERSCRIPT_LOG',
                level: 'error',
                scriptId: scriptData.id,
                scriptName: scriptData.name,
                message: e.message
            });
        }
    }
    
    
    
    function scheduleExecution(scriptData) {
        const { parsedMeta, rawCode, id, name } = scriptData;
        const runAt = parsedMeta.runAt || 'document-idle';
        const requires = parsedMeta.requires || [];
    
        if (runAt === 'document-start') {
            // Synchronous injection — must beat page's own scripts
            // Note: @require is not supported for document-start (would break sync guarantee)
            executeScriptData(scriptData);
        } else if (runAt === 'document-end') {
            const execute = () => executeScriptData(scriptData);
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                execute();
            } else {
                document.addEventListener('DOMContentLoaded', execute, { once: true });
            }
        } else { 
            const execute = () => executeScriptData(scriptData);
            if (document.readyState === 'complete') {
                execute();
            } else {
                window.addEventListener('load', () => setTimeout(execute, 0), { once: true });
            }
        }
    }
    
    try {
        if (!matcher || !runtime) {
            console.error('[Userscript Engine] Runtime helpers missing.');
            return;
        }
        let data = await chrome.storage.local.get(['normalized_userscripts', 'userscriptsEnabled', '_automationState', 'stallWorkspaceActive']);
        const stallWorkspaceActive = await resolveStallWorkspaceActive(data);
        if (data.userscriptsEnabled === false) {
            console.log('[Userscript Engine] Global userscripts toggle is disabled.');
            return;
        }
        let scripts = data.normalized_userscripts || [];
        if (!scripts.length && chrome.runtime?.id) {
            try {
                const syncResp = await chrome.runtime.sendMessage({ type: 'USERSCRIPTS_SYNC' });
                if (syncResp?.ok && Array.isArray(syncResp.userscripts)) {
                    scripts = syncResp.userscripts;
                    console.log(`[Userscript Engine] Synced ${scripts.length} scripts on demand.`);
                }
            } catch (e) {
                console.debug('[Userscript Engine] On-demand sync failed:', e);
            }
        }
        if (!scripts.length) {
            console.log('[Userscript Engine] No scripts configured.');
            return;
        }
        const filterScriptsForUrl = (url) => scripts.filter(script => {
            const scope = accessScope(script);
            const stallUrl = isStallRelatedUrl(url);
            if (stallUrl && !stallWorkspaceActive) return false;
            if (isKnownStallServiceScript(script)) return stallCoreAllowedForUrl(script, url);
            if (scope === 'service') {
                if (serviceList(script).includes('stall')) return stallCoreAllowedForUrl(script, url);
                return false;
            }
            if (stallUrl) return false;
            return true;
        });
        const runForUrl = (url, reason) => runtime.runMatchingScripts({
            scripts: filterScriptsForUrl(url),
            url,
            reason,
            execute: executeScriptData,
            shouldRun: matcher.shouldRun
        });

        const ranCount = runForUrl(location.href, 'load');
        runtime.installSpaWatcher((url) => {
            const spaCount = runForUrl(url, 'spa');
            if (spaCount) console.log(`[Userscript Engine] SPA route matched ${spaCount} script(s): ${url}`);
        });

        if (!ranCount) {
            console.log('[Userscript Engine] No scripts matched current URL.');
        }
    } catch (e) {
        console.error('[Userscript Engine] Error loading scripts:', e);
    }
})();
