(function(){
'use strict';
if (window.__SP_PANEL_MERGED__) return; window.__SP_PANEL_MERGED__ = true;
// --- Sarathi core engine: Anti-403 + Anti-debug + Scripts + Restart + KBD + Virtual Webcam (UI panel disabled) ---
// Updates in this patch:
// - Fix: "image value" से आने वाली image अब auto-detect होकर दिखेगी (DOM value/src watcher + MutationObserver).
// - Panel: Left side brand "Sarthi Manager+" bold heading जोड़ दी गई है.
// - Add Script: Text हटाकर "+" icon button कर दिया गया है (tray height 210px ही).
// - Edit/Zoom buttons तभी दिखेंगे जब image उपलब्ध होगी; editor Upload वैसा ही है; Apply केवल VCAM अपडेट करता है (panel circle नहीं).

if (location.hostname !== 'sarathi.parivahan.gov.in') return;
if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

// Activation gate removed for the current build.
// Panel starts unlocked and does not persist any serial/hash state.

// Virtual webcam keys
const SP_VCAM_ENABLED_KEY = "sp_vcam_enabled";
const SP_VCAM_FORCE_KEY   = "sp_vcam_force_all";
const SP_VCAM_ZOOM_KEY    = "sp_vcam_zoom";
const STALL_VCAM_ACTIVE_KEY = "stallVcamActive";

// Image defaults key
const SP_IMG_DEFAULTS_KEY = "sp_img_defaults"; // {bri,con,sat,hue,fmt,qual}

function isStallExamRelatedUrl(){
  try {
    const url = new URL(location.href);
    if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
    const path = url.pathname.toLowerCase();
    return path === '/sarathiservice/authenticationaction.do'
      || path === '/sarathiservice/instruction.do'
      || path === '/sarathiservice/examselectaction.do'
      || path === '/sarathiservice/stallexam.do'
      || path === '/sarathiservice/stallexamaction.do'
      || path === '/sarathiservice/stallloginsubmit.do';
  } catch {
    return false;
  }
}

function showPanelToast(msg, variant='info', duration=1600){
  try{ console.debug('[SarathiPanel]', variant, msg); }catch{}
}

// ========== IMAGE DEFAULTS ==========
function getImageDefaults(cb){
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
  chrome.storage.local.get([SP_IMG_DEFAULTS_KEY], (d)=>{
    const def = d[SP_IMG_DEFAULTS_KEY] || { bri:1, con:1, sat:1, hue:0, fmt:'image/jpeg', qual:0.92 };
    cb(def);
  });
}
function setImageDefaults(def, cb){
  const safe = {
    bri: Math.max(0.5, Math.min(1.5, Number(def.bri)||1)),
    con: Math.max(0.5, Math.min(1.5, Number(def.con)||1)),
    sat: Math.max(0,   Math.min(2.0, Number(def.sat)||1)),
    hue: Math.max(-180, Math.min(180, Number(def.hue)||0)),
    fmt: (def.fmt==='image/png'||def.fmt==='image/webp')?def.fmt:'image/jpeg',
    qual: Math.min(1, Math.max(0.6, Number(def.qual)||0.92))
  };
  chrome.storage.local.set({ [SP_IMG_DEFAULTS_KEY]: safe }, cb);
}
async function applyDefaultsToDataUrl(inputDu){
  return new Promise((resolve)=>{
    if (!inputDu || typeof inputDu!=='string' || !inputDu.startsWith('data:image/')) return resolve(inputDu);
    getImageDefaults((def)=>{
      try{
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = ()=>{
          try{
            const w = Math.max(1, img.naturalWidth||img.width||640);
            const h = Math.max(1, img.naturalHeight||img.height||480);
            const cvs = document.createElement('canvas'); cvs.width=w; cvs.height=h;
            const ctx = cvs.getContext('2d');
            ctx.save();
            ctx.filter = `brightness(${def.bri}) contrast(${def.con}) saturate(${def.sat}) hue-rotate(${def.hue}deg)`;
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
            ctx.drawImage(img, 0, 0, w, h);
            ctx.restore();
            const out = def.fmt==='image/png' ? cvs.toDataURL('image/png')
                      : def.fmt==='image/webp' ? cvs.toDataURL('image/webp', def.qual)
                      : cvs.toDataURL('image/jpeg', def.qual);
            resolve(out);
          }catch{ resolve(inputDu); }
        };
        img.onerror = ()=>resolve(inputDu);
        img.src = inputDu;
      }catch{ resolve(inputDu); }
    });
  });
}

// ========== EARLY 403 GUARD ==========
(function early403Guard() {
  if (location.hostname !== "sarathi.parivahan.gov.in") return;
  const STABLE_URL = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugnya";
  const href = location.href;
  if (href.includes("/403.jsp") || (href.includes("authenticationaction.do") && href.includes("authtype=Anugyna"))) {
    try {
      const k = "__sp403_ts"; const last = Number(sessionStorage.getItem(k) || 0);
      if (Date.now() - last > 3000) { sessionStorage.setItem(k, String(Date.now())); location.replace(STABLE_URL); }
    } catch {}
    return;
  }
})();

// ========== PAGE HARDEN ==========
(function harden() {
  if (location.hostname !== "sarathi.parivahan.gov.in") return;
  if (!isStallExamRelatedUrl()) return;
  try {
    document.querySelectorAll('script').forEach(s=>{ if (s.textContent.includes('debugger')) s.textContent = s.textContent.replace(/debugger;/g,''); });
    window.alert = function(){};
    window.onkeydown = null; window.onkeyup = null; window.onkeypress = null;
    document.onkeydown = null; document.onkeyup = null; document.onkeypress = null;
    document.addEventListener('visibilitychange', e=>e.stopImmediatePropagation(), true);
    window.addEventListener('blur', e=>e.stopImmediatePropagation(), true);
    window.addEventListener('focus', e=>e.stopImmediatePropagation(), true);
    const _si = window.setInterval; window.setInterval = function(fn, d, ...a){ if(typeof fn==="string"&&fn.includes("debugger")) return 0; return _si(fn,d,...a); };
    const _st = window.setTimeout;  window.setTimeout  = function(fn, d, ...a){ if(typeof fn==="string"&&fn.includes("debugger")) return 0; return _st(fn,d,...a); };
    try { Object.defineProperty(window,"outerHeight",{get:()=>window.innerHeight+100}); Object.defineProperty(window,"outerWidth",{get:()=>window.innerWidth+100}); } catch {}
  } catch {}
  function dom403Guard(){
    try {
      const t = (document.body && document.body.innerText || "").toLowerCase();
      if (t.includes("403") && t.includes("forbidden")) {
        const STABLE_URL = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugnya";
        const k="__sp403_dom_ts"; const last=Number(sessionStorage.getItem(k)||0);
        if (Date.now()-last>3000){ sessionStorage.setItem(k,String(Date.now())); location.replace(STABLE_URL); }
      }
    }catch{}
  }
  document.addEventListener("DOMContentLoaded", dom403Guard, {once:true});
  setTimeout(dom403Guard, 400); setTimeout(dom403Guard, 1200); setTimeout(dom403Guard, 2400);
})();

// ========== STYLES ==========
(function ensureStyles(){
  if (document.getElementById('sp-styles')) return;
  const css = `
    .sp-toast{position:fixed!important;top:96px;left:50%;transform:translateX(-50%) translateY(-8px);opacity:0;padding:8px 14px;border-radius:12px;font-weight:800;font-size:13px;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.18);z-index:2147483647;transition:opacity .22s ease,transform .22s ease;pointer-events:none;max-width:calc(100% - 140px);text-align:center}
    .sp-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .sp-toast.info{background:linear-gradient(90deg,#6a5af9,#38c6fa)}
    .sp-toast.success{background:linear-gradient(90deg,#27ae60,#2ecc71)}
    .sp-toast.error{background:linear-gradient(90deg,#e74c3c,#c0392b)}

    #sp-top-panel{position:fixed!important;top:0;left:40px;right:40px;height:84px;z-index:2147483646;backdrop-filter:saturate(120%) blur(6px);background:linear-gradient(90deg,rgba(0,51,204,.88) 0%,rgba(255,255,255,.26) 100%);border-radius:0px;border:1px solid rgba(255,255,255,.38);box-shadow:0 8px 20px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;pointer-events:auto;transition:transform .9s cubic-bezier(.22,.61,.36,1)}
    #sp-top-panel.collapsed{transform:translateY(-110%);pointer-events:none}
    #sp-top-panel .sp-inner{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;max-width:100%;padding:4px 8px;width:100%}

    /* Brand */
    #sp-brand{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-weight:900;font-size:20px;letter-spacing:.3px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.28);font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;user-select:none}

    /* Buttons 25px height */
    .sp-btn,.sp-mini-btn,.sp-icon-btn{appearance:none;border:none;outline:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;height:25px;min-height:25px;padding:0 10px;font-weight:700;font-size:11px;color:#fff;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18);transition:transform .08s ease,opacity .15s ease;white-space:nowrap;line-height:23px}
    .sp-btn{background:linear-gradient(90deg,#6a5af9 0%,#38c6fa 100%)}
    .sp-mini-btn{background:linear-gradient(90deg,#6a5af9,#38c6fa)}
    .sp-btn.success{background:linear-gradient(90deg,#27ae60,#2ecc71)}
    .sp-btn.warn{background:linear-gradient(90deg,#f39c12,#e67e22)}
    .sp-btn.danger{background:linear-gradient(90deg,#e74c3c,#c0392b)}
    .sp-btn.gray{background:linear-gradient(90deg,#95a5a6,#7f8c8d)}
    .sp-btn.blue{background:linear-gradient(90deg,#3498db,#2980b9)}
    .sp-btn:hover,.sp-mini-btn:hover,.sp-icon-btn:hover{opacity:.96;transform:translateY(-1px)}

    /* Circular small icon button for Add Script */
    .sp-icon-btn{width:25px;padding:0;border-radius:50%;background:linear-gradient(135deg,#6a5af9,#38c6fa);font-size:15px;font-weight:900}
    .sp-icon-btn .plus{margin-top:-1px}

    #sp-toggle{position:fixed!important;top:6px;right:46px;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.6);background:rgba(0,0,0,.25);color:#fff;font-size:11px;line-height:1;cursor:pointer;z-index:2147483647;box-shadow:0 2px 6px rgba(0,0,0,.25)}
    #sp-toggle.rot{transform:rotate(180deg)}

    #sp-launcher{position:fixed!important;right:18px;bottom:18px;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;background:linear-gradient(135deg,#0033cc,#38c6fa);color:#fff;cursor:pointer;z-index:2147483647;border:1px solid rgba(255,255,255,.55);box-shadow:0 6px 18px rgba(0,0,0,.25)}
    #sp-launcher.hide{display:none}

    #sp-scripts-bar{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}

    /* Panel image dock: circular 70px */
    #sp-img-dock{display:none;align-items:center;gap:8px}
    #sp-img-thumb{width:70px;height:70px;border-radius:50%;object-fit:cover;border:0;box-shadow:none;background:#ffffff;user-select:none;cursor:pointer;display:block}

    /* Tray: fixed 250x210 */
    #sp-tray{position:fixed!important;right:40px;top:94px;z-index:2147483646;display:none;width:250px;height:215px;transition:opacity .28s ease,transform .28s ease}
    #sp-tray.open{display:block;opacity:1;transform:translateY(0)}
    #sp-tray:not(.open){opacity:0;transform:translateY(-6px)}
    #sp-tray-inner{background:#fff;border:1px solid #eaeaea;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.18);padding:10px;width:100%;height:100%;overflow:auto}
    #sp-tray-inner .sp-tray-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
    #sp-tray-inner .sp-tray-title{font-weight:800;color:#0033cc;font-size:12px}
    #sp-tray-inner .sp-tray-sub{font-size:10px;color:#666}
    .sp-field{display:flex;flex-direction:column;gap:4px;margin:4px 0}
    .sp-label{font-size:10px;color:#333;font-weight:700}
    .sp-input,.sp-textarea,#sp-cl-format,#sp-cl-qual{border:1px solid #e1e5ee;border-radius:8px;padding:7px 9px;font-size:11px;color:#222;background:#f9fbff;outline:none;transition:border-color .15s, box-shadow .15s}
    .sp-input:focus,.sp-textarea:focus{border-color:#6a5af9;box-shadow:0 0 0 3px rgba(106,90,249,.12);background:#fff}
    .sp-textarea{min-height:62px;max-height:110px;resize:vertical}
    .sp-row{display:flex;gap:8px;align-items:center}
    .sp-actions .sp-btn{height:24px;min-height:24px;font-size:10px;padding:0 8px}

    .sp-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:16px;padding:4px 6px;color:#fff;font-weight:800;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
    .sp-chip .chip-btn{border:none;background:rgba(255,255,255,.18);color:#fff;border-radius:10px;padding:3px 6px;font-weight:800;cursor:pointer;font-size:10px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
    .sp-chip .chip-btn.run{background:linear-gradient(90deg,#00b09b,#96c93d); color:#fff; border:none}

    #sp-kbd{display:inline-flex;align-items:center;gap:6px;margin-left:6px}
    .kbd-chip{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;min-width:22px;padding:0;border-radius:50%;font-weight:900;font-size:12px;user-select:none;border:1px solid rgba(255,255,255,.35);box-shadow:0 2px 6px rgba(0,0,0,.18);color:#fff;background:rgba(255,255,255,.18)}
    .kbd-chip.on{border-color:#27ae60;background:linear-gradient(90deg,#27ae60,#2ecc71);color:#fff}
    .kbd-chip.off{border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.18);color:#fff;opacity:.85}

    /* Classic Image Editor */
    #sp-classic-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center}
    #sp-classic-modal{background:#fff;border-radius:14px;min-width:520px;min-height:380px;width:min(820px,82vw);height:min(70vh,620px);resize:both;overflow:auto;border:1px solid #e8e8e8;box-shadow:0 16px 36px rgba(0,0,0,.25);display:grid;grid-template-rows:auto 1fr auto}
    #sp-classic-modal .hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;background:linear-gradient(180deg,#f8fbff,#ffffff)}
    #sp-classic-modal .body{display:grid;grid-template-columns:1fr 280px;gap:10px;padding:10px}
    #sp-classic-modal .vp{position:relative;border:1px solid #e6e6e9;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
    #sp-classic-canvas{display:block;width:100%;height:100%;image-rendering:auto;background:#fff}
    #sp-classic-modal .side{display:flex;flex-direction:column;gap:10px}
    #sp-classic-modal .ftr{display:flex;justify-content:space-between;gap:8px;padding:10px;border-top:1px solid #eee;background:#f7f9fc}

    /* Hide Webcame button visually; functionality remains */
    #sp-vcam-toggle{ display:none !important; }
  `;
  const style = document.createElement('style'); style.id='sp-styles'; style.textContent = css; document.documentElement.appendChild(style);
})();

// ========== STORAGE HELPERS ==========
function getScripts(cb){ chrome.storage.local.get(['scripts'], d=>cb(d.scripts||[])); }
function setScripts(s, cb){ chrome.storage.local.set({scripts:s}, cb); }
function runScriptInPage(code, cb){ chrome.runtime.sendMessage({type:'SP_EXEC', code}, res=>cb&&cb(res)); }

// ========== ACTION HELPERS ==========
function openStartExamUrl(){
  const url = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugyna";
  chrome.runtime.sendMessage({type:'SP_OPEN', url}, resp=>{
    if(resp&&resp.ok) showPanelToast('Opening Start Exam URL','info'); else showPanelToast('Failed to open URL','error');
  });
}
function requestBrowserRestart(){
  chrome.runtime.sendMessage({type:'SP_BROWSER_RESTART'}, resp=>{
    if(resp&&resp.ok) showPanelToast('Restarting browser…','info',2000); else showPanelToast('Restart failed','error',2000);
  });
}

// Helper: Save-As via background (preferred) with fallback to anchor
function saveDataUrlWithSaveAs(dataUrl, suggestedName){
  return new Promise((resolve)=>{
    try{
      chrome.runtime.sendMessage({ type:'SP_SAVE_AS', dataUrl, filename: suggestedName }, resp=>{
        if (resp && resp.ok) {
          showPanelToast('Choose a location to save','info');
          resolve(true);
        } else {
          try{
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = suggestedName || 'image';
            document.body.appendChild(a); a.click(); a.remove();
            showPanelToast('Image saved','success');
            resolve(true);
          }catch{ resolve(false); }
        }
      });
    }catch{
      try{
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = suggestedName || 'image';
        document.body.appendChild(a); a.click(); a.remove();
        showPanelToast('Image saved','success');
        resolve(true);
      }catch{ resolve(false); }
    }
  });
}

// Helper: prompt user to pick a local image (returns data URL or '')
function pickLocalImage(){
  return new Promise((resolve)=>{
    try{
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = ()=>{
        const file = input.files && input.files[0];
        if (!file) return resolve('');
        const reader = new FileReader();
        reader.onload = async () => {
          const du = typeof reader.result === 'string' ? reader.result : '';
          const processed = await applyDefaultsToDataUrl(du);
          resolve(processed || du || '');
        };
        reader.onerror = ()=>resolve('');
        reader.readAsDataURL(file);
      };
      input.click();
    }catch{ resolve(''); }
  });
}

// ========== PANEL ==========
let latestCapturedDataUrl = '';

(function initPanel(){
  if (location.hostname !== "sarathi.parivahan.gov.in") return;

  function startOrAskActivation() {
    startActivatedFlow();
  }

  function startActivatedFlow(){
    let autoHideTimer=null; const AUTO_HIDE_MS=15000; // 15 seconds inactivity on panel => auto hide
    let spVcamEnabled = false;
    let stallVcamActive = false;
    let spVcamForceAll = true;
    let spVcamZoom = 1.3; // default 130%
    let watchdogId = 0;
    function effectiveVcamEnabled(){ return !!(stallVcamActive && spVcamEnabled); }

    function injectPanel(){
      if (document.getElementById('sp-top-panel')) return;

      const panel = document.createElement('div');
      panel.id='sp-top-panel';
      panel.innerHTML = `
        <div class="sp-inner" id="sp-inner">
          <div id="sp-img-dock">
            <img id="sp-img-thumb" src="" alt="Captured" draggable="false" title="Click to preview" />
          </div>

          <button class="sp-btn warn" id="sp-start-exams">🎯 Start Exams</button>
          <button class="sp-btn" id="sp-vcam-toggle" title="Webcame को सक्षम/अक्षम करें">Webcame</button>
          <button class="sp-mini-btn" id="sp-zoom-in" title="Zoom In">Zoom +</button>
          <button class="sp-mini-btn" id="sp-zoom-out" title="Zoom Out">Zoom −</button>
          <button class="sp-mini-btn edit" id="sp-panel-edit" title="Image Edit (Classic)">✏️ Edit</button>
          <button class="sp-icon-btn" id="sp-save-script-open" title="Add Script" aria-label="Add Script"><span class="plus">+</span></button>
          <div id="sp-scripts-bar"></div>
          <div id="sp-kbd">
            <span id="sp-caps" class="kbd-chip off" title="Caps Lock">🔠</span>
            <span id="sp-num"  class="kbd-chip off" title="Num Lock">🔢</span>
          </div>
          <button class="sp-btn danger" id="sp-reset-all" title="Reset all settings and scripts">Reset</button>
          <button class="sp-btn danger" id="sp-restart" title="Restart browser session">Restart</button>
        </div>
      `;
      document.documentElement.appendChild(panel);

      // Brand label (left side)
      const brand = document.createElement('div');
      brand.id = 'sp-brand';
      brand.textContent = 'Sarthi Manager+';
      panel.appendChild(brand);

      const toggle = document.createElement('button');
      toggle.id='sp-toggle'; toggle.title='Hide/Show panel'; toggle.textContent='˄';
      document.documentElement.appendChild(toggle);

      const launcher = document.createElement('button');
      launcher.id = 'sp-launcher'; launcher.textContent = 'SP';
      document.documentElement.appendChild(launcher);

      // Tray (no Script Link field)
      const tray = document.createElement('div'); tray.id='sp-tray';
      tray.innerHTML = `
        <div id="sp-tray-inner">
          <div class="sp-tray-hdr">
            <div class="sp-tray-title">Add Script</div>
            <div class="sp-tray-sub">Save & run on click</div>
          </div>
          <div class="sp-row" style="flex-direction:column">
            <div class="sp-field">
              <label class="sp-label">Script Name <span style="color:#e74c3c">*</span></label>
              <input class="sp-input" id="sp-script-name" type="text" placeholder="e.g. Autofill helper" />
            </div>
          </div>
          <div class="sp-field">
            <label class="sp-label">Script Code <span style="color:#e74c3c">*</span></label>
            <textarea class="sp-textarea" id="sp-script-code" placeholder="// paste your JS code here"></textarea>
          </div>
          <div class="sp-row" style="align-items:center;justify-content:space-between;margin-top:4px">
            <label class="sp-label" style="display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="sp-script-autorun" /> Auto Run
            </label>
            <div class="sp-actions">
              <button class="sp-btn success" id="sp-save-script">Save</button>
              <button class="sp-btn" id="sp-cancel-tray">Close</button>
            </div>
          </div>
        </div>
      `;
      document.documentElement.appendChild(tray);

      const isTrayOpen = ()=>tray.classList.contains('open');
      function setCollapsed(collapsed){
        const was = panel.classList.contains('collapsed');
        if (collapsed){
          panel.classList.add('collapsed'); toggle.classList.add('rot'); toggle.textContent='˅';
          launcher.classList.remove('hide');
          if (isTrayOpen()) tray.classList.remove('open');
        } else {
          panel.classList.remove('collapsed'); toggle.classList.remove('rot'); toggle.textContent='˄';
          launcher.classList.add('hide');
        }
        if (was!==collapsed) resetAutoHideTimer();
        try{ sessionStorage.setItem('__sp_collapsed', collapsed?'1':'0'); }catch{}
      }
      function resetAutoHideTimer(){
        clearTimeout(autoHideTimer);
        if (panel.classList.contains('collapsed') || isTrayOpen()) return;
        autoHideTimer = setTimeout(()=>setCollapsed(true), AUTO_HIDE_MS);
      }
      function userActivity(){ resetAutoHideTimer(); }

      function disableRightClick(el){
        if (!el) return;
        el.addEventListener('contextmenu', (e)=>{ e.preventDefault(); }, true);
        el.addEventListener('mousedown', (e)=>{ if (e.button === 2) e.preventDefault(); }, true);
        el.addEventListener('mouseup', (e)=>{ if (e.button === 2) e.preventDefault(); }, true);
        el.addEventListener('dragstart', (e)=>{ e.preventDefault(); }, true);
      }
      disableRightClick(panel); disableRightClick(toggle); disableRightClick(tray); disableRightClick(launcher);

      // Caps/Num
      function setKbd(chip, on){ chip.classList.toggle('on', !!on); chip.classList.toggle('off', !on); }
      function updateKbd(ev){
        try{
          if(typeof ev.getModifierState==='function'){
            setKbd(document.getElementById('sp-caps'), ev.getModifierState('CapsLock'));
            setKbd(document.getElementById('sp-num'),  ev.getModifierState('NumLock'));
          }
        }catch{}
      }
      document.addEventListener('keydown', updateKbd, {capture:true});
      document.addEventListener('keyup',   updateKbd, {capture:true});
      document.addEventListener('mousedown', updateKbd, {capture:true});
      document.addEventListener('mousemove', updateKbd, {capture:true});

      // Buttons
      document.getElementById('sp-start-exams').addEventListener('click', ()=>{ openStartExamUrl(); userActivity(); });
      document.getElementById('sp-restart').addEventListener('click', ()=>{ setCollapsed(false); requestBrowserRestart(); userActivity(); });
      document.getElementById('sp-reset-all').addEventListener('click', ()=>{
        setCollapsed(false);
        const ok = confirm('Reset all settings and remove all saved scripts? This will restore defaults.');
        if (!ok) return;
        chrome.storage.local.clear(()=>{
          showPanelToast('All settings reset','success',1400);
          setTimeout(()=>location.reload(), 650);
        });
      });
      document.getElementById('sp-save-script-open').addEventListener('click', ()=>{ setCollapsed(false); tray.classList.add('open'); userActivity(); });
      tray.querySelector('#sp-cancel-tray').addEventListener('click', ()=>{ tray.classList.remove('open'); userActivity(); });
      tray.querySelector('#sp-save-script').addEventListener('click', ()=>{
        const name = tray.querySelector('#sp-script-name').value.trim();
        const code = tray.querySelector('#sp-script-code').value.trim();
        const autoRun = tray.querySelector('#sp-script-autorun').checked;
        if(!name || !code){ showPanelToast('Script Name & Code आवश्यक हैं','error'); return; }
        getScripts(list=>{
          list.push({name, code, autoRun});
          setScripts(list, ()=>{
            showPanelToast('Script Saved','success');
            tray.classList.remove('open');
            tray.querySelector('#sp-script-name').value='';
            tray.querySelector('#sp-script-code').value='';
            tray.querySelector('#sp-script-autorun').checked=false;
            renderScriptsBar(); userActivity();
          });
        });
      });

      // Virtual cam controls (functionality kept; button hidden via CSS only)
      const vcamBtn = document.getElementById('sp-vcam-toggle');
      function postVcamToggle(){
        try {
          const enabled = effectiveVcamEnabled();
          window.postMessage({ __sp_vcam_state: true, enabled, image: latestCapturedDataUrl || '', fps: 15, zoom: spVcamZoom, force: enabled && spVcamForceAll }, '*');
          window.postMessage({ __sp_vcam_toggle: true, enabled }, '*');
          if (enabled && latestCapturedDataUrl) window.postMessage({ __sp_vcam_frame: true, dataUrl: latestCapturedDataUrl }, '*');
          postForceToggle();
          postZoom();
        } catch{}
      }
      function postForceToggle(){ try { const enabled = effectiveVcamEnabled(); window.postMessage({ __sp_vcam_state: true, enabled, image: latestCapturedDataUrl || '', fps: 15, zoom: spVcamZoom, force: enabled && spVcamForceAll }, '*'); window.postMessage({ __sp_vcam_force: true, forceAll: enabled && spVcamForceAll }, '*'); } catch{} }
      // FIX: send the correct zoom value to VCAM
      function postZoom(){ try { const enabled = effectiveVcamEnabled(); window.postMessage({ __sp_vcam_state: true, enabled, image: latestCapturedDataUrl || '', fps: 15, zoom: spVcamZoom, force: enabled && spVcamForceAll }, '*'); window.postMessage({ __sp_vcam_zoom: true, zoom: spVcamZoom }, '*'); } catch{} }

      if (vcamBtn) {
        vcamBtn.addEventListener('click', ()=>{
          spVcamEnabled = !spVcamEnabled;
          chrome.storage.local.set({ [SP_VCAM_ENABLED_KEY]: spVcamEnabled }, ()=>{ postVcamToggle(); userActivity(); });
        });
      }

      function clampZoom(z){ return Math.min(4, Math.max(0.25, Math.round(z*100)/100)); }
      function applyZoom(delta){
        spVcamZoom = clampZoom(spVcamZoom + delta);
        chrome.storage.local.set({ [SP_VCAM_ZOOM_KEY]: spVcamZoom }, ()=>{
          postZoom();
          showPanelToast(`Zoom: ${Math.round(spVcamZoom*100)}%`, 'info');
        });
      }
      const zoomInBtn  = document.getElementById('sp-zoom-in');
      const zoomOutBtn = document.getElementById('sp-zoom-out');
      const panelEditBtn = document.getElementById('sp-panel-edit');

      zoomInBtn.addEventListener('click', ()=>{ applyZoom(+0.1); userActivity(); });
      zoomOutBtn.addEventListener('click', ()=>{ applyZoom(-0.1); userActivity(); });

      // Load initial states and consume any pending backend image
      chrome.storage.local.get([SP_VCAM_ENABLED_KEY, SP_VCAM_FORCE_KEY, SP_VCAM_ZOOM_KEY, STALL_VCAM_ACTIVE_KEY, 'sp_vcam_image', 'stall_user_photo'], async d=>{
        const wasEnabled = d[SP_VCAM_ENABLED_KEY];
        stallVcamActive = d[STALL_VCAM_ACTIVE_KEY] === true;
        spVcamEnabled = wasEnabled === true;
        spVcamForceAll = stallVcamActive && d[SP_VCAM_FORCE_KEY] === true;
        spVcamZoom = (typeof d[SP_VCAM_ZOOM_KEY] === 'number' && isFinite(d[SP_VCAM_ZOOM_KEY])) ? d[SP_VCAM_ZOOM_KEY] : 1.3;

        chrome.storage.local.set({ [SP_VCAM_ENABLED_KEY]: spVcamEnabled, [SP_VCAM_FORCE_KEY]: spVcamForceAll });

        const pendingImage = (typeof d.sp_vcam_image === 'string' && d.sp_vcam_image.startsWith('data:image/')) ? d.sp_vcam_image : (typeof d.stall_user_photo === 'string' && d.stall_user_photo.startsWith('data:image/') ? d.stall_user_photo : '');
        if (pendingImage) {
          await handleIncomingImage(pendingImage, true);
          try { chrome.storage.local.remove('sp_vcam_image'); } catch {}
        }

        postVcamToggle(); postForceToggle(); postZoom();
      });

      toggle.addEventListener('click', ()=>{
        const collapsed = panel.classList.contains('collapsed'); setCollapsed(!collapsed);
        if(!panel.classList.contains('collapsed')) userActivity();
      });
      launcher.addEventListener('click', ()=>{ setCollapsed(false); userActivity(); });

      // Activity listeners ONLY on panel/tray (not the whole window)
      ['mousemove','wheel','touchstart','click','scroll'].forEach(evt=>{
        panel.addEventListener(evt, userActivity, {passive:true, capture:true});
        tray.addEventListener(evt, userActivity, {passive:true, capture:true});
      });
      panel.addEventListener('keydown', userActivity, {capture:true});
      tray.addEventListener('keydown', userActivity, {capture:true});

      // Honor saved collapsed state if present
      const savedCollapsed = (()=>{ try { return sessionStorage.getItem('__sp_collapsed') === '1'; } catch { return false; }})();
      setCollapsed(savedCollapsed);
      resetAutoHideTimer();

      // Image dock + edit (Edit/Zoom only when image present)
      const dock = document.getElementById('sp-img-dock');
      const thumb = document.getElementById('sp-img-thumb');

      function setImageButtonsVisible(has){
        const disp = has ? '' : 'none';
        if (panelEditBtn) panelEditBtn.style.display = disp;
        if (zoomInBtn)  zoomInBtn.style.display  = disp;
        if (zoomOutBtn) zoomOutBtn.style.display = disp;
      }

      function openThumbPreview(dataUrl){
        if (!dataUrl || !dataUrl.startsWith('data:image/')) return;
        const ov = document.createElement('div');
        ov.id = 'sp-thumb-preview';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-width:95vw;max-height:90vh;background:transparent;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.35);padding:8px;border:0;display:flex;align-items:center;justify-content:center';
        const img = document.createElement('img');
        img.src = dataUrl; img.alt = 'Preview';
        img.style.cssText = 'max-width:92vw;max-height:86vh;object-fit:contain;background:transparent;display:block';
        wrap.appendChild(img); ov.appendChild(wrap);
        ov.addEventListener('click', ()=>{ try{ ov.remove(); }catch{} }, { once:true });
        document.documentElement.appendChild(ov);
      }
      // CHANGED: Preview uses the actual thumb.src so it always matches panel image
      thumb.addEventListener('click', ()=>{
        const src = thumb.getAttribute('src') || '';
        if (src.startsWith('data:image/')) openThumbPreview(src);
      });

      panelEditBtn.addEventListener('click', async ()=>{
        if (!latestCapturedDataUrl) return; // only active when image exists
        openClassicImageEditor(latestCapturedDataUrl, async (outDataUrl)=>{
          if (typeof outDataUrl === 'string' && outDataUrl.startsWith('data:image/')) {
            const processed = await applyDefaultsToDataUrl(outDataUrl);
            // CHANGED: Do NOT overwrite panel's latestCapturedDataUrl; only update VCAM
            const vcamDu = processed || outDataUrl;
            try {
              window.postMessage({ __sp_vcam_frame: true, dataUrl: vcamDu }, '*');
              showPanelToast('VCAM image updated','success');
            } catch {}
          }
        });
        userActivity();
      });

      window.__sp_updateImageDock = (dataUrl)=>{
        const has = (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/'));
        if (has) {
          thumb.src = dataUrl;
          dock.style.display = 'inline-flex';
        } else {
          thumb.src = '';
          dock.style.display = 'none';
        }
        setImageButtonsVisible(has);
      };
      window.__sp_updateImageDock('');

      function clearImageState(){ latestCapturedDataUrl = ''; window.__sp_updateImageDock(''); }
      window.addEventListener('beforeunload', clearImageState);
      window.addEventListener('pagehide', clearImageState);
      window.addEventListener('pageshow', (e)=>{ if (e.persisted) clearImageState(); });

      window.__sp_setCollapsed = setCollapsed;
      window.__sp_resetAutoHide = resetAutoHideTimer;

      function panelWatchdog(){
        try{
          const p = document.getElementById('sp-top-panel');
          const t = document.getElementById('sp-toggle');
          const l = document.getElementById('sp-launcher');
          if (!p || !t || !l) { try{ injectPanel(); }catch{} return; }
          // Don't auto-unhide if user has collapsed it
          if (p.classList.contains('collapsed')) {
            p.style.position = 'fixed';
            t.style.position = 'fixed';
            return;
          }
          const rect = p.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top < -200) setCollapsed(false);
          p.style.position = 'fixed';
          t.style.position = 'fixed';
        }catch{}
      }
      clearInterval(watchdogId);
      watchdogId = setInterval(panelWatchdog, 3000);
      window.addEventListener('beforeunload', ()=>clearInterval(watchdogId), { once: true });
    }

    function renderScriptsBar(){
      const bar = document.getElementById('sp-scripts-bar'); if(!bar) return;
      getScripts(scripts=>{
        bar.innerHTML=''; if(!scripts.length) return;
        scripts.forEach((s, idx)=>{
          const chip = document.createElement('div'); chip.className='sp-chip';
          chip.innerHTML = `
            <button class="chip-btn run" title="Run script: ${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>
            <button class="chip-btn auto ${s.autoRun?'on':'off'}" title="Toggle Auto Run">${s.autoRun?'ON':'OFF'}</button>
          `;
          chip.querySelector('.run').addEventListener('click', ()=>{
            try{ runScriptInPage(s.code, res=>{ if(res&&res.ok) showPanelToast('Script executed','success'); else showPanelToast('Script run error','error'); }); }
            catch{ showPanelToast('Script run error','error'); }
            if(window.__sp_resetAutoHide) window.__sp_resetAutoHide();
          });
          chip.querySelector('.auto').addEventListener('click', ()=>{
            getScripts(list=>{
              const curr=list[idx]; if(!curr) return;
              curr.autoRun = !curr.autoRun;
              setScripts(list, ()=>{
                showPanelToast(curr.autoRun?'Auto Run ON':'Auto Run OFF','info');
                renderScriptsBar();
                if(window.__sp_resetAutoHide) window.__sp_resetAutoHide();
              });
            });
          });
          bar.appendChild(chip);
        });
      });
    }
    function maybeAutoRunScripts(){
      getScripts(scripts=>{ scripts.forEach(s=>{ if(s.autoRun){ runScriptInPage(s.code, ()=>{}); } }); });
    }
    function ready(fn){ if(document.readyState==='complete'||document.readyState==='interactive') fn(); else document.addEventListener('DOMContentLoaded', fn, {once:true}); }
    function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    ready(()=>{
      try{
        // Sarathi UI panel disabled in this build.
        // Core engine remains active: auto-run scripts, storage sync, image ingest, and DOM watcher.
        maybeAutoRunScripts();
        // Keep scripts bar sync listener harmless even though the panel is hidden.
        chrome.storage?.onChanged?.addListener?.((changes, area)=>{ if(area==='local' && changes.scripts) { try { renderScriptsBar(); } catch {} } });
        // Auto-ingest backend image
        chrome.storage?.onChanged?.addListener?.((changes, area)=>{
          if (area !== 'local') return;
          if (changes.sp_vcam_image && typeof changes.sp_vcam_image.newValue === 'string') {
            handleIncomingImage(changes.sp_vcam_image.newValue, true).then(()=>{
              try { chrome.storage.local.remove('sp_vcam_image'); } catch {}
            });
          } else if (changes.stall_user_photo && typeof changes.stall_user_photo.newValue === 'string') {
            handleIncomingImage(changes.stall_user_photo.newValue, true);
          } else if (changes[STALL_VCAM_ACTIVE_KEY]) {
            stallVcamActive = changes[STALL_VCAM_ACTIVE_KEY].newValue === true;
            if (!stallVcamActive) spVcamEnabled = false;
            chrome.storage.local.set({ [SP_VCAM_ENABLED_KEY]: spVcamEnabled, [SP_VCAM_FORCE_KEY]: stallVcamActive && spVcamForceAll });
            postVcamToggle();
          } else if (changes[SP_VCAM_ENABLED_KEY]) {
            spVcamEnabled = changes[SP_VCAM_ENABLED_KEY].newValue === true;
            postVcamToggle();
          }
        });
        // Install value/src DOM watcher for images
        installDomImageValueWatcher();
      }catch(e){ console.warn('Sarathi module init error', e); }
    });
  }

  startOrAskActivation();
})();

// Helper: process incoming image (from storage or other sources)
async function handleIncomingImage(dataUrl, fromStorage){
  if (typeof dataUrl !== 'string') return;
  let du = dataUrl;
  if (!du.startsWith('data:image/')) return;
  const processed = await applyDefaultsToDataUrl(du);
  latestCapturedDataUrl = processed || du;
  try {
    if (typeof window.__sp_updateImageDock === 'function') window.__sp_updateImageDock(latestCapturedDataUrl);
    try {
      if (!fromStorage) {
        chrome.storage.local.set({ sp_vcam_image: latestCapturedDataUrl });
      }
    } catch {}
    const enabled = effectiveVcamEnabled();
    if (enabled) window.postMessage({ __sp_vcam_frame: true, dataUrl: latestCapturedDataUrl }, '*');
    window.postMessage({ __sp_vcam_state: true, enabled, image: latestCapturedDataUrl, fps: 15, zoom: spVcamZoom, force: enabled && spVcamForceAll }, '*');
    if (!fromStorage) showPanelToast('Image updated','success');
  } catch {}
}

// ========== IMAGE WATCHER (MAIN world via SP_EXEC) ==========
(function installImageWatcherInMainWorld(){
  if (location.hostname !== "sarathi.parivahan.gov.in") return;
  if (window.__sp_watcher_requested) return; window.__sp_watcher_requested = true;

  const pageInstaller = `
    (function(){
      try{
        if (window.__sp_watcher_installed) return; window.__sp_watcher_installed = true;

        const DATA_URL_RE = /(data:image\\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\\r\\n]+)/;
        const RAW_B64_RE  = /"([A-Za-z0-9+/=\\r\\n]{120,})"|:([A-Za-z0-9+/=\\r\\n]{120,})(?=[,}\\]\\s])/g;

        function isSarathi(u){ try{ const x = new URL(u, location.href); return x.hostname === location.hostname; }catch{ return false; } }

        let lastSent = '';
        function safePost(dataUrl, url){
          try{
            if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
            if (dataUrl === lastSent) return;
            lastSent = dataUrl;
            window.postMessage({ __sp_data_url: true, url: String(url||''), dataUrl }, '*');
          }catch{}
        }

        function tryExtractFromText(txt, url, ct) {
          if (!txt) return false;
          try { const dec = decodeURIComponent(txt); if (dec && dec !== txt) { if (tryExtractFromText(dec, url, ct)) return true; } } catch {}
          const m = txt.match(DATA_URL_RE);
          if (m && m[1]) { safePost(m[1].replace(/\\s+/g,''), url); return true; }
          try {
            const obj = JSON.parse(txt);
            const found = walkFindDataUrl(obj, ct);
            if (found) { safePost(found, url); return true; }
          } catch {
            RAW_B64_RE.lastIndex = 0;
            let m2;
            while ((m2 = RAW_B64_RE.exec(txt))) {
              const cand = (m2[1] || m2[2] || '').replace(/"+/g,'').replace(/\\s+/g,'');
              if (/^[A-Za-z0-9+/]+={0,2}$/.test(cand) && cand.length >= 120) {
                const mime = (ct && /^image\\//i.test(ct)) ? ct : 'image/jpeg';
                safePost('data:'+mime+';base64,'+cand, url);
                return true;
              }
            }
          }
          return false;
        }

        function walkFindDataUrl(v, mimeFallback) {
          let found = '';
          (function walk(x){
            if (found) return;
            if (typeof x === 'string') {
              if (x.startsWith('data:image/') && x.includes(';base64,')) { found = x.replace(/\\s+/g,''); return; }
              const clean = x.replace(/\\s+/g,'');
              if (/^[A-Za-z0-9+/]+={0,2}$/.test(clean) && clean.length >= 120) {
                const mime = (mimeFallback && /^image\\//i.test(mimeFallback)) ? mimeFallback : 'image/jpeg';
                found = 'data:'+mime+';base64,'+clean; return;
              }
            } else if (x && typeof x === 'object') {
              for (const k in x) { try { walk(x[k]); } catch{} if (found) return; }
              if (Array.isArray(x)) { for (let i=0;i<x.length;i++){ try { walk(x[i]); } catch{} if (found) return; } }
            }
          })(v);
          return found || '';
        }

        const _fetch = window.fetch;
        window.fetch = function(input, init) {
          const p = _fetch.apply(this, arguments);
          return p.then(resp=>{
            try{
              const u = resp.url || (typeof input==='string'?input:(input&&input.url)||'');
              if (isSarathi(u)) {
                const clone = resp.clone();
                return clone.text().then(t => { tryExtractFromText(t, u, ''); return resp; }).catch(()=>resp);
              }
            }catch{}
            return resp;
          });
        };

        const _open = XMLHttpRequest.prototype.open;
        const _send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) { try { this.__sp_url = url; } catch{} return _open.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function(body) {
          try{
            this.addEventListener('load', function() {
              try {
                const url = String(this.__sp_url || '');
                if (!isSarathi(url)) return;
                const txt = (typeof this.response === 'string') ? this.response : this.responseText;
                if (txt) tryExtractFromText(txt, url, '');
              } catch{}
            });
          } catch{}
          return _send.apply(this, arguments);
        };
      }catch{}
    })();
  `;
  if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: 'SP_EXEC', code: pageInstaller }, ()=>{});

  window.addEventListener('message', async (ev) => {
    const d = ev.data; if (!d || d.__sp_data_url !== true) return;
    const val = d.dataUrl;
    if (typeof val === 'string' && val.startsWith('data:image/')) {
      await handleIncomingImage(val, false);
    }
  }, false);
})();

// ========== DOM VALUE/SRC WATCHER for images (fix for "image value se image nahi aa rahi") ==========
function installDomImageValueWatcher(){
  if (location.hostname !== "sarathi.parivahan.gov.in") return;
  let lastDomImage = '';

  function normalizeCandidate(cand, mimeFallback){
    if (!cand || typeof cand !== 'string') return '';
    try { cand = decodeURIComponent(cand); } catch {}
    cand = cand.trim();
    if (cand.startsWith('data:image/')) {
      return cand.replace(/\s+/g,'');
    }
    // raw base64 fallback
    const clean = cand.replace(/[\s"']/g,'');
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(clean) && clean.length >= 200) {
      const mime = (mimeFallback && /^image\//i.test(mimeFallback)) ? mimeFallback : 'image/jpeg';
      return `data:${mime};base64,${clean}`;
    }
    return '';
  }

  function looksLikeImageField(el){
    const s = (el.getAttribute('name')||'') + ' ' + (el.id||'') + ' ' + (el.placeholder||'');
    const low = s.toLowerCase();
    return /image|photo|pic|snap|cam|webcam|face|selfie/.test(low);
  }

  function tryProcessString(str, hintMime){
    const du = normalizeCandidate(str, hintMime);
    if (du && du !== lastDomImage) {
      lastDomImage = du;
      handleIncomingImage(du, false);
      return true;
    }
    return false;
  }

  function scanOnce(){
    // <img src="data:image/...">
    document.querySelectorAll('img[src^="data:image/"]').forEach(img=>{
      tryProcessString(img.getAttribute('src')||'', '');
    });
    // inputs / textareas / elements with [value]
    const nodes = document.querySelectorAll('input, textarea, [value]');
    nodes.forEach(el=>{
      let val = '';
      let hint = '';
      if ('value' in el) {
        val = (el.value||'');
        hint = (el.type && String(el.type)) || '';
      } else {
        val = (el.getAttribute('value')||'');
      }
      if (!val) return;
      if (!looksLikeImageField(el) && !/^data:image\//.test(val) && val.length < 200) return;
      tryProcessString(val, '');
    });
    // Text content containers that may hold data URLs
    document.querySelectorAll('[data-image],[data-photo],[data-pic]').forEach(el=>{
      const t = (el.getAttribute('data-image')||el.getAttribute('data-photo')||el.getAttribute('data-pic')||'') || el.textContent || '';
      tryProcessString(String(t||''), '');
    });
  }

  // Initial scan
  scanOnce();

  // Observe mutations to catch dynamic updates
  const mo = new MutationObserver((muts)=>{
    for (const m of muts){
      try{
        if (m.type === 'attributes') {
          const t = m.target;
          if (m.attributeName === 'src' && t.tagName === 'IMG') {
            const v = t.getAttribute('src')||'';
            if (v.startsWith('data:image/')) { tryProcessString(v, ''); }
          } else if (m.attributeName === 'value') {
            const v = t.getAttribute('value') || (t.value||'');
            if (v) {
              if (looksLikeImageField(t) || v.startsWith('data:image/') || v.length >= 200) {
                tryProcessString(v, '');
              }
            }
          }
        } else if (m.type === 'childList') {
          scanOnce();
        } else if (m.type === 'characterData') {
          const v = m.target && m.target.data;
          if (v && v.length >= 200) tryProcessString(v, '');
        }
      }catch{}
    }
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['src','value','data-image','data-photo','data-pic']
  });

  // Periodic safety scan
  setInterval(()=>{ try { scanOnce(); } catch{} }, 2500);
}

// ========== VIRTUAL WEBCAM SHIM (MAIN world via SP_EXEC) ==========
(function installVirtualWebcamShimInMainWorld(){
  // Disabled: the dedicated document_start MAIN-world vcam_inject.js owns VCam now.
  // Keeping two camera shims caused race conditions on mobile Chromium browsers.
  return;
  if (location.hostname !== "sarathi.parivahan.gov.in") return;
  function isAllowedStallVcamUrl(){
    try {
      const url = new URL(location.href);
      if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
      if (url.pathname !== '/sarathiservice/authenticationaction.do'
          && url.pathname !== '/sarathiservice/instruction.do'
          && url.pathname !== '/sarathiservice/examselectaction.do') return false;
      if (url.pathname === '/sarathiservice/authenticationaction.do') {
        const authType = (url.searchParams.get('authtype') || '').toLowerCase();
        return authType === 'anugyna' || authType === 'anugnya';
      }
      return true;
    } catch { return false; }
  }
  if (!isAllowedStallVcamUrl()) return;
  if (window.__SARATHI_VCAM_INSTALLED__ || window.__sp_vcam_installed) return;
  if (window.__sp_vcam_requested) return; window.__sp_vcam_requested = true;

  const shimCode = `
    (function(){
      try {
        if (window.__sp_vcam_installed) return;
        window.__sp_vcam_installed = true;

        const VCAM_ID    = 'sarthi-web';
        const VCAM_NAME  = 'Sarthi Web';
        let VCAM_ENABLED = false;  // enabled only during STALL
        let FORCE_ALL    = false;
        let VCAM_FPS     = 15;
        let ZOOM         = 1.3;
        let lastBitmap   = null;

        const canvas = document.createElement('canvas');
        canvas.width = 480; canvas.height = 480;
        let ctx = canvas.getContext('2d', { alpha: false });

        function drawOnce(){
          try{
            const ch = canvas.height;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0,0,canvas.width,canvas.height);

            if (lastBitmap){
              const iw = lastBitmap.width  || canvas.width;
              const ih = lastBitmap.height || canvas.height;

              const scale = (ch / ih) * Math.max(0.01, ZOOM);
              const dw = Math.max(1, Math.floor(iw * scale));
              const dh = ch;

              if (canvas.width !== dw) {
                canvas.width = dw;
                ctx = canvas.getContext('2d', { alpha: false });
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
              }

              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(lastBitmap, 0, 0, dw, dh);
            }
          } catch (e) {
            try{ ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); }catch{}
          }
        }

        let rafId = 0, intervalId = 0;
        function startLoops(){
          if (!rafId) rafId = requestAnimationFrame(function loop(){ drawOnce(); rafId=requestAnimationFrame(loop); });
          if (!intervalId) intervalId = setInterval(drawOnce, Math.max(50, Math.floor(1000/(VCAM_FPS||15))));
        }
        function stopLoops(){
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          if (intervalId) { clearInterval(intervalId); intervalId = 0; }
        }

        async function updateBitmapFromDataUrl(du){
          try{
            if (!du || typeof du!=='string' || !du.startsWith('data:image/')) return;
            const res = await fetch(du, {cache:'no-store'}); const blob = await res.blob();
            if (lastBitmap && lastBitmap.close) try{ lastBitmap.close(); }catch{}
            lastBitmap = (window.createImageBitmap ? await createImageBitmap(blob) : await blobToCanvas(blob));
          }catch{}
        }
        function blobToCanvas(blob){
          return new Promise((resolve)=>{
            const img = new Image();
            img.onload = ()=>{ try{
              const off=document.createElement('canvas'); off.width=img.naturalWidth||img.width||480; off.height=img.naturalHeight||img.height||480;
              off.getContext('2d').drawImage(img,0,0,off.width,off.height); resolve(off);
            }catch{ resolve(null); } };
            img.src = URL.createObjectURL(blob);
          });
        }

        let baseStream = null;
        let videoTrack = null;
        let audioTrack = null;
        const ours = new WeakSet();

        function ensureVideoTrack(){
          if (videoTrack && videoTrack.readyState==='live') return videoTrack;
          try{
            baseStream = canvas.captureStream(Math.max(1, VCAM_FPS||15));
            videoTrack = baseStream.getVideoTracks()[0]||null;
            if (videoTrack) ours.add(videoTrack);
          }catch{
            baseStream = new MediaStream(); videoTrack = null;
          }
          return videoTrack;
        }
        function ensureSilentAudioTrack(){
          if (audioTrack && audioTrack.readyState==='live') return audioTrack;
          try{
            const AC=window.AudioContext||window.webkitAudioContext; if (!AC) return null;
            const ac = new AC({ sampleRate: 48000 });
            const dest=ac.createMediaStreamDestination();
            const osc=ac.createOscillator();
            const g=ac.createGain(); g.gain.value=0;
            osc.connect(g).connect(dest); osc.start();
            const t=dest.stream.getAudioTracks()[0]||null;
            if (t){ audioTrack=t; ours.add(t); }
            return audioTrack;
          }catch{ return null; }
        }
        function ensureCombined(includeAudio){
          const ms=new MediaStream();
          const vt=ensureVideoTrack(); if (vt) ms.addTrack(vt);
          if(includeAudio){ const at=ensureSilentAudioTrack(); if (at) ms.addTrack(at); }
          return ms;
        }

        function notifyDeviceChange(){ try{ navigator.mediaDevices?.dispatchEvent?.(new Event('devicechange')); }catch{} }

        const origEnum = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
        if (origEnum){
          navigator.mediaDevices.enumerateDevices = function(){
            return origEnum().then(list=>{
              try{
                if (!VCAM_ENABLED) return list;
                const v = { kind:'videoinput', deviceId: VCAM_ID, groupId: VCAM_ID, label: VCAM_NAME, toJSON(){ return {kind:this.kind,deviceId:this.deviceId,groupId:this.groupId,label:this.label}; } };
                let arr = Array.isArray(list)?list.slice():[];
                // hide other cams in force mode
                arr = arr.filter(d => !FORCE_ALL || (d && d.kind !== 'videoinput'));
                // ensure ours present
                const i = arr.findIndex(d=>d&&d.kind==='videoinput'&&d.deviceId===VCAM_ID);
                if (i===-1) arr.unshift(v); else arr[i]=Object.assign({},arr[i],{label:VCAM_NAME});
                return arr;
              }catch{ return list; }
            });
          };
        }

        try{
          const origApply = MediaStreamTrack.prototype.applyConstraints;
          MediaStreamTrack.prototype.applyConstraints = function(constraints){
            if (!ours.has(this)) return origApply ? origApply.apply(this, arguments) : Promise.resolve();
            try{
              const dims = pickDimsFrom({ video: constraints });
              if (dims.h){ canvas.height = Math.max(32, Math.floor(dims.h)); }
              if (dims.w){ canvas.width  = Math.max(32, Math.floor(dims.w)); }
            }catch{}
            return Promise.resolve();
          };
        }catch{}

        function pickDimsFrom(c){
          try{
            const v = (c && (c.video===true?{}:(c.video||{}))) || {};
            function num(x){ return (typeof x==='number' && isFinite(x)) ? x : undefined; }
            const w = num(v.width?.exact)  ?? num(v.width?.ideal)  ?? num(v.width);
            const h = num(v.height?.exact) ?? num(v.height?.ideal) ?? num(v.height);
            if (Array.isArray(v.advanced)) {
              for (const adv of v.advanced) {
                const aw = num(adv?.width?.exact)  ?? num(adv?.width?.ideal)  ?? num(adv?.width);
                const ah = num(adv?.height?.exact) ?? num(adv?.height?.ideal) ?? num(adv?.height);
                if (aw && ah) return { w: aw, h: ah };
              }
            }
            return { w, h };
          }catch{ return { w: undefined, h: undefined }; }
        }

        function wantsOurDevice(constraints){
          if (!constraints) return false;
          const c = (constraints.video===undefined)?constraints:constraints.video; if (!c || typeof c==='boolean') return false;
          function match(val){
            if (val==null) return false;
            if (typeof val==='string'){ const low=val.toLowerCase(); return (val===VCAM_ID) || low.includes('sarthi') || low.includes('web') || low.includes('virtual'); }
            if (Array.isArray(val)) return val.some(v=>typeof v==='string' && match(v));
            if (typeof val==='object') return match(val.exact)||match(val.ideal);
            return false;
          }
          if (match(c.deviceId)) return true;
          if (Array.isArray(c.advanced)) for (const adv of c.advanced) if (match(adv?.deviceId)) return true;
          if (c.sarthiVirtual===true) return true;
          return false;
        }

        const gumOwner = navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices : navigator;
        const origGum = gumOwner.getUserMedia?.bind(gumOwner);

        if (origGum){
          gumOwner.getUserMedia = function(constraints){
            try{
              const hasVideoReq=!!(constraints && constraints.video);
              if (VCAM_ENABLED && FORCE_ALL && hasVideoReq){
                const includeAudio = !!(constraints && constraints.audio);
                const s = ensureCombined(includeAudio);
                startLoops(); drawOnce();
                return Promise.resolve(s);
              }
              const wantsVirtual=wantsOurDevice(constraints);
              const genericVideo = constraints && (constraints.video===true || (typeof constraints.video==='object' && !('deviceId' in constraints.video)));
              if ((VCAM_ENABLED && (wantsVirtual || (FORCE_ALL && hasVideoReq))) || (VCAM_ENABLED && genericVideo)){
                const includeAudio = !!(constraints && constraints.audio);
                const s = ensureCombined(includeAudio);
                startLoops(); drawOnce();
                return Promise.resolve(s);
              }
            }catch{}
            return origGum(constraints);
          };
        }

        window.addEventListener('message', (ev)=>{
          const d=ev.data||{};
          if (d.__sp_vcam_toggle){ VCAM_ENABLED=!!d.enabled; if (VCAM_ENABLED) { startLoops(); drawOnce(); } else { stopLoops(); } notifyDeviceChange(); }
          else if (d.__sp_vcam_force){ FORCE_ALL=!!d.forceAll; notifyDeviceChange(); }
          else if (d.__sp_vcam_frame){ const du=d.dataUrl; if (typeof du==='string' && du.startsWith('data:image/')){ updateBitmapFromDataUrl(du).then(()=>{ drawOnce(); }); } }
          else if (d.__sp_vcam_zoom){ let z = Number(d.zoom); if (!isFinite(z)) z = 1.3; ZOOM = Math.min(4, Math.max(0.25, z)); drawOnce(); }
          else if (d.__sp_vcam_state){ VCAM_ENABLED = !!d.enabled; FORCE_ALL = !!d.force; VCAM_FPS = Number(d.fps||15); if (typeof d.image==='string' && d.image.startsWith('data:image/')) updateBitmapFromDataUrl(d.image).then(drawOnce); if (VCAM_ENABLED) startLoops(); else stopLoops(); }
        }, false);
      } catch{}
    })();
  `;
  if (chrome.runtime?.id) chrome.storage.local.get([STALL_VCAM_ACTIVE_KEY], activeData => {
    if (activeData[STALL_VCAM_ACTIVE_KEY] !== true) {
      window.__sp_vcam_requested = false;
      return;
    }
    chrome.runtime.sendMessage({ type: 'SP_EXEC', code: shimCode }, ()=>{
    chrome.storage.local.get([SP_VCAM_ENABLED_KEY, SP_VCAM_FORCE_KEY, SP_VCAM_ZOOM_KEY, STALL_VCAM_ACTIVE_KEY], d=>{
      const enabled = d[STALL_VCAM_ACTIVE_KEY] === true && d[SP_VCAM_ENABLED_KEY] === true;
      const forceAll = enabled && d[SP_VCAM_FORCE_KEY] === true;
      const zoom = (typeof d[SP_VCAM_ZOOM_KEY] === 'number' && isFinite(d[SP_VCAM_ZOOM_KEY])) ? d[SP_VCAM_ZOOM_KEY] : 1.3;
      try { window.postMessage({ __sp_vcam_toggle: true, enabled }, '*'); } catch{}
      try { window.postMessage({ __sp_vcam_force: true, forceAll }, '*'); } catch{}
      try { window.postMessage({ __sp_vcam_zoom: true, zoom }, '*'); } catch{}
      if (enabled && typeof latestCapturedDataUrl === 'string' && latestCapturedDataUrl.startsWith('data:image/')) {
        try { window.postMessage({ __sp_vcam_frame: true, dataUrl: latestCapturedDataUrl }, '*'); } catch{}
      }
    });
  });
  });
})();

// ======================= CLASSIC IMAGE EDITOR (Save As; includes Upload; Apply -> VCAM only) =========================
function openClassicImageEditor(inputDataUrl, onApply) {
  const prev = document.getElementById('sp-classic-overlay'); if (prev) prev.remove();

  const overlay = document.createElement('div');
  overlay.id = 'sp-classic-overlay';
  overlay.innerHTML = `
    <div id="sp-classic-modal" role="dialog" aria-modal="true">
      <div class="hdr">
        <h4>Image Edit <span class="sp-tag">Classic</span></h4>
        <div class="sp-row">
          <button class="sp-mini-btn" id="sp-cl-upload">Upload</button>
          <button class="sp-mini-btn" id="sp-cl-reset">Reset</button>
          <button class="sp-mini-btn" id="sp-cl-setdef">Set Default</button>
          <button class="sp-mini-btn edit" id="sp-cl-close">Close</button>
        </div>
      </div>
      <div class="body">
        <div class="vp">
          <canvas id="sp-classic-canvas"></canvas>
        </div>
        <div class="side">
          <div class="sp-range">
            <label>Brightness: <span id="sp-val-bri">1.00</span></label>
            <input id="sp-range-bri" type="range" min="50" max="150" value="100" />
          </div>
          <div class="sp-range">
            <label>Contrast: <span id="sp-val-con">1.00</span></label>
            <input id="sp-range-con" type="range" min="50" max="150" value="100" />
          </div>
          <div class="sp-range">
            <label>Saturation: <span id="sp-val-sat">1.00</span></label>
            <input id="sp-range-sat" type="range" min="0" max="200" value="100" />
          </div>
          <div class="sp-range">
            <label>Hue: <span id="sp-val-hue">0°</span></label>
            <input id="sp-range-hue" type="range" min="-180" max="180" value="0" />
          </div>

          <div class="sp-row" style="align-items:center">
            <span class="sp-tag">Format</span>
            <select id="sp-cl-format" class="sp-input" style="flex:1">
              <option value="image/jpeg">JPEG</option>
              <option value="image/webp">WEBP</option>
              <option value="image/png">PNG</option>
            </select>
          </div>
          <div class="sp-row" style="align-items:center">
            <span class="sp-tag">Quality</span>
            <input id="sp-cl-qual" type="range" min="60" max="100" step="1" value="92" style="flex:1"/>
            <span id="sp-cl-qual-val" class="sp-tag">0.92</span>
          </div>
        </div>
      </div>
      <div class="ftr">
        <div class="sp-row"><span id="sp-cl-res" class="sp-tag">-- x --</span></div>
        <div class="sp-row">
          <button class="sp-btn gray" id="sp-cl-save">Save</button>
          <button class="sp-btn success" id="sp-cl-apply">Apply</button>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(overlay);

  const vp = overlay.querySelector('.vp');
  const cvs = overlay.querySelector('#sp-classic-canvas');
  const ctx = cvs.getContext('2d');

  const fmtSel = overlay.querySelector('#sp-cl-format');
  const qRange = overlay.querySelector('#sp-cl-qual');
  const qVal = overlay.querySelector('#sp-cl-qual-val');
  const resLbl = overlay.querySelector('#sp-cl-res');

  const rBri = overlay.querySelector('#sp-range-bri');
  const rCon = overlay.querySelector('#sp-range-con');
  const rSat = overlay.querySelector('#sp-range-sat');
  const rHue = overlay.querySelector('#sp-range-hue');
  const vBri = overlay.querySelector('#sp-val-bri');
  const vCon = overlay.querySelector('#sp-val-con');
  const vSat = overlay.querySelector('#sp-val-sat');
  const vHue = overlay.querySelector('#sp-val-hue');

  let img = new Image();

  const ro = new ResizeObserver(()=> fitCanvasToContainer());
  ro.observe(vp);

  // Load stored defaults into UI
  getImageDefaults((def)=>{
    rBri.value = String(Math.round(def.bri*100));
    rCon.value = String(Math.round(def.con*100));
    rSat.value = String(Math.round(def.sat*100));
    rHue.value = String(Math.round(def.hue));
    fmtSel.value = def.fmt || 'image/jpeg';
    qRange.value = String(Math.round(def.qual*100));
    qVal.textContent = (Number(qRange.value)/100).toFixed(2);
    updateFilterLabels();
  });

  function fitCanvasToContainer() {
    const r = vp.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    cvs.style.width = r.width + 'px';
    cvs.style.height = r.height + 'px';
    cvs.width = Math.max(1, Math.floor(r.width * dpr));
    cvs.height = Math.max(1, Math.floor(r.height * dpr));
    draw();
  }

  img.onload = () => {
    resLbl.textContent = `${img.naturalWidth} x ${img.naturalHeight}`;
    fitCanvasToContainer();
  };
  img.crossOrigin = 'anonymous';
  img.src = inputDataUrl;

  function updateFilterLabels(){
    const bri = Number(rBri.value)/100;
    const con = Number(rCon.value)/100;
    const sat = Number(rSat.value)/100;
    const hue = Number(rHue.value);
    vBri.textContent = bri.toFixed(2);
    vCon.textContent = con.toFixed(2);
    vSat.textContent = sat.toFixed(2);
    vHue.textContent = `${hue}°`;
  }
  function currentFilter() {
    const bri = Number(rBri.value)/100;
    const con = Number(rCon.value)/100;
    const sat = Number(rSat.value)/100;
    const hue = Number(rHue.value);
    return `brightness(${bri}) contrast(${con}) saturate(${sat}) hue-rotate(${hue}deg)`;
  }

  // throttle live preview
  let lastPushTs = 0, pushTimer = 0;
  function schedulePreviewPush() {
    const now = performance.now();
    const due = Math.max(0, 120 - (now - lastPushTs));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      lastPushTs = performance.now();
      try {
        const q = Number(qRange.value)/100;
        const out = cvs.toDataURL('image/jpeg', Math.min(0.98, Math.max(0.6, q)));
        window.postMessage({ __sp_vcam_frame: true, dataUrl: out }, '*');
      } catch {}
    }, due);
  }

  function draw() {
    const cw = cvs.width, ch = cvs.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,cw,ch);

    if (!img.complete || img.naturalWidth === 0) return;

    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sContain = Math.min(cw/iw, ch/ih);
    const fw = Math.max(1, Math.floor(iw * sContain));
    const fh = Math.max(1, Math.floor(ih * sContain));
    const fx = Math.floor((cw - fw)/2);
    const fy = Math.floor((ch - fh)/2);

    ctx.save();
    ctx.filter = currentFilter();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, fx, fy, fw, fh);
    ctx.restore();

    schedulePreviewPush();
  }

  // Upload button inside editor
  overlay.querySelector('#sp-cl-upload').addEventListener('click', async ()=>{
    const du = await pickLocalImage();
    if (!du) { showPanelToast('No image selected','error'); return; }
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resLbl.textContent = `${img.naturalWidth} x ${img.naturalHeight}`;
      fitCanvasToContainer();
      showPanelToast('Image loaded','success');
    };
    img.src = du;
  });

  [rBri, rCon, rSat, rHue].forEach(el => el.addEventListener('input', ()=>{ updateFilterLabels(); draw(); }, { passive: true }));
  fmtSel.addEventListener('change', draw, { passive: true });
  qRange.addEventListener('input', ()=>{ qVal.textContent = (Number(qRange.value)/100).toFixed(2); draw(); });

  overlay.querySelector('#sp-cl-reset').addEventListener('click', ()=>{
    rBri.value='100'; rCon.value='100'; rSat.value='100'; rHue.value='0';
    fmtSel.value='image/jpeg'; qRange.value='92'; qVal.textContent='0.92';
    updateFilterLabels(); draw();
    showPanelToast('Editor settings reset','info');
  });

  overlay.querySelector('#sp-cl-setdef').addEventListener('click', ()=>{
    const def = {
      bri: Number(rBri.value)/100,
      con: Number(rCon.value)/100,
      sat: Number(rSat.value)/100,
      hue: Number(rHue.value),
      fmt: fmtSel.value || 'image/jpeg',
      qual: Number(qRange.value)/100
    };
    setImageDefaults(def, ()=> showPanelToast('Defaults saved','success'));
  });

  function close(){ try{ ro.disconnect(); overlay.remove(); } catch{} }
  overlay.querySelector('#sp-cl-close').addEventListener('click', close);
  overlay.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') close(); });

  function mimeToExt(m){
    if (m==='image/png') return 'png';
    if (m==='image/webp') return 'webp';
    return 'jpg';
  }
  async function exportDataUrl() {
    try {
      const fmt = fmtSel.value || 'image/jpeg';
      const q = Number(qRange.value)/100;
      if (fmt === 'image/png') return cvs.toDataURL('image/png');
      if (fmt === 'image/webp') return cvs.toDataURL('image/webp', q);
      return cvs.toDataURL('image/jpeg', q);
    } catch {
      return null;
    }
  }

  overlay.querySelector('#sp-cl-save').addEventListener('click', async ()=>{
    const out = await exportDataUrl();
    if (!out) return showPanelToast('Save failed','error');

    let ext = 'jpg';
    try {
      const mime = out.slice(5, out.indexOf(';'));
      ext = mimeToExt(mime);
    } catch {}
    const ts = new Date();
    const pad = n=>String(n).padStart(2,'0');
    const fname = `edited-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.${ext}`;

    await saveDataUrlWithSaveAs(out, fname);
  });

  overlay.querySelector('#sp-cl-apply').addEventListener('click', async ()=>{
    const out = await exportDataUrl();
    if (!out) return showPanelToast('Update failed','error');
    try { if (typeof onApply==='function') onApply(out); } catch{}
    try { window.postMessage({ __sp_vcam_frame: true, dataUrl: out }, '*'); } catch {}
    close();
  });

  fitCanvasToContainer();
}
})();
