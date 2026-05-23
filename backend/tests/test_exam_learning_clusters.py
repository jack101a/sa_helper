import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from app.core.database import Database


def make_db():
    tmp = tempfile.TemporaryDirectory()
    settings = MagicMock()
    settings.storage.sqlite_path = str(Path(tmp.name) / "app.db")
    settings.auth.hash_salt = "test-salt"
    settings.auth.admin_token = "test-admin-token"
    settings.auth.key_prefix = "SK-"
    settings.auth.key_length = 32
    settings.auth.default_expiry_days = 30
    db = Database(settings)
    with db.connect() as conn:
        db._create_tables_fallback(conn)
    return db, tmp


def test_learned_variants_roll_up_into_verified_cluster():
    db, tmp = make_db()
    try:
        repo = db.exam_learned
        cluster_ids = []
        for idx in range(5):
            result = repo.upsert_learned(
                question_hash=f"hash-{idx}",
                question_phash="a" * 16,
                question_text="यह चिन्ह प्रदर्शित करता है",
                option_1="Stop",
                option_2="Go",
                option_3="Slow",
                option_4="None",
                correct_option=1,
                correct_option_hash=f"answer-hash-{idx}",
                correct_option_phash="b" * 16,
                correct_option_text="Stop",
            )
            cluster_ids.append(result["cluster_id"])

        assert len(set(cluster_ids)) == 1
        stats = repo.get_stats()
        assert stats["total_learned"] == 5
        assert stats["total_clusters"] == 1
        assert stats["verified_clusters"] == 1
        assert stats["high_confidence"] == 1

        learned_rows = repo.get_all_learned()
        assert all(row["cluster_status"] == "verified" for row in learned_rows)
        assert all(row["cluster_verified_count"] == 5 for row in learned_rows)
        assert len(repo.export_to_json()) == 1
    finally:
        tmp.cleanup()


def test_conflicting_answer_does_not_join_existing_cluster():
    db, tmp = make_db()
    try:
        repo = db.exam_learned
        first = repo.upsert_learned(
            question_hash="hash-a",
            question_phash="c" * 16,
            question_text="यह चिन्ह प्रदर्शित करता है",
            option_1="Stop",
            option_2="Go",
            option_3="Slow",
            option_4="None",
            correct_option=1,
            correct_option_hash="answer-stop",
            correct_option_phash="d" * 16,
            correct_option_text="Stop",
        )
        second = repo.upsert_learned(
            question_hash="hash-b",
            question_phash="c" * 16,
            question_text="यह चिन्ह प्रदर्शित करता है",
            option_1="Stop",
            option_2="Go",
            option_3="Slow",
            option_4="None",
            correct_option=2,
            correct_option_hash="answer-go",
            correct_option_phash="e" * 16,
            correct_option_text="Go",
        )

        assert first["cluster_id"] != second["cluster_id"]
        assert repo.get_stats()["total_clusters"] == 2
    finally:
        tmp.cleanup()
