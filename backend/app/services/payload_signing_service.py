from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from app.core.paths import get_project_root


_KEY_DIR = get_project_root() / "data" / "security"
_DEV_PRIVATE_KEY_PATH = _KEY_DIR / "payload_signing_private.pem"
_PUBLIC_KEY_PATH = _KEY_DIR / "payload_signing_public.spki.b64"
_DEFAULT_SECRET_PRIVATE_KEY_PATH = Path("/run/secrets/payload_signing_private.pem")
_SIGNER_TIMEOUT_SECONDS = float(os.getenv("PAYLOAD_SIGNER_TIMEOUT_SECONDS", "3") or "3")

_SENSITIVE_HOST_SUFFIXES = (
    ".bank.in",
    ".paypal.com",
    ".stripe.com",
    ".razorpay.com",
    ".paytm.com",
    ".phonepe.com",
    ".hdfcbank.com",
    ".icicibank.com",
    ".axisbank.com",
    ".kotak.com",
    ".onlinesbi.sbi",
)
_SENSITIVE_HOSTS = {
    "bank.in",
    "paypal.com",
    "stripe.com",
    "razorpay.com",
    "paytm.com",
    "phonepe.com",
    "hdfcbank.com",
    "icicibank.com",
    "axisbank.com",
    "kotak.com",
    "onlinesbi.sbi",
}


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _signer_url() -> str:
    return os.getenv("PAYLOAD_SIGNER_URL", "").strip().rstrip("/")


def _signer_token() -> str:
    return os.getenv("PAYLOAD_SIGNER_TOKEN", "").strip()


def _private_key_path() -> tuple[Path, bool]:
    """Return private key path and whether missing keys may be generated there."""
    configured = os.getenv("PAYLOAD_SIGNING_PRIVATE_KEY_PATH", "").strip()
    if configured:
        allow_create = os.getenv("PAYLOAD_SIGNING_ALLOW_CREATE", "").strip().lower() in {"1", "true", "yes", "on"}
        return Path(configured), allow_create
    if _DEFAULT_SECRET_PRIVATE_KEY_PATH.exists():
        return _DEFAULT_SECRET_PRIVATE_KEY_PATH, False
    return _DEV_PRIVATE_KEY_PATH, True


def _load_or_create_private_key():
    private_key_path, allow_create = _private_key_path()
    if private_key_path.exists():
        return serialization.load_pem_private_key(private_key_path.read_bytes(), password=None)
    if not allow_create:
        raise RuntimeError(f"Payload signing private key not found: {private_key_path}")
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_key_path.parent.mkdir(parents=True, exist_ok=True)
    private_key_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    private_key_path.chmod(0o600)
    return private_key


def _remote_json(path: str, payload: Any | None = None) -> dict:
    url = _signer_url()
    if not url:
        raise RuntimeError("PAYLOAD_SIGNER_URL is not configured")
    body = None if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    token = _signer_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{url}{path}", data=body, headers=headers, method="POST" if body is not None else "GET")
    last_error: Exception | None = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(request, timeout=_SIGNER_TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            time.sleep(0.2)
    raise RuntimeError(f"Payload signer request failed: {last_error}")


def ensure_public_key_b64_local() -> str:
    private_key = _load_or_create_private_key()
    public_b64 = base64.b64encode(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    ).decode("ascii")
    if not _PUBLIC_KEY_PATH.exists() or _PUBLIC_KEY_PATH.read_text(encoding="utf-8").strip() != public_b64:
        _PUBLIC_KEY_PATH.write_text(public_b64 + "\n", encoding="utf-8")
    return public_b64


def ensure_public_key_b64() -> str:
    configured_public_key = os.getenv("PAYLOAD_SIGNING_PUBLIC_KEY_B64", "").strip()
    if configured_public_key:
        return configured_public_key
    if _signer_url():
        data = _remote_json("/public-key")
        public_b64 = str(data.get("public_key_b64") or "").strip()
        if not public_b64:
            raise RuntimeError("Payload signer did not return public_key_b64")
        return public_b64
    return ensure_public_key_b64_local()


def _host_from_match(pattern: str) -> str:
    text = str(pattern or "").strip().lower()
    if not text or text == "<all_urls>":
        return ""
    if "://" in text:
        text = text.split("://", 1)[1]
    host = text.split("/", 1)[0].split(":", 1)[0].strip()
    return host[2:] if host.startswith("*.") else host


def _is_sensitive_match(pattern: str) -> bool:
    host = _host_from_match(pattern)
    if not host:
        return False
    if host in _SENSITIVE_HOSTS or "netbanking" in host:
        return True
    return any(host.endswith(suffix) for suffix in _SENSITIVE_HOST_SUFFIXES)


def validate_signable_payload(kind: str, payload: Any) -> None:
    """Policy check before executable payloads are signed."""
    if kind == "stall_payload":
        if not isinstance(payload, dict) or str(payload.get("step_id") or "") not in {"step3", "step4", "stall-flow"}:
            raise ValueError("Invalid STALL payload signing request")
        return

    if kind != "userscript":
        raise ValueError(f"Unsupported payload signing kind: {kind}")
    if not isinstance(payload, dict):
        raise ValueError("Invalid userscript signing request")
    code = str(payload.get("code") or "")
    if not code.strip():
        raise ValueError("Userscript code is empty")
    patterns = []
    for key in ("matches", "includes"):
        values = payload.get(key)
        if isinstance(values, list):
            patterns.extend(str(item) for item in values)
    if any(_is_sensitive_match(pattern) for pattern in patterns):
        raise ValueError("Userscript targets a blocked financial/payment host")


def sign_payload_local(kind: str, payload: Any) -> dict[str, str]:
    validate_signable_payload(kind, payload)
    private_key = _load_or_create_private_key()
    ensure_public_key_b64_local()
    envelope = {"kind": str(kind), "payload": payload}
    der_signature = private_key.sign(canonical_json(envelope), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_signature)
    signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return {
        "alg": "ECDSA-P256-SHA256",
        "kid": "payload-signing-v1",
        "kind": str(kind),
        "signature": base64.b64encode(signature).decode("ascii"),
    }


def sign_payload(kind: str, payload: Any) -> dict[str, str]:
    validate_signable_payload(kind, payload)
    if _signer_url():
        data = _remote_json("/sign", {"kind": str(kind), "payload": payload})
        signature = data.get("signature") if isinstance(data, dict) else None
        if not isinstance(signature, dict):
            raise RuntimeError("Payload signer did not return a signature")
        return signature
    return sign_payload_local(kind, payload)
