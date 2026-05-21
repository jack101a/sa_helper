// popup.js — Controls for STALL Solver popup

const toggleSolver  = document.getElementById('toggleSolver');
const toggleRefresh = document.getElementById('toggleRefresh');
const statusBar     = document.getElementById('statusBar');
const hdrDot        = document.getElementById('hdrDot');

// ── Load saved state ──────────────────────────────────────────
chrome.storage.local.get(['solverEnabled', 'autoRefresh'], (data) => {
    const enabled = data.solverEnabled !== false; // default ON
    const refresh = data.autoRefresh  !== false; // default ON

    toggleSolver.checked  = enabled;
    toggleRefresh.checked = refresh;
    updateUI(enabled);
});

// ── Toggle handlers ───────────────────────────────────────────
toggleSolver.addEventListener('change', () => {
    const enabled = toggleSolver.checked;
    chrome.storage.local.set({ solverEnabled: enabled });
    updateUI(enabled);

    // Notify active tab's content script immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SET_ENABLED',
                enabled
            }).catch(() => {}); // tab may not have content script
        }
    });
});

toggleRefresh.addEventListener('change', () => {
    const autoRefresh = toggleRefresh.checked;
    chrome.storage.local.set({ autoRefresh });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SET_AUTO_REFRESH',
                autoRefresh
            }).catch(() => {});
        }
    });
});

// ── UI updater ────────────────────────────────────────────────
function updateUI(enabled) {
    if (enabled) {
        statusBar.textContent = '● SOLVER ACTIVE';
        statusBar.className   = 'status-bar enabled';
        hdrDot.className      = 'dot';
    } else {
        statusBar.textContent = '● SOLVER DISABLED';
        statusBar.className   = 'status-bar disabled';
        hdrDot.className      = 'dot off';
    }
}
