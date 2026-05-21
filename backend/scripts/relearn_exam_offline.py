from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def _metadata_paths(dataset_dir: Path) -> list[Path]:
    index_path = dataset_dir / "index.json"
    paths: list[Path] = []
    if index_path.is_file():
        index = _load_json(index_path)
        questions = index.get("questions", {}) if isinstance(index, dict) else {}
        if isinstance(questions, dict):
            for entry in questions.values():
                if not isinstance(entry, dict):
                    continue
                rel = str(entry.get("metadata") or "").strip()
                if rel:
                    paths.append((dataset_dir / rel).resolve())
    if not paths:
        paths = sorted((dataset_dir / "questions").glob("*/metadata.json"))
    return [path for path in paths if path.is_file()]


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS exam_learned (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            question_hash    TEXT NOT NULL UNIQUE,
            question_phash   TEXT NOT NULL DEFAULT '',
            question_text    TEXT DEFAULT '',
            option_1         TEXT DEFAULT '',
            option_2         TEXT DEFAULT '',
            option_3         TEXT DEFAULT '',
            option_4         TEXT DEFAULT '',
            correct_option   INTEGER NOT NULL,
            correct_option_hash TEXT NOT NULL DEFAULT '',
            correct_option_phash TEXT NOT NULL DEFAULT '',
            correct_option_text TEXT NOT NULL DEFAULT '',
            confidence       REAL NOT NULL DEFAULT 0.8,
            seen_count       INTEGER NOT NULL DEFAULT 1,
            first_seen       TEXT NOT NULL,
            last_seen        TEXT NOT NULL,
            source           TEXT NOT NULL DEFAULT 'exam_feedback',
            learning_mode    TEXT NOT NULL DEFAULT 'hash_based',
            ocr_quality      TEXT NOT NULL DEFAULT 'unverified',
            ocr_preview_unreliable INTEGER NOT NULL DEFAULT 1,
            verified_count   INTEGER NOT NULL DEFAULT 0,
            wrong_count      INTEGER NOT NULL DEFAULT 0,
            last_verified_at TEXT,
            status           TEXT NOT NULL DEFAULT 'training'
        );
        CREATE INDEX IF NOT EXISTS idx_exam_learned_phash ON exam_learned(question_phash);
        """
    )


def _entry_from_metadata(path: Path) -> dict[str, Any] | None:
    data = _load_json(path)
    if not isinstance(data, dict):
        return None

    question_hash = str(data.get("question_hash") or "").strip()
    answer = data.get("answer") if isinstance(data.get("answer"), dict) else {}
    options = data.get("options") if isinstance(data.get("options"), list) else []
    learning = data.get("learning") if isinstance(data.get("learning"), dict) else {}
    if not question_hash:
        return None

    try:
        correct_option = int(answer.get("correct_option") or 0)
    except (TypeError, ValueError):
        correct_option = 0
    if correct_option < 1 or correct_option > 4:
        return None

    option_texts = ["", "", "", ""]
    for option in options:
        if not isinstance(option, dict):
            continue
        try:
            idx = int(option.get("option") or 0) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= idx < 4:
            option_texts[idx] = str(option.get("text") or "")

    saved_at = str(data.get("saved_at") or datetime.now(timezone.utc).isoformat())
    confidence = float(learning.get("confidence") if learning.get("confidence") is not None else 0.8)
    seen_count = int(learning.get("seen_count") if learning.get("seen_count") is not None else 1)
    verified_count = int(learning.get("verified_count") if learning.get("verified_count") is not None else 1)
    status = str(learning.get("status") or "training")
    if status not in {"training", "verified", "rejected"}:
        status = "training"

    return {
        "question_hash": question_hash,
        "question_phash": str(data.get("question_phash") or ""),
        "question_text": str(data.get("question_text") or ""),
        "option_1": option_texts[0],
        "option_2": option_texts[1],
        "option_3": option_texts[2],
        "option_4": option_texts[3],
        "correct_option": correct_option,
        "correct_option_hash": str(answer.get("correct_option_hash") or ""),
        "correct_option_phash": str(answer.get("correct_option_phash") or ""),
        "correct_option_text": str(answer.get("correct_option_text") or ""),
        "confidence": max(0.0, min(1.0, confidence)),
        "seen_count": max(1, seen_count),
        "first_seen": saved_at,
        "last_seen": saved_at,
        "source": "offline_restore",
        "learning_mode": "hash_based",
        "ocr_quality": "offline_metadata",
        "ocr_preview_unreliable": 1,
        "verified_count": max(1, verified_count),
        "wrong_count": 0,
        "last_verified_at": saved_at,
        "status": status,
    }


def _upsert(conn: sqlite3.Connection, entry: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO exam_learned (
            question_hash, question_phash, question_text, option_1, option_2, option_3, option_4,
            correct_option, correct_option_hash, correct_option_phash, correct_option_text,
            confidence, seen_count, first_seen, last_seen, source, learning_mode, ocr_quality,
            ocr_preview_unreliable, verified_count, wrong_count, last_verified_at, status
        )
        VALUES (
            :question_hash, :question_phash, :question_text, :option_1, :option_2, :option_3, :option_4,
            :correct_option, :correct_option_hash, :correct_option_phash, :correct_option_text,
            :confidence, :seen_count, :first_seen, :last_seen, :source, :learning_mode, :ocr_quality,
            :ocr_preview_unreliable, :verified_count, :wrong_count, :last_verified_at, :status
        )
        ON CONFLICT(question_hash) DO UPDATE SET
            question_phash = excluded.question_phash,
            question_text = excluded.question_text,
            option_1 = excluded.option_1,
            option_2 = excluded.option_2,
            option_3 = excluded.option_3,
            option_4 = excluded.option_4,
            correct_option = excluded.correct_option,
            correct_option_hash = excluded.correct_option_hash,
            correct_option_phash = excluded.correct_option_phash,
            correct_option_text = excluded.correct_option_text,
            confidence = excluded.confidence,
            seen_count = excluded.seen_count,
            last_seen = excluded.last_seen,
            source = excluded.source,
            learning_mode = excluded.learning_mode,
            ocr_quality = excluded.ocr_quality,
            ocr_preview_unreliable = excluded.ocr_preview_unreliable,
            verified_count = excluded.verified_count,
            wrong_count = excluded.wrong_count,
            last_verified_at = excluded.last_verified_at,
            status = excluded.status
        """,
        entry,
    )


def restore(dataset_dir: Path, sqlite_path: Path, dry_run: bool) -> int:
    metadata_paths = _metadata_paths(dataset_dir)
    entries: list[dict[str, Any]] = []
    skipped = 0
    for path in metadata_paths:
        try:
            entry = _entry_from_metadata(path)
        except Exception as exc:
            print(f"skip unreadable metadata: {path} ({exc})")
            skipped += 1
            continue
        if entry is None:
            print(f"skip invalid metadata: {path}")
            skipped += 1
            continue
        entries.append(entry)

    print(f"dataset={dataset_dir}")
    print(f"sqlite={sqlite_path}")
    print(f"valid_entries={len(entries)} skipped={skipped} dry_run={dry_run}")
    if dry_run:
        return len(entries)

    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(sqlite_path) as conn:
        _ensure_schema(conn)
        for entry in entries:
            _upsert(conn, entry)
        conn.commit()
    print(f"restored={len(entries)}")
    return len(entries)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Restore exam_learned SQLite rows from data/exam_offline metadata."
    )
    parser.add_argument(
        "--dataset",
        default=str(PROJECT_ROOT / "data" / "exam_offline"),
        help="Path to offline dataset folder.",
    )
    parser.add_argument(
        "--sqlite",
        default=str(PROJECT_ROOT / "backend" / "logs" / "app.db"),
        help="Path to SQLite app database.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and validate metadata without writing SQLite.",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset).resolve()
    sqlite_path = Path(args.sqlite).resolve()
    if not dataset_dir.exists():
        print(f"offline dataset not found: {dataset_dir}")
        return 2
    restore(dataset_dir=dataset_dir, sqlite_path=sqlite_path, dry_run=bool(args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
