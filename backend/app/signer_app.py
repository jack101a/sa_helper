from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException

from app.services.payload_signing_service import ensure_public_key_b64_local, sign_payload_local


app = FastAPI(
    title="SA Helper Payload Signer",
    description="Small signing service for extension executable payloads.",
    version="1.0.0",
)


def _require_signer_auth(authorization: str = Header(default="")) -> None:
    token = os.getenv("PAYLOAD_SIGNER_TOKEN", "").strip()
    if not token:
        if os.getenv("APP_ENV", "").strip().lower() == "production":
            raise HTTPException(status_code=503, detail="PAYLOAD_SIGNER_TOKEN is required in production")
        return
    expected = f"Bearer {token}"
    if not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="signer_auth_required")


@app.get("/health")
async def health() -> dict[str, str]:
    if os.getenv("APP_ENV", "").strip().lower() == "production" and not os.getenv("PAYLOAD_SIGNER_TOKEN", "").strip():
        raise HTTPException(status_code=503, detail="PAYLOAD_SIGNER_TOKEN is required in production")
    return {"status": "ok", "service": "payload-signer"}


@app.get("/public-key")
async def public_key(authorization: str = Header(default="")) -> dict[str, str]:
    _require_signer_auth(authorization)
    return {"public_key_b64": ensure_public_key_b64_local()}


@app.post("/sign")
async def sign(body: dict[str, Any], authorization: str = Header(default="")) -> dict[str, dict[str, str]]:
    _require_signer_auth(authorization)
    kind = str(body.get("kind") or "")
    payload = body.get("payload")
    try:
        return {"signature": sign_payload_local(kind, payload)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
