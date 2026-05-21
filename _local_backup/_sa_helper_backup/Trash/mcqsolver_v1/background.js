// ═══════════════════════════════════════════════════════════════
// background.js — MV3 Service Worker
// Handles CORS-free fetch to LiteLLM gateway for Layer 3 fallback
// ═══════════════════════════════════════════════════════════════

// ─── CONFIG ─────────────────────────────────────────────────────
const LITELLM_ENDPOINT = 'https://llm.ajaxhs.duckdns.org/v1/chat/completions';
const LITELLM_API_KEY = 'test1234';
const LITELLM_MODEL = 'gemma-4-31b-it_gemini';

// ─── MESSAGE LISTENER ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'LITELLM_SOLVE') {
        handleLiteLLMRequest(msg.payload)
            .then(result => sendResponse({ ok: true, data: result }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true; // Keep channel open for async response
    }

    if (msg.type === 'LOG_HASH') {
        console.log('[MCQ Solver] Sign Hash:', msg.hash, '| Q#:', msg.qNum);
        return false;
    }

    if (msg.type === 'ABORT_TAB') {
        // Fallback when top.location is blocked by the site's frame-busting headers.
        // Redirect the whole tab to google.com to end the exam session.
        if (sender.tab?.id) {
            chrome.tabs.update(sender.tab.id, { url: 'https://www.google.com' });
        }
        return false;
    }
});

// ─── LITELLM HANDLER ────────────────────────────────────────────
async function handleLiteLLMRequest(payload) {
    const { qImage, optionImages, questionText } = payload;

    // Build multimodal content array
    const content = [
        {
            type: 'text',
            text: `You are an expert at Indian road signs and traffic rules for the Sarathi Parivahan driving license exam.

Look at the question image and the 4 option images. The question may be in Hindi.
${questionText ? 'OCR text detected: "' + questionText + '"' : ''}

Reply with ONLY the correct option number (1, 2, 3, or 4). Nothing else.`
        },
        {
            type: 'image_url',
            image_url: { url: qImage, detail: 'low' }
        }
    ];

    // Add option images
    for (let i = 0; i < optionImages.length; i++) {
        if (optionImages[i] && optionImages[i].startsWith('data:')) {
            content.push({
                type: 'text',
                text: `Option ${i + 1}:`
            });
            content.push({
                type: 'image_url',
                image_url: { url: optionImages[i], detail: 'low' }
            });
        }
    }

    const body = {
        model: LITELLM_MODEL,
        messages: [{ role: 'user', content }],
        max_tokens: 10,
        temperature: 0
    };

    const resp = await fetch(LITELLM_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LITELLM_API_KEY}`
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        throw new Error(`LiteLLM HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();
    const answer = json.choices?.[0]?.message?.content?.trim();

    // Extract the option number (1-4)
    const match = answer?.match(/[1-4]/);
    if (match) {
        return { optionNumber: parseInt(match[0], 10), raw: answer };
    }

    throw new Error('LiteLLM returned unparseable answer: ' + answer);
}
