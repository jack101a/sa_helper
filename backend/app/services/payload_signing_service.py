from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from app.core.paths import get_project_root


_KEY_DIR = get_project_root() / "data" / "security"
_PRIVATE_KEY_PATH = _KEY_DIR / "payload_signing_private.pem"
_PUBLIC_KEY_PATH = _KEY_DIR / "payload_signing_public.spki.b64"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _load_or_create_private_key():
    _KEY_DIR.mkdir(parents=True, exist_ok=True)
    if _PRIVATE_KEY_PATH.exists():
        return serialization.load_pem_private_key(_PRIVATE_KEY_PATH.read_bytes(), password=None)
    private_key = ec.generate_private_key(ec.SECP256R1())
    _PRIVATE_KEY_PATH.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    _PRIVATE_KEY_PATH.chmod(0o600)
    return private_key


def ensure_public_key_b64() -> str:
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


def sign_payload(kind: str, payload: Any) -> dict[str, str]:
    private_key = _load_or_create_private_key()
    ensure_public_key_b64()
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
