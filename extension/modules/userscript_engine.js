// modules/userscript_engine.js — Unified Platform Extension
// Lightweight Userscript Engine (Content Script)

(async function() {
    'use strict';

    if (window.__USERSCRIPT_ENGINE_INITIALIZED__) return;
    window.__USERSCRIPT_ENGINE_INITIALIZED__ = true;

    console.log('[Userscript Engine] Booting...');

    const GM_SHIM = `
(function() {
    if (window.__UP_GM_SHIM_READY__) return;
    window.__UP_GM_SHIM_READY__ = true;
    const callbacks = {};
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
    window.__createGMApi = function(scriptId) {
        const addStyle = (css) => {
            const style = document.createElement('style');
            style.textContent = String(css || '');
            (document.head || document.documentElement).appendChild(style);
            return style;
        };
        const api = {
            addStyle,
            getValue: (key, defaultValue) => request('getValue', { key, defaultValue }, scriptId).then(r => r.value),
            setValue: (key, value) => request('setValue', { key, value }, scriptId).then(r => r.ok),
            deleteValue: (key) => request('deleteValue', { key }, scriptId).then(r => r.ok),
            listValues: () => request('listValues', {}, scriptId).then(r => r.values || []),
            notification: (details) => request('notification', { details }, scriptId).catch(() => ({ ok: false })),
            setClipboard: (text) => navigator.clipboard?.writeText ? navigator.clipboard.writeText(String(text || '')) : Promise.reject(new Error('clipboard unavailable')),
            xmlhttpRequest: (details) => {
                const safe = {
                    method: details?.method || 'GET',
                    url: details?.url || '',
                    headers: details?.headers || {},
                    data: details?.data ?? null,
                    anonymous: !!details?.anonymous,
                };
                request('xmlhttpRequest', { details: safe }, scriptId)
                    .then(r => {
                        if (r.response) details?.onload?.(r.response);
                    })
                    .catch(err => details?.onerror?.({ error: err.message }));
            },
        };
        return api;
    };
    window.GM_addStyle = window.GM_addStyle || ((css) => window.__createGMApi('global').addStyle(css));
    window.GM_getValue = window.GM_getValue || ((key, fallback) => window.__createGMApi('global').getValue(key, fallback));
    window.GM_setValue = window.GM_setValue || ((key, value) => window.__createGMApi('global').setValue(key, value));
    window.GM_deleteValue = window.GM_deleteValue || ((key) => window.__createGMApi('global').deleteValue(key));
    window.GM_listValues = window.GM_listValues || (() => window.__createGMApi('global').listValues());
    window.GM_xmlhttpRequest = window.GM_xmlhttpRequest || ((details) => window.__createGMApi('global').xmlhttpRequest(details));
    window.GM_notification = window.GM_notification || ((details) => window.__createGMApi('global').notification(details));
    window.GM_setClipboard = window.GM_setClipboard || ((text) => window.__createGMApi('global').setClipboard(text));
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

    function urlMatchesPattern(url, pattern) {
        if (pattern === '<all_urls>') return true;
        
        let p = pattern;
        let isHttpAny = false;
        if (p.startsWith('*://')) {
            isHttpAny = true;
            p = p.slice(4);
        }
        
        let regexStr = p
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
            .replace(/\\\*/g, '.*'); // Replace \* with .*
            
        if (isHttpAny) {
            regexStr = '^https?:\\/\\/' + regexStr;
        } else {
            regexStr = '^' + regexStr;
        }
        regexStr += '$';
        
        try {
            const regex = new RegExp(regexStr, 'i');
            return regex.test(url);
        } catch (e) {
            console.error(`[Userscript Engine] Invalid match pattern: ${pattern}`, e);
            return false;
        }
    }
    
    function shouldRun(script, url) {
        if (!script.enabled) return false;
        
        const meta = script.parsedMeta;
        if (!meta || !meta.matches || meta.matches.length === 0) return false;
        if (meta.noframes && window.top !== window.self) return false;
        
        // Check excludes first
        if (meta.exclude && meta.exclude.some(pattern => urlMatchesPattern(url, pattern))) {
            return false;
        }
        
        // Check matches
        return meta.matches.some(pattern => urlMatchesPattern(url, pattern));
    }

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

    function buildWrappedCode(scriptData) {
        const meta = scriptData.parsedMeta || {};
        const id = scriptData.id || scriptData.name || 'unknown';
        const name = scriptData.name || meta.name || id;
        const safeName = String(name).replace(/'/g, "\\'");
        const resourceMap = {};
        for (const item of scriptData.bundledResources || []) {
            if (item && item.name) resourceMap[item.name] = { text: item.text || '', dataUrl: item.dataUrl || '' };
        }
        return `
(function(){
  const unsafeWindow = window;
  const __resources = ${JSON.stringify(resourceMap)};
  const GM = window.__createGMApi ? window.__createGMApi(${JSON.stringify(id)}) : window.GM;
  const GM_addStyle = GM && GM.addStyle ? GM.addStyle.bind(GM) : function(){};
  const GM_getValue = GM && GM.getValue ? GM.getValue.bind(GM) : function(key, fallback){ return Promise.resolve(fallback); };
  const GM_setValue = GM && GM.setValue ? GM.setValue.bind(GM) : function(){ return Promise.resolve(false); };
  const GM_deleteValue = GM && GM.deleteValue ? GM.deleteValue.bind(GM) : function(){ return Promise.resolve(false); };
  const GM_listValues = GM && GM.listValues ? GM.listValues.bind(GM) : function(){ return Promise.resolve([]); };
  const GM_xmlhttpRequest = GM && GM.xmlhttpRequest ? GM.xmlhttpRequest.bind(GM) : function(){};
  const GM_notification = GM && GM.notification ? GM.notification.bind(GM) : function(){};
  const GM_setClipboard = GM && GM.setClipboard ? GM.setClipboard.bind(GM) : function(){};
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
                id: scriptData.id
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
    
    async function injectScript(code, name, id, requires) {
        try {
            // Fetch @require dependencies first
            let requireCode = '';
            if (requires && requires.length > 0) {
                for (const url of requires) {
                    try {
                        const resp = await fetch(url);
                        if (resp.ok) {
                            requireCode += await resp.text() + '\n';
                            console.log(`[Userscript Engine] Loaded @require: ${url}`);
                        } else {
                            console.warn(`[Userscript Engine] @require failed (${resp.status}): ${url}`);
                        }
                    } catch (e) {
                        console.warn(`[Userscript Engine] @require fetch error for ${url}:`, e.message);
                    }
                }
            }
            
            const fullCode = requireCode + code;
            await chrome.runtime.sendMessage({
                type: 'EXECUTE_IN_MAIN',
                code: fullCode,
                name: name,
                id: id
            });
            console.log(`[Userscript Engine] Executed script: ${name}`);
        } catch (e) {
            console.error(`[Userscript Engine] Error injecting script ${name}:`, e);
        }
    }
    
    function injectScriptAtStart(code, name, id) {
        try {
            chrome.runtime.sendMessage({
                type: 'EXECUTE_IN_MAIN',
                code,
                name,
                id
            });
            console.log(`[Userscript Engine] document-start execution requested: ${name}`);
        } catch (e) {
            console.error(`[Userscript Engine] document-start execution failed for ${name}:`, e);
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
        let data = await chrome.storage.local.get(['normalized_userscripts', 'userscriptsEnabled']);
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
        const currentUrl = location.href;
    
        let ranAny = false;
        for (const scriptData of scripts) {
            if (shouldRun(scriptData, currentUrl)) {
                scheduleExecution(scriptData);
                ranAny = true;
            }
        }
        if (!ranAny) {
            console.log('[Userscript Engine] No scripts matched current URL.');
        }
    } catch (e) {
        console.error('[Userscript Engine] Error loading scripts:', e);
    }
})();
