from __future__ import annotations

import json
import logging
import zipfile
from pathlib import Path
from typing import Any, Iterable

from app.core.database import Database

logger = logging.getLogger(__name__)


class ExamOfflineImportService:
    """Import exam_offline metadata folders/zips into the learned SQLite bank."""

    def __init__(self, db: Database, data_dir: Path, exam_service=None) -> None:
        self._db = db
        self._data_dir = Path(data_dir).resolve()
        self._exam_service = exam_service

    def import_available(self) -> dict[str, Any]:
        """Import known offline dataset locations if they exist."""
        roots: list[Path] = []
        folder = self._data_dir / "exam_offline"
        if folder.exists():
            roots.append(folder)

        zip_candidates: list[Path] = []
        for pattern in ("exam_offline*.zip", "questions/exam_offline*.zip"):
            zip_candidates.extend(sorted(self._data_dir.glob(pattern)))

        result = {
            "sources": 0,
            "metadata": 0,
            "inserted": 0,
            "updated": 0,
            "skipped": 0,
            "invalid": 0,
            "errors": 0,
            "details": [],
        }
        for root in roots:
            self._merge_counts(result, self.import_folder(root))
        for archive in zip_candidates:
            self._merge_counts(result, self.import_zip(archive))
        if result["inserted"] or result["updated"]:
            self._reload_runtime_indexes()
        return result

    def import_folder(self, root: Path) -> dict[str, Any]:
        root = Path(root).resolve()
        result = self._empty_result(str(root))
        if not root.exists() or not root.is_dir():
            result["errors"] += 1
            result["details"].append({"source": str(root), "error": "folder_not_found"})
            return result

        metadata_items: list[tuple[str, dict[str, Any]]] = []
        for rel_path in self._metadata_paths_from_index(root):
            path = (root / rel_path).resolve()
            if root in path.parents and path.is_file():
                metadata_items.append((rel_path, self._read_json_file(path)))
        seen = {item[0] for item in metadata_items}
        for path in sorted(root.glob("questions/*/metadata.json")):
            rel = path.relative_to(root).as_posix()
            if rel in seen:
                continue
            metadata_items.append((rel, self._read_json_file(path)))

        return self._import_metadata_items(result, metadata_items)

    def import_zip(self, archive: Path) -> dict[str, Any]:
        archive = Path(archive).resolve()
        result = self._empty_result(str(archive))
        if not archive.exists() or not archive.is_file():
            result["errors"] += 1
            result["details"].append({"source": str(archive), "error": "zip_not_found"})
            return result

        try:
            with zipfile.ZipFile(archive) as zf:
                names = {name for name in zf.namelist() if not name.endswith("/")}
                metadata_names = set(self._metadata_paths_from_zip_index(zf, names))
                metadata_names.update(
                    name for name in names
                    if name.endswith("/metadata.json") and "/questions/" in f"/{name}"
                )
                metadata_items = [(name, self._read_json_zip(zf, name)) for name in sorted(metadata_names)]
        except Exception as e:
            result["errors"] += 1
            result["details"].append({"source": str(archive), "error": str(e)})
            return result

        return self._import_metadata_items(result, metadata_items)

    def _reload_runtime_indexes(self) -> None:
        try:
            self._db.exam_learned.ensure_clusters()
        except Exception as e:
            logger.warning("exam_offline_import_cluster_reload_failed", extra={"context": {"error": str(e)}})
        if self._exam_service is None:
            return
        try:
            self._exam_service._reload_learned_index()
            self._exam_service.export_learned_to_json()
        except Exception as e:
            logger.warning("exam_offline_import_runtime_reload_failed", extra={"context": {"error": str(e)}})

    @staticmethod
    def _empty_result(source: str) -> dict[str, Any]:
        return {
            "sources": 1,
            "metadata": 0,
            "inserted": 0,
            "updated": 0,
            "skipped": 0,
            "invalid": 0,
            "errors": 0,
            "details": [{"source": source}],
        }

    @staticmethod
    def _merge_counts(target: dict[str, Any], src: dict[str, Any]) -> None:
        for key in ("sources", "metadata", "inserted", "updated", "skipped", "invalid", "errors"):
            target[key] += int(src.get(key) or 0)
        target.setdefault("details", []).extend(src.get("details") or [])

    @staticmethod
    def _read_json_file(path: Path) -> dict[str, Any]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _read_json_zip(zf: zipfile.ZipFile, name: str) -> dict[str, Any]:
        try:
            data = json.loads(zf.read(name).decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _metadata_paths_from_index(self, root: Path) -> list[str]:
        index_path = root / "index.json"
        if not index_path.is_file():
            return []
        index = self._read_json_file(index_path)
        return list(self._metadata_paths_from_index_data(index))

    def _metadata_paths_from_zip_index(self, zf: zipfile.ZipFile, names: set[str]) -> list[str]:
        out: list[str] = []
        for index_name in sorted(name for name in names if name.endswith("index.json")):
            index = self._read_json_zip(zf, index_name)
            prefix = index_name.rsplit("/", 1)[0] + "/" if "/" in index_name else ""
            for rel in self._metadata_paths_from_index_data(index):
                candidate = prefix + rel
                if candidate in names:
                    out.append(candidate)
        return out

    @staticmethod
    def _metadata_paths_from_index_data(index: dict[str, Any]) -> Iterable[str]:
        questions = index.get("questions") if isinstance(index, dict) else {}
        if isinstance(questions, dict):
            iterable = questions.values()
        elif isinstance(questions, list):
            iterable = questions
        else:
            iterable = []
        for item in iterable:
            if not isinstance(item, dict):
                continue
            metadata = str(item.get("metadata") or "").strip()
            folder = str(item.get("folder") or "").strip()
            if metadata:
                yield metadata
            elif folder:
                yield f"{folder.rstrip('/')}/metadata.json"

    def _import_metadata_items(
        self,
        result: dict[str, Any],
        metadata_items: list[tuple[str, dict[str, Any]]],
    ) -> dict[str, Any]:
        result["metadata"] += len(metadata_items)
        for rel_path, metadata in metadata_items:
            payload = self._record_from_metadata(metadata)
            if not payload:
                result["invalid"] += 1
                continue
            try:
                action = self._db.exam_learned.import_learned_record(**payload)
            except Exception as e:
                result["errors"] += 1
                result["details"].append({"metadata": rel_path, "error": str(e)})
                continue
            key = str(action.get("action") or "skipped")
            if key in {"inserted", "updated"}:
                result[key] += 1
            elif key == "invalid":
                result["invalid"] += 1
            else:
                result["skipped"] += 1
        return result

    @staticmethod
    def _record_from_metadata(metadata: dict[str, Any]) -> dict[str, Any] | None:
        question_hash = str(metadata.get("question_hash") or "").strip()
        answer = metadata.get("answer") if isinstance(metadata.get("answer"), dict) else {}
        try:
            correct_option = int(answer.get("correct_option") or metadata.get("correct_option"))
        except (TypeError, ValueError):
            return None
        if not question_hash or correct_option not in {1, 2, 3, 4}:
            return None

        option_texts = ["", "", "", ""]
        options = metadata.get("options")
        if isinstance(options, list):
            for item in options:
                if not isinstance(item, dict):
                    continue
                try:
                    idx = int(item.get("option")) - 1
                except (TypeError, ValueError):
                    continue
                if 0 <= idx < 4:
                    option_texts[idx] = str(item.get("text") or "")

        learning = metadata.get("learning") if isinstance(metadata.get("learning"), dict) else {}
        return {
            "question_hash": question_hash,
            "question_phash": str(metadata.get("question_phash") or ""),
            "question_text": str(metadata.get("question_text") or ""),
            "options": option_texts,
            "correct_option": correct_option,
            "correct_option_hash": str(answer.get("correct_option_hash") or ""),
            "correct_option_phash": str(answer.get("correct_option_phash") or ""),
            "correct_option_text": str(answer.get("correct_option_text") or option_texts[correct_option - 1]),
            "confidence": learning.get("confidence", 0.8),
            "seen_count": learning.get("seen_count") or 1,
            "verified_count": learning.get("verified_count") or 1,
            "wrong_count": learning.get("wrong_count") or 0,
            "status": learning.get("status") or "training",
            "source": str(metadata.get("source") or "exam_offline_import"),
            "learning_mode": str(metadata.get("method") or "exam_offline_import"),
            "ocr_quality": "unverified",
            "ocr_preview_unreliable": True,
            "first_seen": metadata.get("saved_at"),
            "last_seen": metadata.get("saved_at"),
            "last_verified_at": metadata.get("saved_at"),
        }
