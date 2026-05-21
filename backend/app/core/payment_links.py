"""Signed HTTPS payment-link helpers for Telegram-safe UPI handoff."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time


def build_upi_link(upi_id: str, name: str, amount: float, note: str = "", currency: str = "INR") -> str:
    amt = f"{amount:.2f}"
    link = f"upi://pay?pa={upi_id}&pn={name}&am={amt}&cu={currency}"
    if note:
        link += f"&tn={note}"
    return link


def _secret() -> bytes:
    raw = (
        os.getenv("PAYMENT_LINK_SECRET", "").strip()
        or os.getenv("AUTH_HASH_SALT", "").strip()
        or os.getenv("ADMIN_TOKEN", "").strip()
        or "change-me-payment-link-secret"
    )
    return raw.encode("utf-8")


def _b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64u_decode(data: str) -> bytes:
    pad = "=" * ((4 - (len(data) % 4)) % 4)
    return base64.urlsafe_b64decode((data + pad).encode("ascii"))


def encode_upi_payload(
    *,
    upi_id: str,
    payee_name: str,
    amount: float,
    note: str,
    currency: str = "INR",
    ttl_seconds: int = 1800,
) -> str:
    payload = {
        "pa": upi_id,
        "pn": payee_name,
        "am": f"{amount:.2f}",
        "tn": note,
        "cu": currency or "INR",
        "exp": int(time.time()) + max(60, int(ttl_seconds)),
    }
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    body_b64 = _b64u_encode(body)
    sig = hmac.new(_secret(), body_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{body_b64}.{_b64u_encode(sig)}"


def decode_upi_payload(token: str) -> dict | None:
    try:
        body_b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(_secret(), body_b64.encode("ascii"), hashlib.sha256).digest()
        got_sig = _b64u_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, got_sig):
            return None

        payload = json.loads(_b64u_decode(body_b64).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None

        required = {"pa", "pn", "am", "cu"}
        if not required.issubset(payload.keys()):
            return None
        return payload
    except Exception:
        return None
