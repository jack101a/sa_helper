"""WhatsApp alert service via CallMeBot (free, no account needed)."""

from __future__ import annotations

import logging
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)


class AlertService:
    """
    Sends WhatsApp messages to admin via CallMeBot API.

    Setup (one-time per admin phone):
      1. Add +34 644 59 72 16 to your contacts as "CallMeBot"
      2. Send: "I allow callmebot to send me messages" on WhatsApp
      3. You'll receive your personal apikey
      4. Set CALLMEBOT_PHONE and CALLMEBOT_APIKEY in .env

    API reference: https://www.callmebot.com/blog/free-api-whatsapp-messages/
    """

    _BASE = "https://api.callmebot.com/whatsapp.php"

    def __init__(self, phone: str, apikey: str, enabled: bool = False) -> None:
        self._phone   = phone.strip()
        self._apikey  = apikey.strip()
        self._enabled = enabled and bool(self._phone) and bool(self._apikey)

    def send(self, message: str) -> bool:
        """Send a WhatsApp message. Returns True on success."""
        if not self._enabled:
            return False
        try:
            params = urllib.parse.urlencode({
                "phone":   self._phone,
                "text":    message[:1000],
                "apikey":  self._apikey,
            })
            url = f"{self._BASE}?{params}"
            req = urllib.request.Request(url, headers={"User-Agent": "unified-platform/2.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                ok = resp.status == 200
                if ok:
                    logger.info("whatsapp_alert_sent", extra={"context": {"msg_preview": message[:60]}})
                return ok
        except Exception as e:
            logger.warning("whatsapp_alert_failed", extra={"context": {"error": str(e)}})
            return False

    # ── Preset messages ────────────────────────────────────────────────────────

    def notify_new_key(self, key_name: str, expires_at: str | None) -> None:
        exp = expires_at or "Never"
        self.send(f"🔑 *New API Key Created*\nName: {key_name}\nExpires: {exp}\n\nCheck admin dashboard to review.")

    def notify_key_revoked(self, key_name: str) -> None:
        self.send(f"🚫 *API Key Revoked*\nName: {key_name}")

    def notify_exam_pass(self, domain: str) -> None:
        self.send(f"🎉 *Exam Passed!*\nDomain: {domain}\nResult screenshot captured.")

    def notify_server_start(self) -> None:
        self.send("✅ *Unified Platform started*\nAll services online.")
