from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from .base import BaseRepository


class ExamLearnedRepository(BaseRepository):
    """Self-learning question bank populated from confirmed exam feedback."""

    DEFAULT_MIN_CONFIDENCE = 0.95
    DEFAULT_MIN_VERIFIED = 10

    def _min_verified(self) -> int:
        """Runtime confirmation threshold from settings, with safe fallback."""
        try:
            return max(1, int(self.db.settings.get_setting("exam.learn_min_confirmations", str(self.DEFAULT_MIN_VERIFIED))))
        except Exception:
            return self.DEFAULT_MIN_VERIFIED

    @staticmethod
    def _hex_hamming(a: str, b: str) -> int:
        if not a or not b or len(a) != len(b):
            return 9999
        try:
            return bin(int(a, 16) ^ int(b, 16)).count("1")
        except ValueError:
            return 9999

    @staticmethod
    def _clean_identity_text(text: str) -> str:
        t = str(text or "")
        t = re.sub(r"[\s\u200b-\u200d\ufeff\u00a0]+", "", t)
        t = re.sub(r"[\u0964\u0965।॥,.?!:;'\"()\[\]{}<>/\\|@#$%^&*~`\-_=+]", "", t)
        return t.lower()

    def _option_signature(self, option_1: str, option_2: str, option_3: str, option_4: str) -> str:
        values = [
            self._clean_identity_text(option_1),
            self._clean_identity_text(option_2),
            self._clean_identity_text(option_3),
            self._clean_identity_text(option_4),
        ]
        return "|".join(sorted(v for v in values if v))

    def _answer_compatible(
        self,
        item: dict[str, Any],
        correct_option_hash: str,
        correct_option_phash: str,
        correct_option_text_norm: str,
    ) -> bool:
        item_hash = str(item.get("correct_option_hash") or "")
        if item_hash and correct_option_hash and item_hash == correct_option_hash:
            return True

        item_phash = str(item.get("correct_option_phash") or "")
        if item_phash and correct_option_phash and self._hex_hamming(item_phash, correct_option_phash) <= 2:
            return True

        item_text = str(item.get("correct_option_text_norm") or "")
        if not item_text:
            item_text = self._clean_identity_text(str(item.get("correct_option_text") or ""))
        return bool(item_text and correct_option_text_norm and item_text == correct_option_text_norm)

    @staticmethod
    def _text_compatible(left: str, right: str, min_len: int = 8) -> bool:
        if not left or not right:
            return False
        if left == right:
            return True
        shorter = left if len(left) < len(right) else right
        longer = right if len(left) < len(right) else left
        return len(shorter) >= min_len and shorter in longer

    def _question_compatible(self, item: dict[str, Any], question_text_norm: str, option_signature: str) -> bool:
        item_question = str(item.get("question_text_norm") or "")
        item_options = str(item.get("option_signature") or "")
        return (
            self._text_compatible(item_question, question_text_norm)
            or bool(item_options and option_signature and item_options == option_signature)
        )

    def _cluster_status(self, confidence: float, verified_count: int, wrong_count: int, conflict_count: int) -> str:
        if wrong_count >= 2:
            return "rejected"
        if conflict_count > 0:
            return "conflict"
        if confidence >= self.DEFAULT_MIN_CONFIDENCE and verified_count >= self._min_verified() and wrong_count == 0:
            return "verified"
        return "training"

    def _find_matching_cluster(
        self,
        conn,
        question_phash: str,
        question_text_norm: str,
        option_signature: str,
        correct_option_hash: str,
        correct_option_phash: str,
        correct_option_text_norm: str,
    ) -> dict[str, Any] | None:
        if not question_phash:
            return None
        try:
            max_distance = max(0, int(self.db.settings.get_setting("exam.learn_phash_max_distance", "3")))
        except Exception:
            max_distance = 3
        rows = conn.execute(
            """
            SELECT *
            FROM exam_learned_clusters
            WHERE canonical_question_phash != '' AND status NOT IN ('rejected', 'conflict')
            ORDER BY confidence DESC, verified_count DESC
            """
        ).fetchall()
        best: dict[str, Any] | None = None
        best_distance = max_distance + 1
        for row in rows:
            item = dict(row)
            distance = self._hex_hamming(question_phash, item.get("canonical_question_phash", ""))
            if distance > max_distance or distance > best_distance:
                continue
            if not self._answer_compatible(item, correct_option_hash, correct_option_phash, correct_option_text_norm):
                continue
            if not self._question_compatible(item, question_text_norm, option_signature):
                continue
            best = item
            best_distance = distance
        if best:
            best["_phash_distance"] = best_distance
        return best

    def _create_cluster(
        self,
        conn,
        now: str,
        question_hash: str,
        question_phash: str,
        question_text: str,
        question_text_norm: str,
        option_signature: str,
        correct_option_hash: str,
        correct_option_phash: str,
        correct_option_text: str,
        correct_option_text_norm: str,
        confidence: float = 0.8,
        seen_count: int = 1,
        verified_count: int = 1,
        wrong_count: int = 0,
        variant_count: int = 1,
    ) -> int:
        status = self._cluster_status(confidence, verified_count, wrong_count, 0)
        cursor = conn.execute(
            """
            INSERT INTO exam_learned_clusters
                (canonical_question_hash, canonical_question_phash, question_text, question_text_norm,
                 option_signature, correct_option_hash, correct_option_phash, correct_option_text,
                 correct_option_text_norm, confidence, seen_count, verified_count, wrong_count,
                 variant_count, conflict_count, status, first_seen, last_seen, last_verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            """,
            (
                question_hash,
                question_phash,
                question_text,
                question_text_norm,
                option_signature,
                correct_option_hash,
                correct_option_phash,
                correct_option_text,
                correct_option_text_norm,
                confidence,
                seen_count,
                verified_count,
                wrong_count,
                variant_count,
                status,
                now,
                now,
                now,
            ),
        )
        return int(cursor.lastrowid)

    def _update_cluster(
        self,
        conn,
        cluster_id: int | None,
        now: str,
        question_hash: str,
        question_phash: str,
        question_text: str,
        question_text_norm: str,
        option_signature: str,
        correct_option_hash: str,
        correct_option_phash: str,
        correct_option_text: str,
        correct_option_text_norm: str,
        is_conflict: bool,
        new_variant: bool,
        confidence_delta: float,
        seen_delta: int = 1,
        verified_delta: int = 1,
    ) -> dict[str, Any] | None:
        if not cluster_id:
            return None
        row = conn.execute("SELECT * FROM exam_learned_clusters WHERE id = ?", (cluster_id,)).fetchone()
        if not row:
            return None
        item = dict(row)
        old_confidence = float(item.get("confidence") or 0.8)
        confidence = max(0.0, old_confidence - 0.2) if is_conflict else min(1.0, old_confidence + confidence_delta)
        seen_count = int(item.get("seen_count") or 0) + max(1, int(seen_delta or 1))
        verified_count = int(item.get("verified_count") or 0) + (0 if is_conflict else max(1, int(verified_delta or 1)))
        wrong_count = int(item.get("wrong_count") or 0) + (1 if is_conflict else 0)
        conflict_count = int(item.get("conflict_count") or 0) + (1 if is_conflict else 0)
        variant_count = int(item.get("variant_count") or 0) + (1 if new_variant else 0)
        status = self._cluster_status(confidence, verified_count, wrong_count, conflict_count)
        conn.execute(
            """
            UPDATE exam_learned_clusters
            SET canonical_question_hash = CASE WHEN canonical_question_hash = '' THEN ? ELSE canonical_question_hash END,
                canonical_question_phash = CASE WHEN canonical_question_phash = '' THEN ? ELSE canonical_question_phash END,
                question_text = CASE WHEN question_text = '' THEN ? ELSE question_text END,
                question_text_norm = CASE WHEN question_text_norm = '' THEN ? ELSE question_text_norm END,
                option_signature = CASE WHEN option_signature = '' THEN ? ELSE option_signature END,
                correct_option_hash = CASE WHEN ? != '' THEN ? ELSE correct_option_hash END,
                correct_option_phash = CASE WHEN ? != '' THEN ? ELSE correct_option_phash END,
                correct_option_text = CASE WHEN ? != '' THEN ? ELSE correct_option_text END,
                correct_option_text_norm = CASE WHEN ? != '' THEN ? ELSE correct_option_text_norm END,
                confidence = ?, seen_count = ?, verified_count = ?, wrong_count = ?,
                variant_count = ?, conflict_count = ?, status = ?, last_seen = ?, last_verified_at = ?
            WHERE id = ?
            """,
            (
                question_hash,
                question_phash,
                question_text,
                question_text_norm,
                option_signature,
                correct_option_hash,
                correct_option_hash,
                correct_option_phash,
                correct_option_phash,
                correct_option_text,
                correct_option_text,
                correct_option_text_norm,
                correct_option_text_norm,
                confidence,
                seen_count,
                verified_count,
                wrong_count,
                variant_count,
                conflict_count,
                status,
                now,
                now,
                cluster_id,
            ),
        )
        return {
            "cluster_id": cluster_id,
            "cluster_confidence": confidence,
            "cluster_verified_count": verified_count,
            "cluster_wrong_count": wrong_count,
            "cluster_status": status,
        }

    def _is_verified(self, item: dict[str, Any], min_confidence: float, min_verified: int) -> bool:
        row_verified = (
            item.get("status") == "verified"
            and float(item.get("confidence") or 0) >= min_confidence
            and int(item.get("verified_count") or 0) >= min_verified
            and int(item.get("wrong_count") or 0) == 0
        )
        cluster_verified = (
            item.get("cluster_status") == "verified"
            and float(item.get("cluster_confidence") or 0) >= min_confidence
            and int(item.get("cluster_verified_count") or 0) >= min_verified
            and int(item.get("cluster_wrong_count") or 0) == 0
            and item.get("status") != "rejected"
            and int(item.get("wrong_count") or 0) == 0
        )
        return row_verified or cluster_verified

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
                question_text_norm = self._clean_identity_text(question_text)
                correct_option_text_norm = self._clean_identity_text(correct_option_text)
                option_signature = self._option_signature(option_1, option_2, option_3, option_4)
                existing = conn.execute(
                    """
                    SELECT *
                    FROM exam_learned
                    WHERE question_hash = ?
                    """,
                    (question_hash,),
                ).fetchone()

                if existing:
                    existing_item = dict(existing)
                    existing_option = int(existing_item["correct_option"])
                    identity_known = any(
                        existing_item.get(key)
                        for key in ("correct_option_hash", "correct_option_phash", "correct_option_text")
                    )
                    is_conflict = (
                        not self._answer_compatible(
                            existing_item,
                            correct_option_hash,
                            correct_option_phash,
                            correct_option_text_norm,
                        )
                        if identity_known
                        else existing_option != int(correct_option)
                    )
                    base_confidence = 0.8 if is_conflict else float(existing["confidence"])
                    new_confidence = min(1.0, base_confidence + confidence_delta)
                    new_seen = int(existing["seen_count"]) + 1
                    new_verified = 1 if is_conflict else int(existing["verified_count"] or 0) + 1
                    new_wrong = int(existing["wrong_count"] or 0) + (1 if is_conflict else 0)
                    new_status = (
                        "verified"
                        if new_confidence >= self.DEFAULT_MIN_CONFIDENCE
                        and new_verified >= self._min_verified()
                        and new_wrong == 0
                        else "training"
                    )
                    cluster_id = existing_item.get("cluster_id")
                    if not cluster_id:
                        cluster = self._find_matching_cluster(
                            conn,
                            question_phash,
                            question_text_norm,
                            option_signature,
                            correct_option_hash,
                            correct_option_phash,
                            correct_option_text_norm,
                        )
                        cluster_id = int(cluster["id"]) if cluster else self._create_cluster(
                            conn,
                            now,
                            question_hash,
                            question_phash,
                            question_text,
                            question_text_norm,
                            option_signature,
                            correct_option_hash,
                            correct_option_phash,
                            correct_option_text,
                            correct_option_text_norm,
                        )
                    cluster_update = self._update_cluster(
                        conn,
                        int(cluster_id),
                        now,
                        question_hash,
                        question_phash,
                        question_text,
                        question_text_norm,
                        option_signature,
                        correct_option_hash,
                        correct_option_phash,
                        correct_option_text,
                        correct_option_text_norm,
                        is_conflict,
                        new_variant=False,
                        confidence_delta=confidence_delta,
                    )
                    conn.execute(
                        """
                        UPDATE exam_learned
                        SET cluster_id = ?, confidence = ?, seen_count = ?, verified_count = ?, wrong_count = ?,
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
                            int(cluster_id),
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
                        "cluster_id": int(cluster_id),
                        "confidence": new_confidence,
                        "verified_count": new_verified,
                        "wrong_count": new_wrong,
                        "status": new_status,
                        **(cluster_update or {}),
                    }

                cluster = self._find_matching_cluster(
                    conn,
                    question_phash,
                    question_text_norm,
                    option_signature,
                    correct_option_hash,
                    correct_option_phash,
                    correct_option_text_norm,
                )
                if cluster:
                    cluster_id = int(cluster["id"])
                    cluster_update = self._update_cluster(
                        conn,
                        cluster_id,
                        now,
                        question_hash,
                        question_phash,
                        question_text,
                        question_text_norm,
                        option_signature,
                        correct_option_hash,
                        correct_option_phash,
                        correct_option_text,
                        correct_option_text_norm,
                        is_conflict=False,
                        new_variant=True,
                        confidence_delta=confidence_delta,
                    )
                else:
                    cluster_id = self._create_cluster(
                        conn,
                        now,
                        question_hash,
                        question_phash,
                        question_text,
                        question_text_norm,
                        option_signature,
                        correct_option_hash,
                        correct_option_phash,
                        correct_option_text,
                        correct_option_text_norm,
                    )
                    cluster_update = {
                        "cluster_id": cluster_id,
                        "cluster_confidence": 0.8,
                        "cluster_verified_count": 1,
                        "cluster_wrong_count": 0,
                        "cluster_status": "training",
                    }

                cursor = conn.execute(
                    """
                    INSERT INTO exam_learned
                        (cluster_id, question_hash, question_phash, question_text, option_1, option_2, option_3, option_4,
                         correct_option_hash, correct_option_phash, correct_option_text,
                         correct_option, confidence, seen_count, first_seen, last_seen, source,
                         learning_mode, ocr_quality, ocr_preview_unreliable,
                         verified_count, wrong_count, last_verified_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, 0, ?, 'training')
                    """,
                    (
                        cluster_id,
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
                    "cluster_id": cluster_id,
                    "confidence": 0.8,
                    "verified_count": 1,
                    "wrong_count": 0,
                    "status": "training",
                    **(cluster_update or {}),
                }

    def import_learned_record(
        self,
        *,
        question_hash: str,
        question_phash: str = "",
        question_text: str = "",
        options: list[str] | tuple[str, ...] | None = None,
        correct_option: int,
        correct_option_hash: str = "",
        correct_option_phash: str = "",
        correct_option_text: str = "",
        confidence: float = 0.8,
        seen_count: int = 1,
        verified_count: int = 1,
        wrong_count: int = 0,
        status: str = "training",
        source: str = "exam_offline_import",
        learning_mode: str = "hash_based",
        ocr_quality: str = "unverified",
        ocr_preview_unreliable: bool = True,
        first_seen: str | None = None,
        last_seen: str | None = None,
        last_verified_at: str | None = None,
    ) -> dict[str, Any]:
        """Idempotently import a learned question from an offline dataset."""
        clean_hash = str(question_hash or "").strip()
        if not clean_hash:
            return {"action": "invalid", "reason": "missing_question_hash"}
        try:
            clean_correct = int(correct_option)
        except (TypeError, ValueError):
            return {"action": "invalid", "reason": "invalid_correct_option"}
        if clean_correct not in {1, 2, 3, 4}:
            return {"action": "invalid", "reason": "invalid_correct_option"}

        raw_options = list(options or [])
        padded_options = [(str(raw_options[idx]) if idx < len(raw_options) else "") for idx in range(4)]
        clean_status = str(status or "training").strip().lower()
        if clean_status not in {"training", "verified", "conflict", "rejected"}:
            clean_status = "training"
        if clean_status in {"conflict", "rejected"}:
            return {"action": "skipped", "reason": f"status_{clean_status}"}

        try:
            clean_confidence = max(0.0, min(1.0, float(confidence)))
        except (TypeError, ValueError):
            clean_confidence = 0.8
        try:
            clean_seen = max(1, int(seen_count))
        except (TypeError, ValueError):
            clean_seen = 1
        try:
            clean_verified = max(0, int(verified_count))
        except (TypeError, ValueError):
            clean_verified = 1
        try:
            clean_wrong = max(0, int(wrong_count))
        except (TypeError, ValueError):
            clean_wrong = 0

        now = datetime.now(timezone.utc).isoformat()
        clean_first_seen = str(first_seen or now)
        clean_last_seen = str(last_seen or clean_first_seen)
        clean_last_verified_at = str(last_verified_at or clean_last_seen)

        def strength(item: dict[str, Any]) -> tuple[int, int, float, int, int]:
            status_rank = {"training": 1, "verified": 2}.get(str(item.get("status") or "training").lower(), 0)
            return (
                status_rank,
                int(item.get("verified_count") or 0),
                float(item.get("confidence") or 0.0),
                int(item.get("seen_count") or 0),
                -int(item.get("wrong_count") or 0),
            )

        imported_score = strength({
            "status": clean_status,
            "verified_count": clean_verified,
            "confidence": clean_confidence,
            "seen_count": clean_seen,
            "wrong_count": clean_wrong,
        })
        question_text_norm = self._clean_identity_text(question_text)
        correct_option_text_norm = self._clean_identity_text(correct_option_text)
        option_signature = self._option_signature(*padded_options)

        with self._lock:
            with self.connect() as conn:
                existing_row = conn.execute(
                    "SELECT * FROM exam_learned WHERE question_hash = ?",
                    (clean_hash,),
                ).fetchone()
                existing = dict(existing_row) if existing_row else None
                if existing and strength(existing) >= imported_score:
                    return {"action": "skipped", "reason": "existing_not_weaker", "id": int(existing["id"])}

                cluster_id: int | None = int(existing["cluster_id"]) if existing and existing.get("cluster_id") else None
                if not cluster_id:
                    cluster = self._find_matching_cluster(
                        conn,
                        str(question_phash or ""),
                        question_text_norm,
                        option_signature,
                        str(correct_option_hash or ""),
                        str(correct_option_phash or ""),
                        correct_option_text_norm,
                    )
                    cluster_id = int(cluster["id"]) if cluster else None

                if cluster_id:
                    self._update_cluster(
                        conn,
                        cluster_id,
                        clean_last_seen,
                        clean_hash,
                        str(question_phash or ""),
                        str(question_text or ""),
                        question_text_norm,
                        option_signature,
                        str(correct_option_hash or ""),
                        str(correct_option_phash or ""),
                        str(correct_option_text or ""),
                        correct_option_text_norm,
                        is_conflict=False,
                        new_variant=not bool(existing),
                        confidence_delta=0.0,
                        seen_delta=clean_seen,
                        verified_delta=clean_verified or 1,
                    )
                else:
                    cluster_id = self._create_cluster(
                        conn,
                        clean_last_seen,
                        clean_hash,
                        str(question_phash or ""),
                        str(question_text or ""),
                        question_text_norm,
                        option_signature,
                        str(correct_option_hash or ""),
                        str(correct_option_phash or ""),
                        str(correct_option_text or ""),
                        correct_option_text_norm,
                        confidence=clean_confidence,
                        seen_count=clean_seen,
                        verified_count=clean_verified or 1,
                        wrong_count=clean_wrong,
                    )

                if existing:
                    row_confidence = max(clean_confidence, float(existing.get("confidence") or 0.0))
                    row_seen = max(clean_seen, int(existing.get("seen_count") or 0))
                    row_verified = max(clean_verified, int(existing.get("verified_count") or 0))
                    existing_wrong = existing.get("wrong_count")
                    row_wrong = min(clean_wrong, int(existing_wrong if existing_wrong is not None else clean_wrong))
                    conn.execute(
                        """
                        UPDATE exam_learned
                        SET cluster_id = ?, question_phash = ?, question_text = ?,
                            option_1 = ?, option_2 = ?, option_3 = ?, option_4 = ?,
                            correct_option_hash = ?, correct_option_phash = ?, correct_option_text = ?,
                            correct_option = ?, confidence = ?, seen_count = ?, wrong_count = ?,
                            last_seen = ?, source = ?, learning_mode = ?, ocr_quality = ?,
                            ocr_preview_unreliable = ?, verified_count = ?, last_verified_at = ?, status = ?
                        WHERE id = ?
                        """,
                        (
                            cluster_id,
                            str(question_phash or existing.get("question_phash") or ""),
                            str(question_text or existing.get("question_text") or ""),
                            padded_options[0] or str(existing.get("option_1") or ""),
                            padded_options[1] or str(existing.get("option_2") or ""),
                            padded_options[2] or str(existing.get("option_3") or ""),
                            padded_options[3] or str(existing.get("option_4") or ""),
                            str(correct_option_hash or existing.get("correct_option_hash") or ""),
                            str(correct_option_phash or existing.get("correct_option_phash") or ""),
                            str(correct_option_text or existing.get("correct_option_text") or ""),
                            clean_correct,
                            row_confidence,
                            row_seen,
                            row_wrong,
                            clean_last_seen,
                            source,
                            learning_mode,
                            ocr_quality,
                            1 if ocr_preview_unreliable else 0,
                            row_verified,
                            clean_last_verified_at,
                            clean_status,
                            int(existing["id"]),
                        ),
                    )
                    conn.commit()
                    return {"action": "updated", "id": int(existing["id"]), "cluster_id": int(cluster_id)}

                cursor = conn.execute(
                    """
                    INSERT INTO exam_learned
                        (cluster_id, question_hash, question_phash, question_text, option_1, option_2, option_3, option_4,
                         correct_option_hash, correct_option_phash, correct_option_text,
                         correct_option, confidence, seen_count, first_seen, last_seen, source,
                         learning_mode, ocr_quality, ocr_preview_unreliable,
                         verified_count, wrong_count, last_verified_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cluster_id,
                        clean_hash,
                        str(question_phash or ""),
                        str(question_text or ""),
                        padded_options[0],
                        padded_options[1],
                        padded_options[2],
                        padded_options[3],
                        str(correct_option_hash or ""),
                        str(correct_option_phash or ""),
                        str(correct_option_text or ""),
                        clean_correct,
                        clean_confidence,
                        clean_seen,
                        clean_first_seen,
                        clean_last_seen,
                        source,
                        learning_mode,
                        ocr_quality,
                        1 if ocr_preview_unreliable else 0,
                        clean_verified,
                        clean_wrong,
                        clean_last_verified_at,
                        clean_status,
                    ),
                )
                conn.commit()
                return {"action": "inserted", "id": int(cursor.lastrowid), "cluster_id": int(cluster_id)}

    def record_wrong(self, question_hash: str, selected_option: int | None = None, confidence_delta: float = 0.2) -> dict[str, Any] | None:
        """Penalize a learned row when its stored option is proven wrong."""
        if not question_hash:
            return None
        with self._lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT id, cluster_id, confidence, wrong_count, correct_option FROM exam_learned WHERE question_hash = ?",
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
                cluster_id = row["cluster_id"]
                cluster_update: dict[str, Any] | None = None
                if cluster_id:
                    cluster = conn.execute("SELECT * FROM exam_learned_clusters WHERE id = ?", (int(cluster_id),)).fetchone()
                    if cluster:
                        cluster_item = dict(cluster)
                        cluster_confidence = max(0.0, float(cluster_item.get("confidence") or 0) - confidence_delta)
                        cluster_wrong = int(cluster_item.get("wrong_count") or 0) + 1
                        cluster_status = self._cluster_status(
                            cluster_confidence,
                            int(cluster_item.get("verified_count") or 0),
                            cluster_wrong,
                            int(cluster_item.get("conflict_count") or 0),
                        )
                        conn.execute(
                            """
                            UPDATE exam_learned_clusters
                            SET confidence = ?, wrong_count = ?, status = ?, last_seen = ?
                            WHERE id = ?
                            """,
                            (cluster_confidence, cluster_wrong, cluster_status, now, int(cluster_id)),
                        )
                        cluster_update = {
                            "cluster_id": int(cluster_id),
                            "cluster_confidence": cluster_confidence,
                            "cluster_wrong_count": cluster_wrong,
                            "cluster_status": cluster_status,
                        }
                conn.commit()
                return {
                    "action": "penalized",
                    "id": int(row["id"]),
                    "confidence": new_confidence,
                    "wrong_count": new_wrong,
                    "status": new_status,
                    **(cluster_update or {}),
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

    def ensure_clusters(self, batch_limit: int = 50000) -> dict[str, int]:
        """
        Backfill cluster links for existing learned rows.
        This is idempotent and intentionally conservative: rows only share a
        cluster when pHash candidates also agree on answer identity and either
        OCR question text or the normalized option set.
        """
        linked = 0
        created = 0
        updated = 0
        with self._lock:
            with self.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT *
                    FROM exam_learned
                    WHERE cluster_id IS NULL AND status != 'rejected'
                    ORDER BY confidence DESC, verified_count DESC, seen_count DESC
                    LIMIT ?
                    """,
                    (max(1, int(batch_limit)),),
                ).fetchall()
                for row in rows:
                    item = dict(row)
                    now = str(item.get("last_seen") or datetime.now(timezone.utc).isoformat())
                    question_text = str(item.get("question_text") or "")
                    correct_option_text = str(item.get("correct_option_text") or "")
                    question_text_norm = self._clean_identity_text(question_text)
                    correct_option_text_norm = self._clean_identity_text(correct_option_text)
                    option_signature = self._option_signature(
                        str(item.get("option_1") or ""),
                        str(item.get("option_2") or ""),
                        str(item.get("option_3") or ""),
                        str(item.get("option_4") or ""),
                    )
                    cluster = self._find_matching_cluster(
                        conn,
                        str(item.get("question_phash") or ""),
                        question_text_norm,
                        option_signature,
                        str(item.get("correct_option_hash") or ""),
                        str(item.get("correct_option_phash") or ""),
                        correct_option_text_norm,
                    )
                    if cluster:
                        cluster_id = int(cluster["id"])
                        self._update_cluster(
                            conn,
                            cluster_id,
                            now,
                            str(item.get("question_hash") or ""),
                            str(item.get("question_phash") or ""),
                            question_text,
                            question_text_norm,
                            option_signature,
                            str(item.get("correct_option_hash") or ""),
                            str(item.get("correct_option_phash") or ""),
                            correct_option_text,
                            correct_option_text_norm,
                            is_conflict=False,
                            new_variant=True,
                            confidence_delta=0.0,
                            seen_delta=int(item.get("seen_count") or 1),
                            verified_delta=int(item.get("verified_count") or 1),
                        )
                        updated += 1
                    else:
                        cluster_id = self._create_cluster(
                            conn,
                            now,
                            str(item.get("question_hash") or ""),
                            str(item.get("question_phash") or ""),
                            question_text,
                            question_text_norm,
                            option_signature,
                            str(item.get("correct_option_hash") or ""),
                            str(item.get("correct_option_phash") or ""),
                            correct_option_text,
                            correct_option_text_norm,
                            confidence=float(item.get("confidence") or 0.8),
                            seen_count=int(item.get("seen_count") or 1),
                            verified_count=int(item.get("verified_count") or 1),
                            wrong_count=int(item.get("wrong_count") or 0),
                            variant_count=1,
                        )
                        created += 1
                    conn.execute("UPDATE exam_learned SET cluster_id = ? WHERE id = ?", (cluster_id, int(item["id"])))
                    linked += 1
                conn.commit()
        return {"linked": linked, "created": created, "updated": updated}

    def get_all_learned(self, min_confidence: float = 0.0) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT l.*,
                       c.status AS cluster_status,
                       c.confidence AS cluster_confidence,
                       c.verified_count AS cluster_verified_count,
                       c.wrong_count AS cluster_wrong_count,
                       c.variant_count AS cluster_variant_count,
                       c.conflict_count AS cluster_conflict_count,
                       c.correct_option_hash AS cluster_correct_option_hash,
                       c.correct_option_phash AS cluster_correct_option_phash,
                       c.correct_option_text AS cluster_correct_option_text,
                       c.correct_option_text_norm AS cluster_correct_option_text_norm,
                       c.canonical_question_phash AS cluster_question_phash
                FROM exam_learned l
                LEFT JOIN exam_learned_clusters c ON c.id = l.cluster_id
                WHERE l.confidence >= ? OR c.confidence >= ?
                ORDER BY COALESCE(c.confidence, l.confidence) DESC,
                         COALESCE(c.verified_count, l.verified_count) DESC,
                         l.seen_count DESC
                """,
                (min_confidence, min_confidence),
            )
            return [dict(row) for row in rows]

    def get_cluster_stats(self) -> dict[str, Any]:
        min_verified = self._min_verified()
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM exam_learned_clusters").fetchone()
            verified = conn.execute(
                """
                SELECT COUNT(*) AS n FROM exam_learned_clusters
                WHERE confidence >= ? AND verified_count >= ? AND wrong_count = 0 AND conflict_count = 0 AND status = 'verified'
                """,
                (self.DEFAULT_MIN_CONFIDENCE, min_verified),
            ).fetchone()
            conflicts = conn.execute("SELECT COUNT(*) AS n FROM exam_learned_clusters WHERE status = 'conflict'").fetchone()
            return {
                "total_clusters": int(total["n"]) if total else 0,
                "verified_clusters": int(verified["n"]) if verified else 0,
                "conflict_clusters": int(conflicts["n"]) if conflicts else 0,
            }

    def get_stats(self) -> dict[str, Any]:
        min_verified = self._min_verified()
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM exam_learned").fetchone()
            high_conf = conn.execute(
                """
                SELECT COUNT(*) AS n FROM exam_learned
                WHERE confidence >= ? AND verified_count >= ? AND status = 'verified'
                """,
                (self.DEFAULT_MIN_CONFIDENCE, min_verified),
            ).fetchone()
            avg_conf = conn.execute("SELECT AVG(confidence) AS avg FROM exam_learned").fetchone()
            total_seen = conn.execute("SELECT SUM(seen_count) AS total FROM exam_learned").fetchone()
            stats = {
                "total_learned": int(total["n"]) if total else 0,
                "high_confidence": int(high_conf["n"]) if high_conf else 0,
                "avg_confidence": round(float(avg_conf["avg"]), 3) if avg_conf and avg_conf["avg"] else 0.0,
                "total_confirmations": int(total_seen["total"]) if total_seen and total_seen["total"] else 0,
            }
        stats.update(self.get_cluster_stats())
        if stats["verified_clusters"]:
            stats["high_confidence"] = stats["verified_clusters"]
        return stats

    def export_to_json(self) -> list[dict[str, Any]]:
        """Export only verified learned questions in the same format as questions.json."""
        min_verified = self._min_verified()
        rows = [
            row for row in self.get_all_learned(min_confidence=self.DEFAULT_MIN_CONFIDENCE)
            if self._is_verified(row, self.DEFAULT_MIN_CONFIDENCE, min_verified)
        ]
        unique_rows: list[dict[str, Any]] = []
        seen_clusters: set[int] = set()
        for row in rows:
            cluster_id = row.get("cluster_id")
            if cluster_id:
                cluster_key = int(cluster_id)
                if cluster_key in seen_clusters:
                    continue
                seen_clusters.add(cluster_key)
            unique_rows.append(row)
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
            for row in unique_rows
        ]
