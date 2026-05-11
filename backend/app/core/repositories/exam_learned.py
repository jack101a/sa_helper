from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from .base import BaseRepository


class ExamLearnedRepository(BaseRepository):
    """Self-learning question bank — populated from correct exam answers."""

    @staticmethod
    def _hex_hamming(a: str, b: str) -> int:
        if not a or not b or len(a) != len(b):
            return 9999
        try:
            return bin(int(a, 16) ^ int(b, 16)).count("1")
        except ValueError:
            return 9999

    def upsert_learned(
        self,
        question_hash: str,
        question_phash: str,
        question_text: str,
        option_1: str,
        option_2: str,
        option_3: str,
        option_4: str,
        correct_option: int,
        confidence_delta: float = 0.1,
        source: str = "exam_feedback",
        learning_mode: str = "hash_based",
        ocr_quality: str = "unverified",
        ocr_preview_unreliable: bool = True,
    ) -> dict[str, Any]:
        """Insert or update a learned question. Returns {action, id, confidence}."""
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                existing = conn.execute(
                    "SELECT id, confidence, seen_count FROM exam_learned WHERE question_hash = ?",
                    (question_hash,),
                ).fetchone()

                if existing:
                    new_confidence = min(1.0, float(existing["confidence"]) + confidence_delta)
                    new_seen = int(existing["seen_count"]) + 1
                    conn.execute(
                        """
                        UPDATE exam_learned
                        SET confidence = ?, seen_count = ?, last_seen = ?,
                            question_phash = CASE WHEN question_phash = '' THEN ? ELSE question_phash END,
                            question_text = CASE WHEN question_text = '' THEN ? ELSE question_text END,
                            option_1 = CASE WHEN option_1 = '' THEN ? ELSE option_1 END,
                            option_2 = CASE WHEN option_2 = '' THEN ? ELSE option_2 END,
                            option_3 = CASE WHEN option_3 = '' THEN ? ELSE option_3 END,
                            option_4 = CASE WHEN option_4 = '' THEN ? ELSE option_4 END,
                            learning_mode = ?,
                            ocr_quality = ?,
                            ocr_preview_unreliable = ?
                        WHERE id = ?
                        """,
                        (new_confidence, new_seen, now,
                         question_phash,
                         question_text, option_1, option_2, option_3, option_4,
                         learning_mode, ocr_quality, 1 if ocr_preview_unreliable else 0,
                         int(existing["id"])),
                    )
                    conn.commit()
                    return {"action": "updated", "id": int(existing["id"]), "confidence": new_confidence}
                else:
                    cursor = conn.execute(
                        """
                        INSERT INTO exam_learned
                            (question_hash, question_phash, question_text, option_1, option_2, option_3, option_4,
                             correct_option, confidence, seen_count, first_seen, last_seen, source,
                             learning_mode, ocr_quality, ocr_preview_unreliable)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                        """,
                        (question_hash, question_phash, question_text, option_1, option_2, option_3, option_4,
                         correct_option, 0.8, now, now, source,
                         learning_mode, ocr_quality, 1 if ocr_preview_unreliable else 0),
                    )
                    conn.commit()
                    return {"action": "inserted", "id": int(cursor.lastrowid), "confidence": 0.8}

    def get_by_hash(self, question_hash: str) -> dict[str, Any] | None:
        """Look up a learned question by its perceptual hash."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM exam_learned WHERE question_hash = ? AND confidence >= 0.6",
                (question_hash,),
            ).fetchone()
            return dict(row) if row else None

    def get_by_phash(self, question_phash: str, max_distance: int = 10) -> dict[str, Any] | None:
        """Look up a learned question by perceptual hash distance."""
        if not question_phash:
            return None
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM exam_learned
                WHERE question_phash != '' AND confidence >= 0.6
                ORDER BY confidence DESC, seen_count DESC
                """
            ).fetchall()

        best: dict[str, Any] | None = None
        best_distance = max_distance + 1
        for row in rows:
            item = dict(row)
            distance = self._hex_hamming(question_phash, item.get("question_phash", ""))
            if distance < best_distance:
                best = item
                best_distance = distance

        if best and best_distance <= max_distance:
            best["_phash_distance"] = best_distance
            return best
        return None

    def get_all_learned(self, min_confidence: float = 0.0) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM exam_learned WHERE confidence >= ? ORDER BY confidence DESC, seen_count DESC",
                (min_confidence,),
            )
            return [dict(row) for row in rows]

    def get_stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM exam_learned").fetchone()
            high_conf = conn.execute(
                "SELECT COUNT(*) AS n FROM exam_learned WHERE confidence >= 0.9"
            ).fetchone()
            avg_conf = conn.execute(
                "SELECT AVG(confidence) AS avg FROM exam_learned"
            ).fetchone()
            total_seen = conn.execute(
                "SELECT SUM(seen_count) AS total FROM exam_learned"
            ).fetchone()
            return {
                "total_learned": int(total["n"]) if total else 0,
                "high_confidence": int(high_conf["n"]) if high_conf else 0,
                "avg_confidence": round(float(avg_conf["avg"]), 3) if avg_conf and avg_conf["avg"] else 0.0,
                "total_confirmations": int(total_seen["total"]) if total_seen and total_seen["total"] else 0,
            }

    def export_to_json(self) -> list[dict[str, Any]]:
        """Export learned questions in the same format as questions.json."""
        rows = self.get_all_learned(min_confidence=0.6)
        return [
            {
                "question_text": row.get("question_text", ""),
                "question_sign_label": None,
                "options_type": "text",
                "option_1": row.get("option_1", ""),
                "option_2": row.get("option_2", ""),
                "option_3": row.get("option_3", ""),
                "option_4": row.get("option_4", ""),
                "correct_option_number": row["correct_option"],
                "correct_answer_target": row.get(f"option_{row['correct_option']}", ""),
                "chapter": "Hash Learned",
                "_source": row.get("source", "exam_feedback"),
                "_confidence": row["confidence"],
                "_seen_count": row["seen_count"],
                "_hash": row["question_hash"],
                "_question_hash": row["question_hash"],
                "_question_phash": row.get("question_phash", ""),
                "_learning_mode": row.get("learning_mode", "hash_based"),
                "_ocr_quality": row.get("ocr_quality", "unverified"),
                "_ocr_preview_unreliable": bool(row.get("ocr_preview_unreliable", 1)),
                "_note": "OCR fields are preview text only; matching uses image hashes.",
            }
            for row in rows
        ]
