/**
 * Injectable DOM picker.
 * Listens for PICK_ELEMENT and returns a robust CSS selector for clicked node.
 */

(function () {
  if (window.__aiTaskPickerActive) return;
  window.__aiTaskPickerActive = true;

  const extApi = typeof browser !== "undefined" ? browser : chrome;
  let targetField = "source";
  let overlay = null;
  let banner = null;

  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    if (el.className && typeof el.className === "string") {
      const classes = el.className.trim().split(/\s+/).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      if (classes) {
        const candidate = `${el.tagName.toLowerCase()}${classes}`;
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      let nth = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        nth += 1;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${nth})`);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function drawOverlay(el) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;";
      document.body.appendChild(overlay);
    }
    const rect = el.getBoundingClientRect();
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.position = "absolute";
    overlay.style.outline = "3px solid #f59e0b";
    overlay.style.background = "rgba(245, 158, 11, 0.16)";
    overlay.style.borderRadius = "3px";
  }

  function showBanner(text) {
    banner = document.createElement("div");
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111827;color:#f3f4f6;font:600 13px/34px system-ui;text-align:center;padding:0 10px;border-bottom:2px solid #f59e0b;";
    banner.textContent = `AI Task Assistant: ${text}. Click element, ESC to cancel.`;
    document.body.appendChild(banner);
  }

  function cleanup(sendCancel) {
    document.removeEventListener("mouseover", onHover, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (overlay) overlay.remove();
    if (banner) banner.remove();
    overlay = null;
    banner = null;
    window.__aiTaskPickerActive = false;
    if (sendCancel) {
      extApi.runtime.sendMessage({ type: "LOCATOR_CANCELLED", targetField });
    }
  }

  function onHover(event) {
    drawOverlay(event.target);
  }

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const selector = buildSelector(event.target);
    extApi.runtime.sendMessage({ type: "LOCATOR_PICKED", targetField, selector });
    cleanup(false);
  }

  function onKey(event) {
    if (event.key === "Escape") cleanup(true);
  }

  function start(field) {
    targetField = field || "source";
    const label = targetField === "target" || targetField === "input" ? "target input/result field" : "source field";
    showBanner(`Pick ${label}`);
    document.addEventListener("mouseover", onHover, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  extApi.runtime.onMessage.addListener((msg) => {
    if (msg.type === "PICK_ELEMENT") start(msg.targetField);
  });
})();
