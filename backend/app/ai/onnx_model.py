"""ONNX model adapter for OCR-like inference."""

from __future__ import annotations

import base64
import io
import logging
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from app.ai.base_model import BaseAIModel
from app.core.config import Settings

logger = logging.getLogger(__name__)

VOCAB = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
TARGET_HEIGHT = 54
TARGET_WIDTH = 250


class OnnxAIModel(BaseAIModel):
    """ONNX inference model with CTC decoding, loaded from a specific path."""

    def __init__(self, settings: Settings, model_path: Path) -> None:
        self._settings = settings
        self._model_path = model_path
        self._session: ort.InferenceSession | None = None
        self._input_name: str | None = None
        self._output_name: str | None = None

    def _ensure_loaded(self) -> None:
        """Lazily load ONNX session and tensor names."""

        if self._session is not None:
            return
        if not self._model_path.exists():
            raise FileNotFoundError(f"ONNX model missing at {self._model_path}")
        started = time.perf_counter()
        self._session = ort.InferenceSession(str(self._model_path), providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name
        self._output_name = self._session.get_outputs()[0].name
        elapsed = int((time.perf_counter() - started) * 1000)
        logger.info(
            "onnx_model_loaded",
            extra={"context": {"model_path": str(self._model_path), "load_ms": elapsed}},
        )

    def _decode_payload_image(self, payload_base64: str) -> Image.Image:
        """Decode base64 payload into PIL image (mode handled in preprocess)."""

        raw = payload_base64
        if "," in payload_base64 and payload_base64.startswith("data:"):
            raw = payload_base64.split(",", 1)[1]
        binary = base64.b64decode(raw)
        return Image.open(io.BytesIO(binary))

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        """Apply training-equivalent preprocess and return [1, 3, 54, 250] float32."""

        # Normalize transparency onto a white background before RGB conversion.
        has_alpha = image.mode in {"RGBA", "LA"} or (
            image.mode == "P" and "transparency" in image.info
        )
        if has_alpha:
            rgba = image.convert("RGBA")
            white_bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            image = Image.alpha_composite(white_bg, rgba).convert("RGB")
        else:
            image = image.convert("RGB")

        original_w, original_h = image.size
        if original_h <= 0:
            raise ValueError("Invalid image height for preprocessing.")

        ratio = TARGET_HEIGHT / float(original_h)
        new_w = max(1, int(original_w * ratio))
        resized = image.resize((new_w, TARGET_HEIGHT), Image.Resampling.BILINEAR)

        if new_w < TARGET_WIDTH:
            padded = Image.new("RGB", (TARGET_WIDTH, TARGET_HEIGHT), (255, 255, 255))
            padded.paste(resized, (0, 0))
            processed = padded
        elif new_w > TARGET_WIDTH:
            processed = resized.crop((0, 0, TARGET_WIDTH, TARGET_HEIGHT))
        else:
            processed = resized

        array = np.asarray(processed, dtype=np.float32) / 255.0
        chw = np.transpose(array, (2, 0, 1))
        return np.expand_dims(chw, axis=0)

    def _decode_ctc(self, raw: np.ndarray) -> str:
        """Decode CTC logits into text."""

        if raw.shape[0] == 1:  # [B, T, C]
            best_path = np.argmax(raw, axis=2)[0]
        else:
            best_path = np.argmax(raw, axis=2)[:, 0]  # [T, B, C]

        prev = None
        chars: list[str] = []
        for idx in best_path:
            if idx != 0 and idx != prev:
                char_index = int(idx) - 1
                if 0 <= char_index < len(VOCAB):
                    chars.append(VOCAB[char_index])
            prev = idx
        return "".join(chars)

    async def solve(self, task_type: str, payload_base64: str, mode: str) -> str:
        """Run ONNX solve for image tasks, fallback for text/audio."""

        self._ensure_loaded()
        if task_type != "image":
            return f"{task_type}-not-supported-by-onnx"

        image = self._decode_payload_image(payload_base64)
        tensor = self._preprocess(image)
        started = time.perf_counter()
        raw = self._session.run([self._output_name], {self._input_name: tensor})[0]
        infer_ms = int((time.perf_counter() - started) * 1000)
        logger.info("onnx_inference_done", extra={"context": {"inference_ms": infer_ms}})
        return self._decode_ctc(raw)
