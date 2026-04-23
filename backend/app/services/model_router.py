"""Model routing service."""

from __future__ import annotations

from pathlib import Path

from app.ai.base_model import BaseAIModel
from app.ai.future_model import FutureAIModel
from app.ai.onnx_model import OnnxAIModel
from app.core.config import Settings
from app.core.database import Database


class ModelRouter:
    """Select active model and route based on domain."""

    def __init__(self, settings: Settings, db: Database) -> None:
        self._settings = settings
        self._db = db
        self._future = FutureAIModel()
        
        # Cache for loaded ONNX models
        self._loaded_models: dict[str, OnnxAIModel] = {}
        
        # Models directory (shared path for local and Docker volume mount)
        self._models_dir = Path("backend/models").resolve()

    def _get_onnx_model(self, filename: str) -> OnnxAIModel:
        """Get or initialize an ONNX model instance for a specific file."""
        if filename not in self._loaded_models:
            model_path = self._models_dir / filename
            model = OnnxAIModel(settings=self._settings, model_path=model_path)
            self._loaded_models[filename] = model
        return self._loaded_models[filename]

    def _resolve(
        self,
        model_name: str,
        task_type: str,
        domain: str | None = None,
        field_name: str | None = None,
    ) -> BaseAIModel:
        """Resolve string name to model instance, optionally utilizing domain routing for ONNX."""
        if model_name == "future":
            return self._future
        
        # If ONNX, attempt to find domain-specific model route
        if model_name == "onnx":
            target_filename = self._settings.model.onnx_path
            field_model = self._db.get_field_mapped_model(domain, field_name, task_type)
            if field_model:
                runtime = field_model.get("ai_runtime")
                if runtime == "future":
                    return self._future
                target_filename = str(field_model.get("ai_model_filename") or target_filename)
            elif domain:
                route = self._db.get_model_route(domain)
                if route:
                    target_filename = route
            if task_type != "image" and not field_model:
                raise ValueError(f"No mapped {task_type} model found for domain={domain or '-'} field={field_name or '-'}")
            return self._get_onnx_model(target_filename)

        raise ValueError(f"Unsupported model runtime: {model_name}")

    async def solve(
        self,
        task_type: str,
        payload_base64: str,
        mode: str,
        domain: str | None = None,
        field_name: str | None = None,
    ) -> dict:
        """
        Run selected model with fallback on error.
        Returns a dictionary indicating the solved text and the underlying model used.
        """

        primary = self._resolve(
            self._settings.model.default,
            task_type=task_type,
            domain=domain,
            field_name=field_name,
        )
        fallback = self._resolve(
            self._settings.model.fallback,
            task_type=task_type,
            domain=domain,
            field_name=field_name,
        )

        def _model_name(model: BaseAIModel, default_name: str) -> str:
            if isinstance(model, FutureAIModel):
                return "future"
            model_path = getattr(model, "_model_path", default_name)
            if isinstance(model_path, Path):
                return model_path.name
            return str(model_path)
             
        try:
            result = await primary.solve(task_type, payload_base64, mode)
            return {"result": result, "model_used": _model_name(primary, self._settings.model.default)}
        except Exception:
            if self._settings.model.fallback == self._settings.model.default:
                raise
            result = await fallback.solve(task_type, payload_base64, mode)
            return {"result": result, "model_used": _model_name(fallback, self._settings.model.fallback)}
