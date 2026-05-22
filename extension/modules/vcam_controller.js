
// extension/modules/vcam_controller.js
// This module bridges the extension world and the MAIN world (vcam_inject.js).
(function () {
    'use strict';

    function isAllowedStallVcamUrl(urlValue = location.href) {
        try {
            const url = new URL(urlValue);
            if (url.hostname !== 'sarathi.parivahan.gov.in') return false;
            if (url.pathname !== '/sarathiservice/authenticationaction.do'
                && url.pathname !== '/sarathiservice/instruction.do'
                && url.pathname !== '/sarathiservice/examselectaction.do'
                && url.pathname !== '/sarathiservice/stallexam.do'
                && url.pathname !== '/sarathiservice/stallLoginSubmit.do') {
                return false;
            }
            if (url.pathname === '/sarathiservice/authenticationaction.do') {
                const authType = (url.searchParams.get('authtype') || '').toLowerCase();
                return authType === 'anugyna' || authType === 'anugnya';
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    window.VcamController = {
        state: {
            enabled: false,
            stallActive: false,
            requestedEnabled: false,
            image: '',
            fps: 15,
            zoom: 1.3,
            force: false
        },

        init() {
            if (this.state.initialized) return;
            if (!isAllowedStallVcamUrl()) return;
            this.state.initialized = true;
            this.syncFromStorage();
            // Listen for storage changes
            chrome.storage.onChanged.addListener(async (changes, area) => {
                if (area !== 'local') return;

                if (changes.stallVcamActive || changes.vcamEnabled || changes.sp_vcam_enabled) {
                    if (changes.stallVcamActive) this.state.stallActive = changes.stallVcamActive.newValue === true;
                    if (changes.vcamEnabled || changes.sp_vcam_enabled) {
                        const raw = changes.vcamEnabled ? changes.vcamEnabled.newValue : changes.sp_vcam_enabled.newValue;
                        this.state.requestedEnabled = raw === true;
                    }
                    this.state.enabled = this.state.stallActive && this.state.requestedEnabled;
                    this.pushToPage();
                }

                if (changes.sp_vcam_zoom) {
                    const z = Number(changes.sp_vcam_zoom.newValue);
                    if (isFinite(z)) this.state.zoom = z;
                    this.pushToPage();
                }

                if (changes.sp_vcam_force_all) {
                    this.state.force = this.state.stallActive && changes.sp_vcam_force_all.newValue === true;
                    this.pushToPage();
                }

                if (changes.sp_vcam_image) {
                    const du = changes.sp_vcam_image.newValue || '';
                    this.state.image = du;
                    this.pushToPage();
                }

                if (changes.stall_user_photo) {
                    const du = changes.stall_user_photo.newValue || '';
                    // Main detector images still get the original beautify pipeline.
                    const processed = await this.applyFilters(du);
                    this.state.image = processed;
                    this.pushToPage();
                }
            });
            console.log('[VCAM] Controller initialized with Auto-Beautify');
        },

        async syncFromStorage() {
            const data = await window.up_getStorage([
                'stall_user_photo',
                'sp_vcam_image',
                'vcamEnabled',
                'sp_vcam_enabled',
                'stallVcamActive',
                'sp_vcam_zoom',
                'sp_vcam_force_all'
            ]);

            this.state.stallActive = data.stallVcamActive === true;
            this.state.requestedEnabled = (data.vcamEnabled ?? data.sp_vcam_enabled) === true;
            this.state.enabled = this.state.stallActive && this.state.requestedEnabled;
            this.state.zoom = (typeof data.sp_vcam_zoom === 'number' && isFinite(data.sp_vcam_zoom)) ? data.sp_vcam_zoom : 1.3;
            this.state.force = this.state.stallActive && data.sp_vcam_force_all === true;

            if (typeof data.sp_vcam_image === 'string' && data.sp_vcam_image.startsWith('data:image/')) {
                this.state.image = data.sp_vcam_image;
            } else {
                const processed = await this.applyFilters(data.stall_user_photo || '');
                this.state.image = processed;
            }

            this.pushToPage();
        },

        // Sarthi Pinel+ logic: Apply brightness/contrast to improve recognition
        async applyFilters(inputDu) {
            if (!inputDu || !inputDu.startsWith('data:image/')) return inputDu;

            return new Promise((resolve) => {
                const def = { bri: 1.1, con: 1.1, sat: 1.1, hue: 0, qual: 0.92 }; // Optimal defaults
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    try {
                        const w = img.naturalWidth || 640;
                        const h = img.naturalHeight || 480;
                        const cvs = document.createElement('canvas');
                        cvs.width = w; cvs.height = h;
                        const ctx = cvs.getContext('2d');
                        ctx.save();
                        ctx.filter = `brightness(${def.bri}) contrast(${def.con}) saturate(${def.sat}) hue-rotate(${def.hue}deg)`;
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, w, h);
                        ctx.restore();
                        resolve(cvs.toDataURL('image/jpeg', def.qual));
                    } catch (e) { resolve(inputDu); }
                };
                img.onerror = () => resolve(inputDu);
                img.src = inputDu;
            });
        },

        pushToPage() {
            try {
                if (!isAllowedStallVcamUrl()) return;
                window.postMessage({
                    __sp_vcam_state: true,
                    enabled: !!this.state.enabled,
                    image: String(this.state.image || ''),
                    fps: Number(this.state.fps || 15),
                    zoom: Number(this.state.zoom || 1.3),
                    force: !!this.state.force
                }, '*');
            } catch (e) {}
        }
    };

})();
