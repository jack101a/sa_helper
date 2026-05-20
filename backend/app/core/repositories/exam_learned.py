from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import BaseRepository


class ExamLearnedRepository(BaseRepository):
    """Self-learning question bank populated from confirmed exam feedback."""

    DEFAULT_MIN_CONFIDENCE = 0.95
    DEFAULT_MIN_VERIFIED = 10

    @staticmethod
    def _hex_hamming(a: str, b: str) -> int:
        if not a or not b or len(a) != len(b):
            return 9999
        try:
            return bin(int(a, 16) ^ int(b, 16)).count("1")
        except ValueError:
            return 9999

    def _is_verified(self, item: dict[str, Any], min_confidence: float, min_verified: int) -> bool:
        return (
            item.get("status") == "verified"
            and float(item.get("confidence") or 0) >= min_confidence
            and int(item.get("verified_count") or 0) >= min_verified
            and int(item.get("wrong_count") or 0) == 0
        )

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
        correct_option_hash: str = "",
        correct_option_phash: str = "",
        correct_option_text: str = "",
        confidence_delta: float = 0.1,
        source: str = "exam_feedback",
        learning_mode: str = "hash_based",
        ocr_quality: str = "unverified",
        ocr_preview_unreliable: bool = True,
    ) -> dict[str, Any]:
        """Insert or update a learned question after confirmed-correct feedback."""
        with self._lock:
            with self.connect() as conn:
                now = datetime.now(timezone.utc).isoformat()
                existing = conn.execute(
                    """
                    SELECT id, confidence, seen_count, verified_count, wrong_count, correct_option
                    FROM exam_learned
                    WHERE question_hash = ?
                    """,
                    (question_hash,),
                ).fetchone()

                if existing:
                    existing_option = int(existing["correct_option"])
                    is_conflict = existing_option != int(correct_option)
                    base_confidence = 0.8 if is_conflict else float(existing["confidence"])
                    new_confidence = min(1.0, base_confidence + confidence_delta)
                    new_seen = int(existing["seen_count"]) + 1
                    new_verified = 1 if is_conflict else int(existing["verified_count"] or 0) + 1
                    new_wrong = int(existing["wrong_count"] or 0) + (1 if is_conflict else 0)
                    new_status = (
                        "verified"
                        if new_confidence >= self.DEFAULT_MIN_CONFIDENCE
                        and new_verified >= self.DEFAULT_MIN_VERIFIED
                        and new_wrong == 0
                        else "training"
                    )
                    conn.execute(
                        """
                        UPDATE exam_learned
                        SET confidence = ?, seen_count = ?, verified_count = ?, wrong_count = ?,
                            last_seen = ?, last_verified_at = ?, status = ?, correct_option = ?,
                            question_phash = CASE WHEN question_phash = '' THEN ? ELSE question_phash END,
                            question_text = CASE WHEN question_text = '' THEN ? ELSE question_text END,
                            option_1 = CASE WHEN option_1 = '' THEN ? ELSE option_1 END,
                            option_2 = CASE WHEN option_2 = '' THEN ? ELSE option_2 END,
                            option_3 = CASE WHEN option_3 = '' THEN ? ELSE option_3 END,
                            option_4 = CASE WHEN option_4 = '' THEN ? ELSE option_4 END,
                            correct_option_hash = CASE WHEN ? != '' THEN ? ELSE correct_option_hash END,
                            correct_option_phash = CASE WHEN ? != '' THEN ? ELSE correct_option_phash END,
                            correct_option_text = CASE WHEN ? != '' THEN ? ELSE correct_option_text END,
                            learning_mode = ?,
                            ocr_quality = ?,
                            ocr_preview_unreliable = ?
                        WHERE id = ?
                        """,
                        (
                            new_confidence,
                            new_seen,
                            new_verified,
                            new_wrong,
                            now,
                            now,
                            new_status,
                            correct_option,
                            question_phash,
                            question_text,
                            option_1,
                            option_2,
                            option_3,
                            option_4,
                            correct_option_hash,
                            correct_option_hash,
                            correct_option_phash,
                            correct_option_phash,
                            correct_option_text,
                            correct_option_text,
                            learning_mode,
                            ocr_quality,
                            1 if ocr_preview_unreliable else 0,
                            int(existing["id"]),
                        ),
                    )
                    conn.commit()
                    return {
                        "action": "updated_conflict" if is_conflict else "updated",
                        "id": int(existing["id"]),
                        "confidence": new_confidence,
                        "verified_count": new_verified,
                        "wrong_count": new_wrong,
                        "status": new_status,
                    }

                cursor = conn.execute(
                    """
                    INSERT INTO exam_learned
                        (question_hash, question_phash, question_text, option_1, option_2, option_3, option_4,
                         correct_option_hash, correct_option_phash, correct_option_text,
                         correct_option, confidence, seen_count, first_seen, last_seen, source,
                         learning_mode, ocr_quality, ocr_preview_unreliable,
                         verified_count, wrong_count, last_verified_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, 0, ?, 'training')
                    """,
                    (
                        question_hash,
                        question_phash,
                        question_text,
                        option_1,
                        option_2,
                        option_3,
                        option_4,
                        correct_option_hash,
                        correct_option_phash,
                        correct_option_text,
                        correct_option,
                        0.8,
                        now,
                        now,
                        source,
                        learning_mode,
                        ocr_quality,
                        1 if ocr_preview_unreliable else 0,
                        now,
                    ),
                )
                conn.commit()
                return {
                    "action": "inserted",
                    "id": int(cursor.lastrowid),
                    "confidence": 0.8,
                    "verified_count": 1,
                    "wrong_count": 0,
                    "status": "training",
                }

    def record_wrong(self, question_hash: str, selected_option: int | None = None, confidence_delta: float = 0.2) -> dict[str, Any] | None:
        """Penalize a learned row when its stored option is proven wrong."""
        if not question_hash:
            return None
        with self._lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT id, confidence, wrong_count, correct_option FROM exam_learned WHERE question_hash = ?",
                    (question_hash,),
                ).fetchone()
                if not row:
                    return None
                if selected_option and int(row["correct_option"]) != int(selected_option):
                    return dict(row)
                now = datetime.now(timezone.utc).isoformat()
                new_confidence = max(0.0, float(row["confidence"]) - confidence_delta)
                new_wrong = int(row["wrong_count"] or 0) + 1
                new_status = "rejected" if new_wrong >= 2 or new_confidence < 0.5 else "training"
                conn.execute(
                    """
                    UPDATE exam_learned
                    SET confidence = ?, wrong_count = ?, status = ?, last_seen = ?
                    WHERE id = ?
                    """,
                    (new_confidence, new_wrong, new_status, now, int(row["id"])),
                )
                conn.commit()
                return {
                    "action": "penalized",
                    "id": int(row["id"]),
                    "confidence": new_confidence,
                    "wrong_count": new_wrong,
                    "status": new_status,
                }

    def get_by_hash(
        self,
        question_hash: str,
        min_confidence: float = DEFAULT_MIN_CONFIDENCE,
        min_verified: int = DEFAULT_MIN_VERIFIED,
    ) -> dict[str, Any] | None:
        """Look up a verified learned question by exact hash."""
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM exam_learned WHERE question_hash = ?", (question_hash,)).fetchone()
        item = dict(row) if row else None
        return item if item and self._is_verified(item, min_confidence, min_verified) else None

    def get_candidate_by_hash(self, question_hash: str) -> dict[str, Any] | None:
        """Return a non-rejected exact-hash candidate for train-only display."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM exam_learned WHERE question_hash = ? AND status != 'rejected'",
                (question_hash,),
            ).fetchone()
        return dict(row) if row else None

    def get_by_phash(
        self,
        question_phash: str,
        max_distance: int = 3,
        min_confidence: float = DEFAULT_MIN_CONFIDENCE,
        min_verified: int = DEFAULT_MIN_VERIFIED,
    ) -> dict[str, Any] | None:
        """Look up a verified learned question by pHash distance."""
        best = self._nearest_phash(question_phash, max_distance=max_distance, verified_only=True)
        if best and self._is_verified(best, min_confidence, min_verified):
            return best
        return None

    def get_candidate_by_phash(self, question_phash: str, max_distance: int = 3) -> dict[str, Any] | None:
        """Return nearest non-rejected pHash candidate for train-only display."""
        return self._nearest_phash(question_phash, max_distance=max_distance, verified_only=False)

    def _nearest_phash(self, question_phash: str, max_distance: int, verified_only: bool) -> dict[str, Any] | None:
        if not question_phash:
            return None
        where_status = "AND status = 'verified'" if verified_only else "AND status != 'rejected'"
        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM exam_learned
                WHERE question_phash != '' {where_status}
                ORDER BY confidence DESC, verified_count DESC
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
                "SELECT * FROM exam_learned WHERE confidence >= ? ORDER BY confidence DESC, verified_count DESC, seen_count DESC",
                (min_confidence,),
            )
            return [dict(row) for row in rows]

    def get_stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM exam_learned").fetchone()
            high_conf = conn.execute(
                """
                SELECT COUNT(*) AS n FROM exam_learned
                WHERE confidence >= ? AND verified_count >= ? AND status = 'verified'
                """,
                (self.DEFAULT_MIN_CONFIDENCE, self.DEFAULT_MIN_VERIFIED),
            ).fetchone()
            avg_conf = conn.execute("SELECT AVG(confidence) AS avg FROM exam_learned").fetchone()
            total_seen = conn.execute("SELECT SUM(seen_count) AS total FROM exam_learned").fetchone()
            return {
                "total_learned": int(total["n"]) if total else 0,
                "high_confidence": int(high_conf["n"]) if high_conf else 0,
                "avg_confidence": round(float(avg_conf["avg"]), 3) if avg_conf and avg_conf["avg"] else 0.0,
                "total_confirmations": int(total_seen["total"]) if total_seen and total_seen["total"] else 0,
            }

    def export_to_json(self) -> list[dict[str, Any]]:
        """Export only verified learned questions in the same format as questions.json."""
        rows = [
            row for row in self.get_all_learned(min_confidence=self.DEFAULT_MIN_CONFIDENCE)
            if self._is_verified(row, self.DEFAULT_MIN_CONFIDENCE, self.DEFAULT_MIN_VERIFIED)
        ]
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
                "correct_answer_target": row.get("correct_option_text") or row.get(f"option_{row['correct_option']}", ""),
                "_correct_option_hash": row.get("correct_option_hash", ""),
                "_correct_option_phash": row.get("correct_option_phash", ""),
                "_correct_option_text": row.get("correct_option_text", ""),
                "chapter": "Hash Learned",
                "_source": row.get("source", "exam_feedback"),
                "_confidence": row["confidence"],
                "_seen_count": row["seen_count"],
                "_verified_count": row.get("verified_count", 0),
                "_wrong_count": row.get("wrong_count", 0),
                "_status": row.get("status", "training"),
                "_hash": row["question_hash"],
                "_question_hash": row["question_hash"],
                "_question_phash": row.get("question_phash", ""),
                "_learning_mode": row.get("learning_mode", "hash_based"),
                "_ocr_quality": row.get("ocr_quality", "unverified"),
                "_ocr_preview_unreliable": bool(row.get("ocr_preview_unreliable", 1)),
                "_note": "OCR fields are preview text only; matching uses verified image hashes.",
            }
            for row in rows
        ]
