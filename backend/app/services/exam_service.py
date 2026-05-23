"""Exam solver service — Hash → OCR → LLM pipeline (server-side).

All heavy processing is server-side. The extension only sends base64 images.
Runtime config (LiteLLM endpoint/key/model, OCR lang) is read from the
platform_settings DB table — configurable from the admin dashboard.
"""

from __future__ import annotations

import base64
import concurrent.futures
import hashlib
import json
import logging
import os
import shutil
import threading
import time
from io import BytesIO
from pathlib import Path
from typing import Any, TYPE_CHECKING

import httpx
import numpy as np
from PIL import Image

if TYPE_CHECKING:
    from app.core.database import Database

logger = logging.getLogger(__name__)

_SOLVER_METHOD_DEFAULTS: list[dict[str, Any]] = [
    {"id": "auto_learned_bank", "enabled": True, "priority": 10},
    {"id": "ocr_db", "enabled": True, "priority": 20},
    {"id": "llm", "enabled": True, "priority": 30},
    {"id": "random_fallback", "enabled": True, "priority": 40},
]
_SOLVER_METHOD_IDS = {item["id"] for item in _SOLVER_METHOD_DEFAULTS}
_LEGACY_SOLVER_GROUPS: dict[str, tuple[str, ...]] = {
    "auto_learned_bank": ("learned_exact_hash", "learned_phash", "learned_text_identity"),
    "ocr_db": ("ocr_db",),
    "llm": ("llm",),
    "random_fallback": ("random_fallback",),
}
_LEGACY_ONLY_SOLVER_IDS = {
    "sign_hash_db",
    "sign_hash_label",
    "learned_exact_hash",
    "learned_phash",
    "learned_text_identity",
}

# Try importing pytesseract; gracefully degrade if Tesseract binary is not installed.
try:
    import pytesseract

    def _configure_tesseract() -> tuple[bool, str]:
        candidates = [
            os.environ.get("TESSERACT_CMD", ""),
            shutil.which("tesseract") or "",
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Tesseract-OCR", "tesseract.exe"),
        ]
        for path in candidates:
            if not path:
                continue
            if os.path.exists(path) or path == "tesseract":
                pytesseract.pytesseract.tesseract_cmd = path
                try:
                    version = pytesseract.get_tesseract_version()
                    logger.info("tesseract_ready", extra={"context": {"cmd": path, "version": str(version)}})
                    return True, path
                except Exception as e:
                    logger.warning("tesseract_probe_failed", extra={"context": {"cmd": path, "error": str(e)}})
        return False, ""

    _TESSERACT_AVAILABLE, _TESSERACT_CMD = _configure_tesseract()
    if not _TESSERACT_AVAILABLE:
        logger.warning("tesseract binary not found — OCR layer disabled")
except ImportError:
    _TESSERACT_AVAILABLE = False
    _TESSERACT_CMD = ""
    logger.warning("pytesseract not installed — OCR layer disabled")


def _resolve_project_root() -> Path:
    """Resolve project root (where .env and backend/ reside)."""
    return Path(__file__).resolve().parents[3]


def _djb2_hash(img: Image.Image, size: int = 32) -> str:
    """DJB2-style hash matching the legacy extension logic."""
    # Resize to match exactly what the extension did
    thumb = img.resize((size, size), Image.LANCZOS).convert("RGB")
    data = list(thumb.getdata())
    h = 0
    for r, g, b in data:
        # bitwise simulation of (hash << 5) - hash + r + g + b
        h = ((h << 5) - h + r + g + b) & 0xFFFFFFFF
    
    # Force to signed 32-bit then absolute hex (Math.abs(hash).toString(16))
    if h > 0x7FFFFFFF:
        h -= 0x100000000
    return hex(abs(h))[2:]


def _b64_to_pil(b64: str) -> Image.Image:
    """Decode base64 data-URI or raw base64 to PIL Image."""
    raw = b64
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    if len(raw) > 5 * 1024 * 1024:
        raise ValueError("Image payload too large (max 5MB)")
    binary = base64.b64decode(raw)
    img = Image.open(BytesIO(binary))
    if img.width > 4000 or img.height > 4000:
        raise ValueError(f"Image too large: {img.width}x{img.height} (max 4000x4000)")
    return img.convert("RGB")


def _hamming(a: str, b: str) -> int:
    """Hamming distance between two same-length hex hash strings."""
    if len(a) != len(b):
        return 9999
    na, nb = int(a, 16), int(b, 16)
    diff = na ^ nb
    return bin(diff).count("1")


def _dct_2d(block: "np.ndarray") -> "np.ndarray":
    """2D Discrete Cosine Transform (Type-II) using numpy."""
    N = block.shape[0]
    n = np.arange(N)
    k = n.reshape((N, 1))
    # DCT basis: cos(pi * k * (2*n + 1) / (2*N))
    basis = np.cos(np.pi * k * (2 * n + 1) / (2 * N))
    return basis @ block @ basis.T


def _phash(img: Image.Image, hash_size: int = 8, highfreq_factor: int = 4) -> str:
    """
    Perceptual hash (pHash) using DCT.
    Robust to resizing, compression, and minor image differences.
    
    Returns 64-bit hex string (hash_size=8 → 64 bits).
    """
    # Resize to hash_size * highfreq_factor (32x32 for default)
    img_size = hash_size * highfreq_factor
    img_gray = img.convert("L").resize((img_size, img_size), Image.LANCZOS)
    pixels = np.array(img_gray, dtype=np.float64)
    
    # 2D DCT
    dct = _dct_2d(pixels)
    
    # Extract top-left hash_size x hash_size (low frequencies)
    dct_low = dct[:hash_size, :hash_size]
    
    # Median threshold
    median = np.median(dct_low)
    bits = (dct_low > median).flatten()
    
    # Convert to hex
    hash_bytes = np.packbits(bits.astype(np.uint8))
    return hash_bytes.tobytes().hex()[:hash_size * hash_size // 4]  # 64 bits = 16 hex chars


def _phash_hamming_match(query_hash: str, known_hashes: dict[str, str], threshold: int = 10) -> str | None:
    """
    Find the best-matching known hash via Hamming distance.
    Returns the label if distance ≤ threshold, else None.
    """
    best_label = None
    best_dist = threshold + 1
    for known_hash, label in known_hashes.items():
        dist = _hamming(query_hash, known_hash)
        if dist < best_dist:
            best_dist = dist
            best_label = label
    return best_label if best_dist <= threshold else None




class ExamService:
    """
    Three-layer exam question solver:
      1. Perceptual hash match against known sign database
      2. Tesseract OCR → text match against question bank
      3. LiteLLM multimodal fallback

    Runtime config (endpoint, key, model, OCR lang) is read from the
    platform_settings DB table on every solve call — no restart needed.
    """

    HASH_THRESHOLD = 15  # bits — below this is a confident sign match

    def __init__(self, db: "Database", data_dir: Path) -> None:
        self._db       = db
        self._data_dir = data_dir
        self._http     = httpx.AsyncClient(timeout=30.0)
        self._ocr_semaphore = threading.BoundedSemaphore(self._ocr_concurrency())
        self._sign_lock = threading.Lock()

        self.reload_static_data()

        # Reusable thread pool for OCR (created once, not per request)
        self._ocr_pool = concurrent.futures.ThreadPoolExecutor(max_workers=5)
        # In-memory learned question index (replaces SQL queries in solve)
        # Keyed by question_hash and question_phash for O(1) and O(n) lookup
        self._learned_by_hash: dict[str, dict] = {}
        self._learned_by_phash: dict[str, dict] = {}
        self._reload_learned_index()

    async def close(self) -> None:
        self._ocr_pool.shutdown(wait=False)
        await self._http.aclose()

    def reload_static_data(self) -> dict[str, int]:
        """Reload static question and sign hash files after system restore."""
        q_path = self._data_dir / "questions" / "questions.json"
        self._questions: list[dict] = []
        if q_path.exists():
            with q_path.open(encoding="utf-8") as f:
                self._questions = json.load(f)
            logger.info("exam_db_loaded", extra={"context": {"count": len(self._questions)}})

        sh_path = self._data_dir / "hashes" / "sign_hashes.json"
        self._sign_hashes: dict[str, str] = {}  # hash_hex → label
        if sh_path.exists():
            with sh_path.open(encoding="utf-8") as f:
                raw = json.load(f)
            if raw:
                # Ensure we have { hash: label }
                first_key, first_val = next(iter(raw.items()))
                # If key is long (>20) and value is short, it's likely { label: hash } -> invert
                if len(first_key) > 20 and len(first_val) <= 12:
                    self._sign_hashes = {v: k for k, v in raw.items()}
                else:
                    self._sign_hashes = raw
            logger.info("sign_hashes_loaded", extra={"context": {"count": len(self._sign_hashes)}})

        sl_path = self._data_dir / "hashes" / "sign_label.json"
        self._sign_labels: dict[str, str] = {}
        if sl_path.exists():
            with sl_path.open(encoding="utf-8") as f:
                self._sign_labels = json.load(f)

        # Load perceptual hashes (pHash) for fuzzy sign matching
        ph_path = self._data_dir / "hashes" / "sign_hashes_perceptual.json"
        self._sign_phash: dict[str, str] = {}  # phash_hex → label
        if ph_path.exists():
            with ph_path.open(encoding="utf-8") as f:
                self._sign_phash = json.load(f)
            logger.info("sign_phash_loaded", extra={"context": {"count": len(self._sign_phash)}})

        return {
            "questions": len(self._questions),
            "sign_hashes": len(self._sign_hashes),
            "sign_labels": len(self._sign_labels),
            "sign_phashes": len(self._sign_phash),
        }

    def _reload_learned_index(self) -> None:
        """Load all non-rejected learned questions into memory for fast solve lookup."""
        try:
            rows = self._db.exam_learned.get_all_learned(min_confidence=0.0)
            by_hash: dict[str, dict] = {}
            by_phash: dict[str, dict] = {}
            for row in rows:
                if row.get("status") == "rejected":
                    continue
                h = row.get("question_hash", "")
                p = row.get("question_phash", "")
                if h:
                    by_hash[h] = row
                if p:
                    by_phash[p] = row
            self._learned_by_hash = by_hash
            self._learned_by_phash = by_phash
            logger.info("learned_index_loaded", extra={"context": {
                "hash_count": len(by_hash),
                "phash_count": len(by_phash),
            }})
        except Exception as e:
            logger.error("learned_index_load_failed", extra={"context": {"error": str(e)}})

    def _inmemory_get_by_hash(
        self,
        question_hash: str,
        min_confidence: float,
        min_verified: int,
    ) -> dict | None:
        """In-memory equivalent of exam_learned.get_by_hash()."""
        item = self._learned_by_hash.get(question_hash)
        if not item:
            return None
        if (
            item.get("status") == "verified"
            and float(item.get("confidence") or 0) >= min_confidence
            and int(item.get("verified_count") or 0) >= min_verified
            and int(item.get("wrong_count") or 0) == 0
        ):
            return item
        return None

    def _inmemory_get_candidate_by_hash(self, question_hash: str) -> dict | None:
        """In-memory equivalent of exam_learned.get_candidate_by_hash()."""
        item = self._learned_by_hash.get(question_hash)
        if item and item.get("status") != "rejected":
            return item
        return None

    def _inmemory_get_by_phash(
        self,
        question_phash: str,
        max_distance: int,
        min_confidence: float,
        min_verified: int,
    ) -> dict | None:
        """In-memory pHash fuzzy match — replaces full table scan."""
        if not question_phash:
            return None
        best: dict | None = None
        best_distance = max_distance + 1
        for phash, item in self._learned_by_phash.items():
            if item.get("status") != "verified":
                continue
            if float(item.get("confidence") or 0) < min_confidence:
                continue
            if int(item.get("verified_count") or 0) < min_verified:
                continue
            if int(item.get("wrong_count") or 0) != 0:
                continue
            dist = _hamming(question_phash, phash)
            if dist < best_distance:
                best = item
                best_distance = dist
        if best and best_distance <= max_distance:
            best = dict(best)  # copy to avoid mutating index
            best["_phash_distance"] = best_distance
            return best
        return None

    def _inmemory_get_candidate_by_phash(
        self,
        question_phash: str,
        max_distance: int,
    ) -> dict | None:
        """In-memory pHash candidate lookup — replaces full table scan."""
        if not question_phash:
            return None
        best: dict | None = None
        best_distance = max_distance + 1
        for phash, item in self._learned_by_phash.items():
            if item.get("status") == "rejected":
                continue
            dist = _hamming(question_phash, phash)
            if dist < best_distance:
                best = item
                best_distance = dist
        if best and best_distance <= max_distance:
            best = dict(best)
            best["_phash_distance"] = best_distance
            return best
        return None

    def export_learned_to_json(self) -> int:
        """Export exam_learned SQLite table to questions_learned.json. Returns count."""
        try:
            entries = self._db.export_exam_learned_json()
            learned_path = self._data_dir / "questions" / "questions_learned.json"
            learned_path.parent.mkdir(parents=True, exist_ok=True)
            with learned_path.open("w", encoding="utf-8") as f:
                json.dump(entries, f, ensure_ascii=False, indent=2)
            logger.info("exam_learned_exported", extra={"context": {"count": len(entries)}})
            return len(entries)
        except Exception as e:
            logger.error("exam_learned_export_failed", extra={"context": {"error": str(e)}})
            return 0

    # ── Runtime settings (from admin dashboard DB) ────────────────────────────

    def _litellm_endpoint(self) -> str:
        return self._db.get_setting("exam.litellm_endpoint", "")

    def _litellm_api_key(self) -> str:
        return self._db.get_setting("exam.litellm_api_key", "")

    def _litellm_model(self) -> str:
        return self._db.get_setting("exam.litellm_model", "gemma-4-31b-it_gemini")

    def _ocr_lang(self) -> str:
        return self._db.get_setting("exam.ocr_lang", "eng+hin")

    def _ocr_concurrency(self) -> int:
        try:
            return max(1, int(self._db.get_setting("exam.ocr_concurrency", "2")))
        except ValueError:
            return 2

    def _learn_min_confidence(self) -> float:
        try:
            return max(0.0, min(1.0, float(self._db.get_setting("exam.learn_min_confidence", "0.95"))))
        except ValueError:
            return 0.95

    def _learn_min_confirmations(self) -> int:
        try:
            return max(1, int(self._db.get_setting("exam.learn_min_confirmations", "5")))
        except ValueError:
            return 5

    def _learn_phash_max_distance(self) -> int:
        try:
            return max(0, int(self._db.get_setting("exam.learn_phash_max_distance", "3")))
        except ValueError:
            return 3

    def _learn_option_phash_max_distance(self) -> int:
        try:
            return max(0, int(self._db.get_setting("exam.learn_option_phash_max_distance", "3")))
        except ValueError:
            return 3

    def _learning_mode(self) -> str:
        mode = str(self._db.get_setting("exam.learning_mode", "train_only") or "train_only").strip().lower()
        return mode if mode in {"train_only", "auto_click"} else "train_only"

    def _solver_methods(self) -> tuple[list[str], bool]:
        """Return enabled solver method ids in admin-configured order."""
        defaults = {item["id"]: dict(item) for item in _SOLVER_METHOD_DEFAULTS}
        try:
            raw = self._db.get_setting("exam.solver_methods_ui", "")
            parsed = json.loads(raw) if raw else []
            if not isinstance(parsed, list):
                parsed = []
        except Exception:
            parsed = []

        merged = defaults
        has_legacy_only_ids = any(
            isinstance(item, dict) and str(item.get("id") or "") in _LEGACY_ONLY_SOLVER_IDS
            for item in parsed
        )
        if has_legacy_only_ids:
            legacy: dict[str, list[dict[str, Any]]] = {group_id: [] for group_id in _SOLVER_METHOD_IDS}
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                legacy_id = str(item.get("id") or "")
                for group_id, legacy_ids in _LEGACY_SOLVER_GROUPS.items():
                    if legacy_id in legacy_ids:
                        legacy[group_id].append(item)

            for group_id, items in legacy.items():
                if not items:
                    continue
                current = merged[group_id]
                current["enabled"] = any(item.get("enabled") is True for item in items)
                priorities: list[int] = []
                for item in items:
                    try:
                        priorities.append(int(item.get("priority", current["priority"])))
                    except (TypeError, ValueError):
                        pass
                if priorities:
                    current["priority"] = min(priorities)
        else:
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                method_id = str(item.get("id") or "")
                if method_id not in _SOLVER_METHOD_IDS:
                    continue
                current = merged[method_id]
                if isinstance(item.get("enabled"), bool):
                    current["enabled"] = item["enabled"]
                try:
                    current["priority"] = int(item.get("priority", current["priority"]))
                except (TypeError, ValueError):
                    pass

        ordered = sorted(merged.values(), key=lambda item: (int(item["priority"]), str(item["id"])))
        enabled = [str(item["id"]) for item in ordered if item.get("enabled") and item["id"] != "random_fallback"]
        allow_random_fallback = bool(merged.get("random_fallback", {}).get("enabled", True))
        return enabled, allow_random_fallback

    def _tessdata_dir(self) -> str | None:
        """Return absolute path to tessdata dir if it exists, else None."""
        raw = self._db.get_setting("exam.tessdata_path", "backend/tessdata")
        if not raw:
            return None
        p = (_resolve_project_root() / raw).resolve()
        return str(p) if p.exists() else None

    def _tesseract_config(self) -> str:
        tess_dir = self._tessdata_dir()
        if tess_dir:
            return f"--psm 6 --tessdata-dir {tess_dir}"
        return "--psm 6"

    @staticmethod
    def _static_tesseract_config() -> str:
        tess_dir = (_resolve_project_root() / "backend" / "tessdata").resolve()
        if tess_dir.exists():
            return f"--psm 6 --tessdata-dir {tess_dir}"
        return "--psm 6"

    # ── Layer 1: Perceptual Hash ──────────────────────────────────────────────

    def _match_sign_hash(self, img: Image.Image) -> str | None:
        with self._sign_lock:
            # 1. Try exact DJB2 match first (fast, no false positives)
            djb2 = _djb2_hash(img)
            if djb2 in self._sign_hashes:
                label = self._sign_hashes[djb2]
                # Auto-learn: store pHash for future fuzzy matching
                phash = _phash(img)
                if phash not in self._sign_phash:
                    self._sign_phash[phash] = label
                    self._save_phash_file()
                return label

            # 2. Try perceptual hash with Hamming distance (fuzzy, robust to compression/resize)
            if self._sign_phash:
                phash = _phash(img)
                label = _phash_hamming_match(phash, self._sign_phash, threshold=self.HASH_THRESHOLD)
                if label:
                    logger.info("phash_match", extra={"context": {"label": label, "djb2": djb2[:12]}})
                    return label

            return None

    def _save_phash_file(self) -> None:
        """Persist perceptual hashes to disk."""
        try:
            ph_path = self._data_dir / "hashes" / "sign_hashes_perceptual.json"
            ph_path.parent.mkdir(parents=True, exist_ok=True)
            with ph_path.open("w", encoding="utf-8") as f:
                json.dump(self._sign_phash, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning("phash_save_failed", extra={"context": {"error": str(e)}})

    # ── Layer 2: OCR → DB Lookup ──────────────────────────────────────────────

    def _ocr_text(self, img: Image.Image) -> str:
        if not _TESSERACT_AVAILABLE:
            return ""
        try:
            lang      = self._ocr_lang()
            config    = self._tesseract_config()

            with self._ocr_semaphore:
                text = pytesseract.image_to_string(img, lang=lang, config=config)
                return text.strip()
        except Exception as e:
            logger.warning("ocr_failed", extra={"context": {"error": str(e)}})
            return ""

    @staticmethod
    def _ocr_text_static(img: Image.Image) -> str:
        """Static OCR — for use outside ExamService instance (e.g. feedback endpoint)."""
        if not _TESSERACT_AVAILABLE:
            return ""
        try:
            text = pytesseract.image_to_string(img, lang="eng+hin", config=ExamService._static_tesseract_config())
            return text.strip()
        except Exception as e:
            logger.warning("ocr_static_failed", extra={"context": {"error": str(e), "tesseract_cmd": _TESSERACT_CMD}})
            return ""

    # ─────────────────────────────────────────────────────────────────────
    # DB lookup helpers (mirrors the reference extension search logic)
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        """Normalise text for fuzzy matching — strip whitespace + punctuation."""
        import re
        t = str(text or "")
        t = re.sub(r'[\s\u200b-\u200d\ufeff\u00a0]+', '', t)
        t = re.sub(r'[\u0964\u0965।॥,.?!:;\'"()\[\]{}<>/\\|@#$%^&*~`\-_=+]', '', t)
        return t.lower()

    @staticmethod
    def _normalize_hindi(text: str) -> str:
        """Extra Hindi normalisation — drop anusvara/visarga and digits."""
        import re
        t = ExamService._clean_text(text)
        t = re.sub(r'[\u0901\u0902\u0903\u093d]', '', t)
        t = re.sub(r'\d+', '', t)
        return t

    def _search_by_question(self, ocr_text: str) -> dict | None:
        """Substring containment search on question_text field."""
        cleaned = self._clean_text(ocr_text)
        if len(cleaned) < 8:
            return None
        best: dict | None = None
        best_score = 0
        for entry in self._questions:
            db_q = self._clean_text(entry.get("question_text", ""))
            if not db_q:
                continue
            shorter = cleaned if len(cleaned) < len(db_q) else db_q
            longer  = db_q   if len(cleaned) < len(db_q) else cleaned
            if shorter in longer and len(shorter) > best_score:
                best_score = len(shorter)
                best = entry
        return best

    def _search_by_sign(self, sign_label: str) -> dict | None:
        """Exact then prefix match on question_sign_label field."""
        for entry in self._questions:
            if entry.get("question_sign_label") == sign_label:
                return entry
        for entry in self._questions:
            db_label = entry.get("question_sign_label", "")
            if db_label and (db_label.startswith(sign_label) or sign_label.startswith(db_label)):
                return entry
        return None

    def _search_by_options(self, ocr_option_texts: list[str]) -> dict | None:
        """Reverse-lookup: match DB entry whose option texts best overlap OCR'd options."""
        MIN_LEN = 4
        NEED    = 2
        cleaned_ocr = [self._clean_text(o) for o in ocr_option_texts]
        best: dict | None = None
        best_count = 0
        for entry in self._questions:
            db_opts = [
                self._clean_text(entry.get(f"option_{i}", "")) for i in range(1, 5)
            ]
            matched = 0
            for ocr_opt in cleaned_ocr:
                if len(ocr_opt) < MIN_LEN:
                    continue
                for db_opt in db_opts:
                    if len(db_opt) < MIN_LEN:
                        continue
                    s = ocr_opt if len(ocr_opt) < len(db_opt) else db_opt
                    l = db_opt  if len(ocr_opt) < len(db_opt) else ocr_opt
                    if s in l:
                        matched += 1
                        break
            if matched >= NEED and matched > best_count:
                best_count = matched
                best = entry
        return best

    def _fuzzy_search(self, ocr_text: str, ocr_options: list[str]) -> dict | None:
        """Hindi-normalised fuzzy search on question text then options."""
        MIN_LEN = 8
        NEED    = 2
        norm_q = self._normalize_hindi(ocr_text)
        if len(norm_q) >= MIN_LEN:
            for entry in self._questions:
                norm_db = self._normalize_hindi(entry.get("question_text", ""))
                if not norm_db:
                    continue
                s = norm_q  if len(norm_q)  < len(norm_db) else norm_db
                l = norm_db if len(norm_q)  < len(norm_db) else norm_q
                if len(s) >= MIN_LEN and s in l:
                    return entry
        # Fallback: normalised option matching
        norm_opts = [self._normalize_hindi(o) for o in ocr_options]
        for entry in self._questions:
            db_opts = [self._normalize_hindi(entry.get(f"option_{i}", "")) for i in range(1, 5)]
            m = 0
            for no in norm_opts:
                if len(no) < 4:
                    continue
                for d in db_opts:
                    if len(d) < 4:
                        continue
                    s = no if len(no) < len(d) else d
                    l = d  if len(no) < len(d) else no
                    if s in l:
                        m += 1
                        break
            if m >= NEED:
                return entry
        return None

    def _db_lookup(self, question_text: str, option_texts: list[str] | None = None) -> dict | None:
        """Combined DB lookup: question-text → option-reverse → Hindi-fuzzy."""
        match = self._search_by_question(question_text)
        if match:
            return match
        if option_texts:
            match = self._search_by_options(option_texts)
            if match:
                return match
            match = self._fuzzy_search(question_text, option_texts)
        return match

    def _sign_to_option(self, sign_label: str, option_images: list[str]) -> int | None:
        description = self._sign_labels.get(sign_label, "").lower()
        if not description:
            return None
        for i, opt_b64 in enumerate(option_images, start=1):
            try:
                img = _b64_to_pil(opt_b64)
                text = self._ocr_text(img).lower()
                if not text:
                    continue
                words = set(description.split())
                opt_words = set(text.split())
                if len(words & opt_words) >= 2:
                    return i
            except Exception:
                continue
        return None

    def _resolve_learned_option(
        self,
        learned: dict[str, Any],
        option_imgs: list[Image.Image | None],
        option_texts: list[str] | None = None,
    ) -> tuple[int | None, str]:
        """Map a learned answer identity onto the current shuffled option slots."""
        learned_hash = str(learned.get("correct_option_hash") or "")
        if learned_hash:
            for idx, img in enumerate(option_imgs, start=1):
                if img is not None and _djb2_hash(img) == learned_hash:
                    return idx, "answer_hash"

        learned_phash = str(learned.get("correct_option_phash") or "")
        if learned_phash:
            max_distance = self._learn_option_phash_max_distance()
            best_idx = None
            best_distance = max_distance + 1
            for idx, img in enumerate(option_imgs, start=1):
                if img is None:
                    continue
                distance = _hamming(_phash(img), learned_phash)
                if distance < best_distance:
                    best_idx = idx
                    best_distance = distance
            if best_idx is not None and best_distance <= max_distance:
                learned["_option_phash_distance"] = best_distance
                return best_idx, "answer_phash"

        if option_texts:
            target = self._clean_text(
                learned.get("correct_option_text")
                or learned.get(f"option_{learned.get('correct_option')}", "")
            )
            if len(target) >= 4:
                best_idx = None
                best_score = 0
                for idx, text in enumerate(option_texts, start=1):
                    current = self._clean_text(text)
                    if len(current) < 4:
                        continue
                    shorter = target if len(target) < len(current) else current
                    longer = current if len(target) < len(current) else target
                    if shorter in longer and len(shorter) > best_score:
                        best_idx = idx
                        best_score = len(shorter)
                if best_idx is not None:
                    return best_idx, "answer_text"

        return None, "answer_identity_unmatched"

    # ── Layer 3: LLM Fallback ─────────────────────────────────────────────────

    async def _llm_solve(self, question_b64: str, option_b64s: list[str]) -> int | None:
        endpoint = self._litellm_endpoint().rstrip("/")
        if not endpoint:
            return None
        # Auto-append /chat/completions if the endpoint is just a base URL
        if not endpoint.endswith("/chat/completions"):
            endpoint = endpoint + "/chat/completions"
        try:
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
                    "Authorization": f"Bearer {self._litellm_api_key()}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._litellm_model(),
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 10,
                },
            )
            resp.raise_for_status()
            answer = resp.json()["choices"][0]["message"]["content"].strip()
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
        option_imgs: list[Image.Image | None] = []
        for opt_b64 in option_b64s:
            try:
                option_imgs.append(_b64_to_pil(opt_b64))
            except Exception:
                option_imgs.append(None)

        enabled_methods, allow_random_fallback = self._solver_methods()
        sign_label: str | None = None
        question_text: str | None = None
        option_texts: list[str] | None = None
        question_hash = _djb2_hash(q_img)
        question_phash = _phash(q_img)
        learn_min_confidence = self._learn_min_confidence()
        learn_min_confirmations = self._learn_min_confirmations()
        learn_phash_max_distance = self._learn_phash_max_distance()
        learning_mode = self._learning_mode()
        train_candidate: dict[str, Any] | None = None
        pending_verified_learned: tuple[dict[str, Any], str] | None = None

        def _train_response(row: dict[str, Any], method: str) -> dict[str, Any]:
            opt_num, resolve_method = self._resolve_learned_option(row, option_imgs)
            stored_opt = int(row["correct_option"])
            display_opt = opt_num or stored_opt
            response = {
                "option_number": None,
                "candidate_option": display_opt,
                "answer_text": row.get("correct_option_text") or row.get(f"option_{stored_opt}", f"Option {stored_opt}"),
                "method": method,
                "processing_ms": int((time.perf_counter() - started) * 1000),
                "train_only": True,
                "confidence": float(row.get("confidence") or 0),
                "verified_count": int(row.get("verified_count") or 0),
                "answer_identity": resolve_method,
            }
            if row.get("_phash_distance") is not None:
                response["phash_distance"] = row.get("_phash_distance")
            if row.get("_option_phash_distance") is not None:
                response["option_phash_distance"] = row.get("_option_phash_distance")
            return response

        def with_fallback_flag(result: dict[str, Any] | None) -> dict[str, Any] | None:
            if result is not None:
                result.setdefault("allow_random_fallback", allow_random_fallback)
            return result

        def get_sign_label() -> str | None:
            nonlocal sign_label
            if sign_label is None:
                sign_label = self._match_sign_hash(q_img) or ""
            return sign_label or None

        def ensure_ocr_texts() -> tuple[str, list[str]]:
            nonlocal question_text, option_texts
            if question_text is not None and option_texts is not None:
                return question_text, option_texts
            q_future = self._ocr_pool.submit(self._ocr_text, q_img)
            opt_futures = []
            for opt_img in option_imgs:
                try:
                    if opt_img is None:
                        raise ValueError("invalid option image")
                    opt_futures.append(self._ocr_pool.submit(self._ocr_text, opt_img))
                except Exception:
                    opt_futures.append(None)
            question_text = q_future.result()
            option_texts = []
            for fut in opt_futures:
                if fut:
                    try:
                        option_texts.append(fut.result())
                    except Exception:
                        option_texts.append("")
                else:
                    option_texts.append("")
            return question_text, option_texts

        def try_sign_hash_db() -> dict[str, Any] | None:
            label = get_sign_label()
            if not label:
                return None
            sign_entry = self._search_by_sign(label)
            if not sign_entry or not sign_entry.get("correct_option_number"):
                return None
            opt_num = int(sign_entry["correct_option_number"])
            answer = sign_entry.get(f"option_{opt_num}", self._sign_labels.get(label, label))
            ms = int((time.perf_counter() - started) * 1000)
            logger.info("exam_solved_hash_db", extra={"context": {"sign": label, "option": opt_num}})
            return {"option_number": opt_num, "answer_text": answer, "method": "hash_db", "processing_ms": ms}

        def try_sign_hash_label() -> dict[str, Any] | None:
            label = get_sign_label()
            if not label:
                return None
            opt_num = self._sign_to_option(label, option_b64s)
            if not opt_num:
                return None
            ms = int((time.perf_counter() - started) * 1000)
            logger.info("exam_solved_hash", extra={"context": {"sign": label, "option": opt_num}})
            return {"option_number": opt_num, "answer_text": self._sign_labels.get(label, label), "method": "hash", "processing_ms": ms}

        def try_learned_exact_hash() -> dict[str, Any] | None:
            nonlocal pending_verified_learned, train_candidate
            learned = self._inmemory_get_by_hash(
                question_hash,
                min_confidence=learn_min_confidence,
                min_verified=learn_min_confirmations,
            )
            if learned and learned.get("correct_option") and learning_mode == "auto_click":
                opt_num, resolve_method = self._resolve_learned_option(learned, option_imgs)
                if opt_num:
                    stored_opt = int(learned["correct_option"])
                    answer = learned.get("correct_option_text") or learned.get(f"option_{stored_opt}", f"Option {stored_opt}")
                    ms = int((time.perf_counter() - started) * 1000)
                    logger.info("exam_solved_learned", extra={"context": {"hash": question_hash[:12], "option": opt_num, "identity": resolve_method, "confidence": learned.get("confidence")}})
                    return {
                        "option_number": opt_num,
                        "answer_text": answer,
                        "method": f"learned_db_{resolve_method}",
                        "processing_ms": ms,
                        "train_only": False,
                        "confidence": float(learned.get("confidence") or 0),
                        "verified_count": int(learned.get("verified_count") or 0),
                        "option_phash_distance": learned.get("_option_phash_distance"),
                    }
                pending_verified_learned = (learned, "learned_db")
                train_candidate = _train_response(learned, "learned_db_unmatched")
            if learned and learned.get("correct_option"):
                train_candidate = train_candidate or _train_response(learned, "learned_db_train")

            candidate = self._inmemory_get_candidate_by_hash(question_hash)
            if not train_candidate and candidate and candidate.get("correct_option"):
                train_candidate = _train_response(candidate, "learned_candidate")
            return None

        def try_learned_phash() -> dict[str, Any] | None:
            nonlocal pending_verified_learned, train_candidate
            learned = self._inmemory_get_by_phash(
                question_phash,
                max_distance=learn_phash_max_distance,
                min_confidence=learn_min_confidence,
                min_verified=learn_min_confirmations,
            )
            if learned and learned.get("correct_option") and learning_mode == "auto_click":
                opt_num, resolve_method = self._resolve_learned_option(learned, option_imgs)
                if opt_num:
                    stored_opt = int(learned["correct_option"])
                    answer = learned.get("correct_option_text") or learned.get(f"option_{stored_opt}", f"Option {stored_opt}")
                    ms = int((time.perf_counter() - started) * 1000)
                    logger.info("exam_solved_learned_phash", extra={"context": {
                        "hash": question_hash[:12],
                        "phash_distance": learned.get("_phash_distance"),
                        "option": opt_num,
                        "identity": resolve_method,
                        "confidence": learned.get("confidence"),
                    }})
                    return {
                        "option_number": opt_num,
                        "answer_text": answer,
                        "method": f"learned_phash_{resolve_method}",
                        "processing_ms": ms,
                        "train_only": False,
                        "confidence": float(learned.get("confidence") or 0),
                        "verified_count": int(learned.get("verified_count") or 0),
                        "phash_distance": learned.get("_phash_distance"),
                        "option_phash_distance": learned.get("_option_phash_distance"),
                    }
                pending_verified_learned = pending_verified_learned or (learned, "learned_phash")
                train_candidate = train_candidate or _train_response(learned, "learned_phash_unmatched")
            if learned and learned.get("correct_option"):
                train_candidate = train_candidate or _train_response(learned, "learned_phash_train")

            candidate = self._inmemory_get_candidate_by_phash(question_phash, max_distance=learn_phash_max_distance)
            if not train_candidate and candidate and candidate.get("correct_option"):
                train_candidate = _train_response(candidate, "learned_phash_candidate")
            return None

        def try_learned_text_identity() -> dict[str, Any] | None:
            if not pending_verified_learned or learning_mode != "auto_click":
                return None
            _question_text, ocr_option_texts = ensure_ocr_texts()
            learned_row, base_method = pending_verified_learned
            opt_num, resolve_method = self._resolve_learned_option(learned_row, option_imgs, ocr_option_texts)
            if not opt_num:
                return None
            stored_opt = int(learned_row["correct_option"])
            answer = learned_row.get("correct_option_text") or learned_row.get(f"option_{stored_opt}", f"Option {stored_opt}")
            ms = int((time.perf_counter() - started) * 1000)
            logger.info("exam_solved_learned_text_identity", extra={"context": {
                "hash": question_hash[:12],
                "option": opt_num,
                "identity": resolve_method,
                "method": base_method,
                "confidence": learned_row.get("confidence"),
            }})
            return {
                "option_number": opt_num,
                "answer_text": answer,
                "method": f"{base_method}_{resolve_method}",
                "processing_ms": ms,
                "train_only": False,
                "confidence": float(learned_row.get("confidence") or 0),
                "verified_count": int(learned_row.get("verified_count") or 0),
                "phash_distance": learned_row.get("_phash_distance"),
                "option_phash_distance": learned_row.get("_option_phash_distance"),
            }

        def try_ocr_db() -> dict[str, Any] | None:
            ocr_question_text, ocr_option_texts = ensure_ocr_texts()
            match = self._db_lookup(ocr_question_text, ocr_option_texts)
            if not match or not match.get("correct_option_number"):
                return None
            opt_num = int(match["correct_option_number"])
            answer = match.get(f"option_{opt_num}", f"Option {opt_num}")
            ms = int((time.perf_counter() - started) * 1000)
            logger.info("exam_solved_ocr_db", extra={"context": {"option": opt_num, "ms": ms}})
            return {"option_number": opt_num, "answer_text": answer, "method": "ocr_db", "processing_ms": ms}

        async def try_llm() -> dict[str, Any] | None:
            opt_num = await self._llm_solve(question_b64, option_b64s)
            if not opt_num:
                return None
            ms = int((time.perf_counter() - started) * 1000)
            logger.info("exam_solved_llm", extra={"context": {"option": opt_num, "ms": ms}})
            return {"option_number": opt_num, "answer_text": f"Option {opt_num} (AI)", "method": "llm", "processing_ms": ms}

        def try_auto_learned_bank() -> dict[str, Any] | None:
            for handler in (try_learned_exact_hash, try_learned_phash, try_learned_text_identity):
                result = handler()
                if result and result.get("option_number"):
                    return result
            return None

        def try_ocr_bank() -> dict[str, Any] | None:
            return try_ocr_db()

        for method_id in enabled_methods:
            if method_id == "auto_learned_bank":
                result = try_auto_learned_bank()
            elif method_id == "ocr_db":
                result = try_ocr_bank()
            elif method_id == "llm":
                result = await try_llm()
            else:
                continue
            if result and result.get("option_number"):
                return with_fallback_flag(result)

        if train_candidate:
            train_candidate["processing_ms"] = int((time.perf_counter() - started) * 1000)
            logger.info("exam_train_only_candidate", extra={"context": {
                "method": train_candidate.get("method"),
                "candidate_option": train_candidate.get("candidate_option"),
                "confidence": train_candidate.get("confidence"),
                "verified_count": train_candidate.get("verified_count"),
            }})
            return with_fallback_flag(train_candidate)

        ms = int((time.perf_counter() - started) * 1000)
        logger.warning("exam_no_match", extra={"context": {"question_text": (question_text or "")[:80]}})
        return {
            "option_number": None,
            "answer_text": None,
            "method": "none",
            "processing_ms": ms,
            "allow_random_fallback": allow_random_fallback,
        }
