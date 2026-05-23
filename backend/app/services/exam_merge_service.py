"""Auto-merge verified learned questions into the main question bank.

When exam_learned entries reach 'verified' status (confidence >= 0.95,
verified_count >= 5, wrong_count == 0), this service merges them into
questions.json so they become part of the permanent question bank.

The merge is idempotent — duplicate question_hashes are skipped.
"""

from __future__ import annotations

import json
import logging
import shutil
import threading
import time
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.database import Database
    from app.services.exam_service import ExamService

logger = logging.getLogger(__name__)


class ExamMergeService:
    """Merges verified exam_learned entries into questions.json."""

    def __init__(self, db: "Database", data_dir: Path, exam_service: "ExamService") -> None:
        self._db = db
        self._data_dir = data_dir
        self._exam_service = exam_service
        self._merge_lock = threading.Lock()
        self._questions_path = data_dir / "questions" / "questions.json"

    def merge_verified_to_main(self) -> dict[str, Any]:
        """
        Merge verified learned questions into questions.json.

        Steps:
        1. Load current questions.json from memory (ExamService._questions)
        2. Get verified entries from exam_learned DB
        3. Skip entries whose question_hash already exists in the main bank
        4. Append new entries
        5. Backup old questions.json
        6. Write merged questions.json to disk
        7. Update ExamService._questions in memory (hot reload)
        8. Reload the learned index

        Returns:
            {
                "merged": int,           # new entries added
                "skipped_duplicates": int,
                "total_bank": int,       # total questions after merge
                "backup_path": str,      # path to backup file
            }
        """
        with self._merge_lock:
            # 1. Get current question bank from memory
            current_questions = list(self._exam_service._questions)

            # 2. Build set of existing question hashes for dedup
            existing_hashes: set[str] = set()
            for entry in current_questions:
                # questions.json entries may have _question_hash or _hash
                h = (
                    entry.get("_question_hash")
                    or entry.get("_hash")
                    or entry.get("question_hash")
                    or ""
                )
                if h:
                    existing_hashes.add(h)

            # 3. Get verified learned entries (exported in questions.json format)
            verified = self._db.exam_learned.export_to_json()

            # 4. Merge, skipping duplicates
            merged_count = 0
            skipped = 0
            for learned_entry in verified:
                q_hash = learned_entry.get("_question_hash", "")
                if not q_hash:
                    q_hash = learned_entry.get("_hash", "")
                if q_hash in existing_hashes:
                    skipped += 1
                    continue
                current_questions.append(learned_entry)
                existing_hashes.add(q_hash)
                merged_count += 1

            backup_path = ""
            if merged_count > 0:
                # 5. Backup old questions.json
                backup_path = self._backup_questions_json()

                # 6. Write merged questions.json to disk
                self._questions_path.parent.mkdir(parents=True, exist_ok=True)
                tmp_path = self._questions_path.with_suffix(".tmp")
                with tmp_path.open("w", encoding="utf-8") as f:
                    json.dump(current_questions, f, ensure_ascii=False, indent=2)
                tmp_path.replace(self._questions_path)

                # 7. Hot-reload ExamService question bank
                self._exam_service._questions = current_questions

                # 8. Reload learned index
                self._exam_service._reload_learned_index()

                logger.info("exam_merge_completed", extra={"context": {
                    "merged": merged_count,
                    "skipped": skipped,
                    "total": len(current_questions),
                }})
            else:
                logger.info("exam_merge_nothing_new", extra={"context": {
                    "skipped": skipped,
                    "total": len(current_questions),
                }})

            return {
                "merged": merged_count,
                "skipped_duplicates": skipped,
                "total_bank": len(current_questions),
                "backup_path": backup_path,
            }

    def _backup_questions_json(self) -> str:
        """Create a timestamped backup of questions.json. Keep last 5."""
        if not self._questions_path.exists():
            return ""
        backup_dir = self._questions_path.parent
        timestamp = int(time.time())
        backup_name = f"questions.backup_{timestamp}.json"
        backup_path = backup_dir / backup_name
        shutil.copy2(self._questions_path, backup_path)

        # Prune old backups — keep last 5
        backups = sorted(
            backup_dir.glob("questions.backup_*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for stale in backups[5:]:
            try:
                stale.unlink(missing_ok=True)
            except Exception:
                pass

        return str(backup_path)

    def get_merge_stats(self) -> dict[str, Any]:
        """Return stats about the training pipeline for admin dashboard."""
        learned_stats = self._db.exam_learned.get_stats()
        return {
            "main_bank_count": len(self._exam_service._questions),
            "learned_total": learned_stats.get("total_learned", 0),
            "learned_verified": learned_stats.get("high_confidence", 0),
            "learned_clusters": learned_stats.get("total_clusters", 0),
            "learned_verified_clusters": learned_stats.get("verified_clusters", 0),
            "learned_conflict_clusters": learned_stats.get("conflict_clusters", 0),
            "learned_avg_confidence": learned_stats.get("avg_confidence", 0.0),
            "learned_total_confirmations": learned_stats.get("total_confirmations", 0),
            "inmemory_hash_count": len(self._exam_service._learned_by_hash),
            "inmemory_phash_count": len(self._exam_service._learned_by_phash),
        }
