from types import SimpleNamespace
from unittest.mock import MagicMock

from app.api.admin_routes.captcha_proposals import _approve_one, _repair_approved_proposals
from app.core.database import Database


def _db(tmp_path):
    settings = MagicMock()
    settings.storage.sqlite_path = str(tmp_path / "app.db")
    settings.auth.hash_salt = "test-salt"
    settings.auth.admin_token = "test-admin-token"
    settings.auth.default_expiry_days = 30
    settings.auth.key_prefix = "SK-"
    settings.auth.key_length = 32
    db = Database(settings)
    db.init()
    return db


def _insert_proposal(db, *, source_selector, target_selector):
    with db.models.connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO field_mapping_proposals (
                domain, task_type, source_data_type, source_selector,
                target_data_type, target_selector, proposed_field_name,
                reported_by, status, created_at
            )
            VALUES (?, 'image', 'image', ?, 'text_input', ?, 'image_default', 1, 'pending', '2026-05-25T00:00:00+00:00')
            """,
            ("sarathi.parivahan.gov.in", source_selector, target_selector),
        )
        conn.commit()
        return int(cursor.lastrowid)


def test_approval_does_not_overwrite_distinct_selector_pairs(tmp_path):
    db = _db(tmp_path)
    container = SimpleNamespace(db=db)
    model_id = db.add_model_registry_entry(
        "captcha-model",
        "1",
        "image",
        "onnx",
        "captcha.onnx",
        "",
        status="active",
    )
    p1 = _insert_proposal(db, source_selector="#capimg", target_selector="#entcaptxt")
    p2 = _insert_proposal(db, source_selector="#capimg1", target_selector="#entcaptxt1")

    _approve_one(container, p1, model_id)
    _approve_one(container, p2, model_id)

    mappings = db.get_all_field_mappings()
    assert len(mappings) == 2
    assert {m["source_selector"] for m in mappings} == {"#capimg", "#capimg1"}
    assert len({m["field_name"] for m in mappings}) == 2


def test_repair_backfills_approved_proposals_collapsed_by_old_upsert(tmp_path):
    db = _db(tmp_path)
    container = SimpleNamespace(db=db)
    model_id = db.add_model_registry_entry(
        "captcha-model",
        "1",
        "image",
        "onnx",
        "captcha.onnx",
        "",
        status="active",
    )
    proposals = [
        _insert_proposal(db, source_selector="#capimg", target_selector="#entcaptxt"),
        _insert_proposal(db, source_selector="#capimg1", target_selector="#entcaptxt1"),
        _insert_proposal(db, source_selector="#capimg", target_selector="#entCaptha"),
    ]
    with db.models.connect() as conn:
        conn.execute("UPDATE field_mapping_proposals SET status = 'approved'")
        conn.commit()

    for proposal_id, source, target in [
        (proposals[0], "#capimg", "#entcaptxt"),
        (proposals[1], "#capimg1", "#entcaptxt1"),
        (proposals[2], "#capimg", "#entCaptha"),
    ]:
        db.set_field_mapping(
            domain="sarathi.parivahan.gov.in",
            field_name="image_default",
            task_type="image",
            ai_model_id=model_id,
            source_data_type="image",
            source_selector=source,
            target_data_type="text_input",
            target_selector=target,
        )

    assert len(db.get_all_field_mappings()) == 1
    assert _repair_approved_proposals(container) == 2

    mappings = db.get_all_field_mappings()
    assert len(mappings) == 3
    assert {m["target_selector"] for m in mappings} == {"#entcaptxt", "#entcaptxt1", "#entCaptha"}
    assert len({m["field_name"] for m in mappings}) == 3
