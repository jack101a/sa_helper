from __future__ import annotations
from typing import Any
from .base import BaseRepository

class ExamRepository(BaseRepository):
    def get_exam_stats(self) -> dict[str, Any]:
        """Return high-level MCQ/exam statistics for the admin dashboard."""
        with self.connect() as conn:
            total = conn.execute(
                "SELECT COUNT(*) AS n FROM usage_events WHERE task_type = 'exam'"
            ).fetchone()
            ok = conn.execute(
                "SELECT COUNT(*) AS n FROM usage_events WHERE task_type = 'exam' AND status = 'ok'"
            ).fetchone()
            total_n = int(total["n"]) if total else 0
            ok_n = int(ok["n"]) if ok else 0
            return {
                "total_exam_solves": total_n,
                "exam_ok_count": ok_n,
                "exam_ok_rate": round(ok_n / total_n * 100, 1) if total_n else 0.0,
            }
