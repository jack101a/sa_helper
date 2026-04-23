"""WhatsApp alert service via CallMeBot — config read from DB (admin dashboard)."""

from __future__ import annotations

import logging
import urllib.parse
import urllib.request
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.database import Database

logger = logging.getLogger(__name__)


class AlertService:
    """
    Sends WhatsApp messages to admin via CallMeBot API.
    All config (phone, apikey, enabled) is read from the platform_settings
    DB table on every send call — changeable from the admin dashboard
    without restarting the server.

    Setup (one-time per admin phone):
      1. Add +34 644 59 72 16 to contacts as "CallMeBot"
      2. Send "I allow callmebot to send me messages" on WhatsApp
      3. You'll receive your personal apikey
      4. Set in admin dashboard: alerts.callmebot_phone, alerts.callmebot_apikey
         and set alerts.whatsapp_enabled = true
    """

    _BASE = "https://api.callmebot.com/whatsapp.php"

    def __init__(self, db: "Database") -> None:
        self._db = db

    # ── Read settings from DB on every call ───────────────────────────────────

    def _enabled(self) -> bool:
        v = self._db.get_setting("alerts.whatsapp_enabled", "false")
        return v.lower() in {"1", "true", "yes"}

    def _phone(self) -> str:
        return self._db.get_setting("alerts.callmebot_phone", "").strip()

    def _apikey(self) -> str:
        return self._db.get_setting("alerts.callmebot_apikey", "").strip()

    # ── Core send ─────────────────────────────────────────────────────────────

    def send(self, message: str) -> bool:
        """Send a WhatsApp message. Returns True on success."""
        if not self._enabled():
            return False
        phone  = self._phone()
        apikey = self._apikey()
        if not phone or not apikey:
            logger.warning("whatsapp_alert_skipped: phone or apikey not set in admin settings")
            return False
        try:
            params = urllib.parse.urlencode({
                "phone":  phone,
                "text":   message[:1000],
                "apikey": apikey,
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
        self.send(f"🔑 *New API Key Created*\nName: {key_name}\nExpires: {exp}\n\nCheck admin dashboard.")

    def notify_key_revoked(self, key_name: str) -> None:
        self.send(f"🚫 *API Key Revoked*\nName: {key_name}")

    def notify_exam_pass(self, domain: str) -> None:
        self.send(f"🎉 *Exam Passed!*\nDomain: {domain}\nResult screenshot captured.")

    def notify_server_start(self) -> None:
        self.send("✅ *Unified Platform started*\nAll services online.")
