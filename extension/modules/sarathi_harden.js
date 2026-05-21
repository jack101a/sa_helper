// extension/modules/sarathi_harden.js
(function () {
    'use strict';

    function isStallRelatedUrl(href) {
        try {
            const url = new URL(href || location.href, location.origin);
            if (!url.hostname.includes('sarathi.parivahan.gov.in')) return false;
            const path = (url.pathname || '').toLowerCase();
            if (path === '/sarathiservice/authenticationaction.do') {
                const authtype = (url.searchParams.get('authtype') || '').toLowerCase();
                return authtype === 'anugnya' || authtype === 'anugyna';
            }
            return (
                path === '/sarathiservice/instruction.do' ||
                path === '/sarathiservice/examselectaction.do' ||
                path === '/sarathiservice/stallexam.do' ||
                path === '/sarathiservice/stallloginsubmit.do'
            );
        } catch {
            return false;
        }
    }

    window.SarathiHarden = {
        init() {
            if (!location.hostname.includes('sarathi.parivahan.gov.in')) return;
            if (!isStallRelatedUrl(location.href)) return;
            if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
            this.early403Guard();
            this.hardenPage();
            
            // Multiple attempts to catch DOM-based 403 text
            document.addEventListener("DOMContentLoaded", () => this.early403Guard(), { once: true });
            setTimeout(() => this.early403Guard(), 400);
            setTimeout(() => this.early403Guard(), 1200);
            setTimeout(() => this.early403Guard(), 2400);

            console.log('[Automation] Sarathi Hardening active');
        },

        early403Guard() {
            const STABLE_URL = "https://sarathi.parivahan.gov.in/sarathiservice/authenticationaction.do?authtype=Anugnya";
            const href = location.href;
            const bodyText = document.body?.innerText?.toLowerCase() || "";
            const isUnstableAuth = href.includes("authenticationaction.do") && href.includes("authtype=Anugyna");
            const is403Page = href.includes("/403.jsp") || (bodyText.includes("403") && bodyText.includes("forbidden"));

            if (is403Page || isUnstableAuth) {
                try {
                    const k = "__sp403_ts";
                    const last = Number(sessionStorage.getItem(k) || 0);
                    if (Date.now() - last > 3000) {
                        sessionStorage.setItem(k, String(Date.now()));
                        location.replace(STABLE_URL);
                    }
                } catch {}
            } else if (href.includes(STABLE_URL)) {
                try { sessionStorage.removeItem("__sp403_ts"); } catch {}
            }
        },

        hardenPage() {
            try {
                // Remove existing debugger keywords from inline scripts (DOM level)
                document.querySelectorAll('script').forEach(s => {
                    if (s.textContent.includes('debugger')) {
                        s.textContent = s.textContent.replace(/debugger;/g, '');
                    }
                });

                // Bypass key-blocking
                window.onkeydown = null; window.onkeyup = null; window.onkeypress = null;
                document.onkeydown = null; document.onkeyup = null; document.onkeypress = null;

                // Total Merge: Start DOM Scraper
                this.installDomImageWatcher();
            } catch (e) {
                console.warn('[Automation] Hardening error:', e);
            }
        },

        installDomImageWatcher() {
            const scan = () => {
                // Look for images in src, value, and data-attributes
                const elements = document.querySelectorAll('img[src^="data:image/"], input[value^="data:image/"], [data-image], [data-photo]');
                elements.forEach(el => {
                    const val = el.src || el.value || el.getAttribute('data-image') || el.getAttribute('data-photo');
                    if (val && val.startsWith('data:image/')) {
                        window.postMessage({ type: 'SP_DOM_IMAGE', dataUrl: val }, '*');
                    }
                });
            };

            // Watch for dynamic updates
            const mo = new MutationObserver(scan);
            mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'value'] });
            
            // Periodic fallback
            this._scanInterval = setInterval(scan, 3000);
            scan();
        }
    };

    // Global listener for Network/DOM images discovered by MAIN world
    window.addEventListener('message', (ev) => {
        if (!isStallRelatedUrl(location.href)) return;
        const d = ev.data;
        if (!d) return;
        if (d.type === 'SP_NETWORK_IMAGE' || d.type === 'SP_DOM_IMAGE') {
            const dataUrl = d.text || d.dataUrl;
            if (dataUrl && dataUrl.includes('data:image/')) {
                console.log(`[Automation] Captured ${d.type} Image. Updating VCAM...`);
                if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: 'VCAM_UPDATE_STATE', state: { image: dataUrl } });
            }
        }
    });

    window.SarathiImageDetector = {
        lastImage: '',

        init() {
            if (!location.hostname.includes('sarathi.parivahan.gov.in')) return;
            if (!isStallRelatedUrl(location.href)) return;
            if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
            this.scanOnce();
            this.startObserver();
            console.log('[Automation] Sarathi Image Detector active');
        },

        normalizeCandidate(cand) {
            if (!cand || typeof cand !== 'string') return '';
            try { cand = decodeURIComponent(cand); } catch {}
            cand = cand.trim();
            if (cand.startsWith('data:image/')) return cand.replace(/\s+/g, '');
            const clean = cand.replace(/[\s"']/g, '');
            if (/^[A-Za-z0-9+/]+={0,2}$/.test(clean) && clean.length >= 200) {
                return `data:image/jpeg;base64,${clean}`;
            }
            return '';
        },

        looksLikeImageField(el) {
            const s = (el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '');
            return /image|photo|pic|snap|cam|webcam|face|selfie/.test(s.toLowerCase());
        },

        processString(str) {
            const du = this.normalizeCandidate(str);
            if (du && du !== this.lastImage) {
                this.lastImage = du;
                console.log('[Automation] User photo detected, saving to storage...');
                if (chrome.runtime?.id) chrome.storage.local.set({ stall_user_photo: du });
                return true;
            }
            return false;
        },

        scanOnce() {
            // Find <img> with data URLs
            document.querySelectorAll('img[src^="data:image/"]').forEach(img => {
                this.processString(img.getAttribute('src') || '');
            });
            // Scan inputs/textareas for base64
            document.querySelectorAll('input, textarea, [value]').forEach(el => {
                let val = ('value' in el) ? el.value : el.getAttribute('value');
                if (val && (this.looksLikeImageField(el) || val.startsWith('data:image/') || val.length >= 200)) {
                    this.processString(val);
                }
            });
        },

        startObserver() {
            const mo = new MutationObserver((muts) => {
                for (const m of muts) {
                    if (m.type === 'attributes') {
                        const t = m.target;
                        if (m.attributeName === 'src' && t.tagName === 'IMG') {
                            const v = t.getAttribute('src') || '';
                            if (v.startsWith('data:image/')) this.processString(v);
                        } else if (m.attributeName === 'value') {
                            const v = t.getAttribute('value') || t.value || '';
                            if (v && (this.looksLikeImageField(t) || v.startsWith('data:image/') || v.length >= 200)) {
                                this.processString(v);
                            }
                        }
                    } else if (m.type === 'childList') {
                        this.scanOnce();
                    }
                }
            });
            mo.observe(document.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['src', 'value', 'data-image', 'data-photo', 'data-pic']
            });
            this._scanInterval = setInterval(() => this.scanOnce(), 5000);
        }
    };

})();
