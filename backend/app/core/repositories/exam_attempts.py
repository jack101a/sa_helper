from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from .base import BaseRepository


class ExamAttemptsRepository(BaseRepository):
    """Records every exam answer attempt with correctness."""

    def insert_attempt(
        self,
        question_hash: str,
        selected_option: int,
        was_correct: bool,
        method: str | None = None,
        processing_ms: int = 0,
        domain: str | None = None,
        question_num: int | None = None,
    ) -> int:
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                cursor = conn.execute(
                    """
                    INSERT INTO exam_attempts
                        (question_hash, selected_option, was_correct, method, processing_ms, domain, question_num, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (question_hash, selected_option, int(was_correct), method, processing_ms, domain, question_num, now),
                )
                conn.commit()
                return int(cursor.lastrowid)

    def get_attempts_by_hash(self, question_hash: str, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM exam_attempts WHERE question_hash = ? ORDER BY id DESC LIMIT ?",
                (question_hash, limit),
            )
            return [dict(row) for row in rows]

    def get_stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM exam_attempts").fetchone()
            correct = conn.execute(
                "SELECT COUNT(*) AS n FROM exam_attempts WHERE was_correct = 1"
            ).fetchone()
            by_method = conn.execute(
                """
                SELECT method, COUNT(*) AS c, SUM(was_correct) AS correct
                FROM exam_attempts GROUP BY method ORDER BY c DESC
                """
            ).fetchall()
            return {
                "total_attempts": int(total["n"]) if total else 0,
                "correct_count": int(correct["n"]) if correct else 0,
                "accuracy": round(int(correct["n"]) / max(int(total["n"]), 1), 3) if total else 0.0,
                "by_method": [
                    {"method": row["method"], "count": row["c"], "correct": row["correct"]}
                    for row in by_method
                ],
            }