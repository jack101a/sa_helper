"""Exam solver service — Hash → OCR → LLM pipeline (server-side)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

logger = logging.getLogger(__name__)

# Try importing pytesseract; gracefully degrade if Tesseract not installed
try:
    import pytesseract
    _TESSERACT_AVAILABLE = True
except ImportError:
    _TESSERACT_AVAILABLE = False
    logger.warning("pytesseract not installed — OCR layer disabled")


def _phash(img: Image.Image, size: int = 32) -> str:
    """Perceptual hash (DCT-style): resize → grayscale → flatten → above-mean."""
    gray = img.convert("L").resize((size, size), Image.LANCZOS)
    pixels = list(gray.getdata())
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= avg else "0" for p in pixels)
    # Pack bits into hex string
    n = int(bits, 2)
    return hex(n)[2:].zfill(size * size // 4)


def _b64_to_pil(b64: str) -> Image.Image:
    """Decode base64 data-URI or raw base64 to PIL Image."""
    raw = b64
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    binary = base64.b64decode(raw)
    return Image.open(BytesIO(binary)).convert("RGB")


def _hamming(a: str, b: str) -> int:
    """Hamming distance between two same-length hex hash strings."""
    if len(a) != len(b):
        return 9999
    na, nb = int(a, 16), int(b, 16)
    diff = na ^ nb
    return bin(diff).count("1")


class ExamService:
    """
    Three-layer exam question solver:
      1. Perceptual hash match against known sign database
      2. Tesseract OCR → text match against question bank
      3. LiteLLM multimodal fallback

    All heavy processing is server-side.
    The extension only sends base64 images and receives an option number.
    """

    HASH_THRESHOLD = 15  # bits — below this is a confident sign match

    def __init__(self, settings_exam: Any, data_dir: Path) -> None:
        self._cfg = settings_exam
        self._data_dir = data_dir

        # Load question bank
        q_path = Path(settings_exam.question_data_path)
        self._questions: list[dict] = []
        if q_path.exists():
            with q_path.open(encoding="utf-8") as f:
                self._questions = json.load(f)
            logger.info("exam_db_loaded", extra={"context": {"count": len(self._questions)}})

        # Load sign hashes
        sh_path = Path(settings_exam.sign_hashes_path)
        self._sign_hashes: dict[str, str] = {}  # hash_hex → label
        if sh_path.exists():
            with sh_path.open(encoding="utf-8") as f:
                raw = json.load(f)
            # Support both {label: hash} and {hash: label} formats
            if raw:
                first_val = next(iter(raw.values()))
                if len(first_val) > 20:
                    # Values are hashes → invert
                    self._sign_hashes = {v: k for k, v in raw.items()}
                else:
                    self._sign_hashes = raw
            logger.info("sign_hashes_loaded", extra={"context": {"count": len(self._sign_hashes)}})

        # Load sign labels for option matching
        sl_path = Path(settings_exam.sign_labels_path)
        self._sign_labels: dict[str, str] = {}  # label → description
        if sl_path.exists():
            with sl_path.open(encoding="utf-8") as f:
                self._sign_labels = json.load(f)

        self._http = httpx.AsyncClient(timeout=30.0)

    # ── Layer 1: Perceptual Hash ─────────────────────────────────────────────

    def _match_sign_hash(self, img: Image.Image) -> str | None:
        """Return sign label if image hash is close to a known sign."""
        img_hash = _phash(img)
        best_dist = self.HASH_THRESHOLD + 1
        best_label: str | None = None
        for stored_hash, label in self._sign_hashes.items():
            try:
                d = _hamming(img_hash, stored_hash)
                if d < best_dist:
                    best_dist = d
                    best_label = label
            except Exception:
                continue
        return best_label if best_dist <= self.HASH_THRESHOLD else None

    # ── Layer 2: OCR → DB Lookup ─────────────────────────────────────────────

    def _ocr_text(self, img: Image.Image) -> str:
        """Run Tesseract on a PIL image and return stripped text."""
        if not _TESSERACT_AVAILABLE:
            return ""
        try:
            lang = self._cfg.ocr_lang or "eng"
            text = pytesseract.image_to_string(img, lang=lang, config="--psm 6")
            return text.strip()
        except Exception as e:
            logger.warning("ocr_failed", extra={"context": {"error": str(e)}})
            return ""

    def _db_lookup(self, question_text: str) -> dict | None:
        """Fuzzy keyword match against question bank."""
        if not question_text or not self._questions:
            return None
        q_lower = question_text.lower()
        best: dict | None = None
        best_score = 0
        for entry in self._questions:
            entry_q = str(entry.get("question", "")).lower()
            if not entry_q:
                continue
            # Count overlapping words
            words = set(q_lower.split())
            entry_words = set(entry_q.split())
            score = len(words & entry_words)
            if score > best_score and score >= 3:
                best_score = score
                best = entry
        return best

    def _sign_to_option(self, sign_label: str, option_images: list[str]) -> int | None:
        """Given a sign label, OCR each option image and find which one matches."""
        description = self._sign_labels.get(sign_label, "").lower()
        if not description:
            return None
        for i, opt_b64 in enumerate(option_images, start=1):
            try:
                img = _b64_to_pil(opt_b64)
                text = self._ocr_text(img).lower()
                if not text:
                    continue
                # Simple overlap check
                words = set(description.split())
                opt_words = set(text.split())
                if len(words & opt_words) >= 2:
                    return i
            except Exception:
                continue
        return None

    # ── Layer 3: LLM Fallback ─────────────────────────────────────────────────

    async def _llm_solve(self, question_b64: str, option_b64s: list[str]) -> int | None:
        """Send question + options to LiteLLM multimodal endpoint."""
        endpoint = self._cfg.litellm_endpoint
        if not endpoint:
            return None
        try:
            # Build content blocks
            content = [
                {"type": "text", "text": (
                    "You are an expert road safety exam assistant. "
                    "Look at the question image and 4 option images below. "
                    "Reply with ONLY the correct option number (1, 2, 3, or 4). No other text."
                )},
                {"type": "image_url", "image_url": {"url": question_b64}},
            ]
            for idx, opt in enumerate(option_b64s, start=1):
                content.append({"type": "text", "text": f"Option {idx}:"})
                content.append({"type": "image_url", "image_url": {"url": opt}})

            resp = await self._http.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {self._cfg.litellm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._cfg.litellm_model,
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 5,
                },
            )
            resp.raise_for_status()
            answer = resp.json()["choices"][0]["message"]["content"].strip()
            # Extract first digit
            digit = next((c for c in answer if c in "1234"), None)
            return int(digit) if digit else None
        except Exception as e:
            logger.warning("llm_fallback_failed", extra={"context": {"error": str(e)}})
            return None

    # ── Public Entry Point ────────────────────────────────────────────────────

    async def solve(
        self,
        question_b64: str,
        option_b64s: list[str],
        domain: str | None = None,
    ) -> dict[str, Any]:
        """
        Full pipeline. Returns:
          { option_number: int, answer_text: str, method: str, processing_ms: int }
        """
        started = time.perf_counter()

        try:
            q_img = _b64_to_pil(question_b64)
        except Exception as e:
            return {"error": f"Invalid question image: {e}", "option_number": None, "method": "error", "processing_ms": 0}

        # Layer 1 — Hash
        sign_label = self._match_sign_hash(q_img)
        if sign_label:
            opt_num = self._sign_to_option(sign_label, option_b64s)
            if opt_num:
                ms = int((time.perf_counter() - started) * 1000)
                logger.info("exam_solved_hash", extra={"context": {"sign": sign_label, "option": opt_num}})
                return {
                    "option_number": opt_num,
                    "answer_text": self._sign_labels.get(sign_label, sign_label),
                    "method": "hash",
                    "processing_ms": ms,
                }

        # Layer 2 — OCR + DB
        question_text = self._ocr_text(q_img)
        match = self._db_lookup(question_text)
        if match and match.get("correct_option"):
            ms = int((time.perf_counter() - started) * 1000)
            opt_num = int(match["correct_option"])
            answer = match.get(f"option_{opt_num}", f"Option {opt_num}")
            logger.info("exam_solved_ocr_db", extra={"context": {"option": opt_num, "ms": ms}})
            return {
                "option_number": opt_num,
                "answer_text": answer,
                "method": "ocr_db",
                "processing_ms": ms,
            }

        # Layer 3 — LLM
        opt_num = await self._llm_solve(question_b64, option_b64s)
        ms = int((time.perf_counter() - started) * 1000)
        if opt_num:
            logger.info("exam_solved_llm", extra={"context": {"option": opt_num, "ms": ms}})
            return {
                "option_number": opt_num,
                "answer_text": f"Option {opt_num} (AI)",
                "method": "llm",
                "processing_ms": ms,
            }

        ms = int((time.perf_counter() - started) * 1000)
        logger.warning("exam_no_match", extra={"context": {"question_text": question_text[:80]}})
        return {"option_number": None, "answer_text": None, "method": "none", "processing_ms": ms}
