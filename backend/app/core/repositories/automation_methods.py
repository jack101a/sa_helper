from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.db import get_session
from app.core.models import AutomationMethodRecord

from .base import BaseRepository


class AutomationMethodRepository(BaseRepository):
    @staticmethod
    def _row_to_dict(row: AutomationMethodRecord) -> dict[str, Any]:
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "method_type": row.method_type,
            "enabled": row.enabled,
            "active": row.active,
            "payload_json": row.payload_json,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def list_automation_methods(self, method_type: str | None = None) -> list[dict[str, Any]]:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                q = session.query(AutomationMethodRecord)
                if method_type:
                    q = q.filter(AutomationMethodRecord.method_type == method_type)
                rows = q.order_by(AutomationMethodRecord.id.desc()).all()
                return [self._row_to_dict(r) for r in rows]
            finally:
                session.close()
        with self.connect() as conn:
            if method_type:
                rows = conn.execute(
                    "SELECT * FROM automation_methods WHERE method_type = ? ORDER BY id DESC",
                    (method_type,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM automation_methods ORDER BY id DESC"
                ).fetchall()
            return [dict(r) for r in rows]

    def get_automation_method(self, method_id: int) -> dict[str, Any] | None:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(AutomationMethodRecord, method_id)
                return self._row_to_dict(row) if row else None
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM automation_methods WHERE id = ?", (method_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_active_automation_method(self, method_type: str = "stall-flow") -> dict[str, Any] | None:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = (
                    session.query(AutomationMethodRecord)
                    .filter(AutomationMethodRecord.method_type == method_type)
                    .filter(AutomationMethodRecord.active == 1)
                    .filter(AutomationMethodRecord.enabled == 1)
                    .first()
                )
                return self._row_to_dict(row) if row else None
            finally:
                session.close()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM automation_methods WHERE method_type = ? AND active = 1 AND enabled = 1",
                (method_type,),
            ).fetchone()
            return dict(row) if row else None

    def create_automation_method(
        self, name: str, description: str, method_type: str, payload_json: str
    ) -> dict[str, Any]:
        now = datetime.now(UTC).isoformat()
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = AutomationMethodRecord(
                    name=name,
                    description=description,
                    method_type=method_type,
                    enabled=1,
                    active=0,
                    payload_json=payload_json,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
                session.commit()
                session.refresh(row)
                return self._row_to_dict(row)
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO automation_methods (name, description, method_type, payload_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (name, description, method_type, payload_json, now, now),
                )
                method_id = cur.lastrowid
                conn.commit()
                return self.get_automation_method(method_id)

    def update_automation_method(
        self, method_id: int, name: str | None = None, description: str | None = None,
        payload_json: str | None = None, enabled: int | None = None
    ) -> bool:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(AutomationMethodRecord, method_id)
                if not row:
                    return False
                if name is not None:
                    row.name = name
                if description is not None:
                    row.description = description
                if payload_json is not None:
                    row.payload_json = payload_json
                if enabled is not None:
                    row.enabled = int(enabled)
                row.updated_at = datetime.now(UTC).isoformat()
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        parts, params = [], []
        if name is not None:
            parts.append("name = ?")
            params.append(name)
        if description is not None:
            parts.append("description = ?")
            params.append(description)
        if payload_json is not None:
            parts.append("payload_json = ?")
            params.append(payload_json)
        if enabled is not None:
            parts.append("enabled = ?")
            params.append(enabled)
        
        if not parts:
            return False
        
        now = datetime.now(UTC).isoformat()
        parts.append("updated_at = ?")
        params.append(now)
        params.append(method_id)
        
        sql = f"UPDATE automation_methods SET {', '.join(parts)} WHERE id = ?"
        with self._lock:
            with self.connect() as conn:
                cur = conn.execute(sql, params)
                conn.commit()
                return cur.rowcount > 0

    def activate_automation_method(self, method_id: int) -> bool:
        """Set all methods of the same type to inactive, then set this one to active."""
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(AutomationMethodRecord, method_id)
                if not row or not row.enabled:
                    return False
                method_type = row.method_type
                now = datetime.now(UTC).isoformat()
                session.query(AutomationMethodRecord).filter(
                    AutomationMethodRecord.method_type == method_type
                ).update({"active": 0, "updated_at": now}, synchronize_session=False)
                row.active = 1
                row.updated_at = now
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                # Get method type first
                row = conn.execute(
                    "SELECT method_type, enabled FROM automation_methods WHERE id = ?", (method_id,)
                ).fetchone()
                if not row:
                    return False
                if not row["enabled"]:
                    return False
                
                method_type = row["method_type"]
                now = datetime.now(UTC).isoformat()
                
                # Deactivate others
                conn.execute(
                    "UPDATE automation_methods SET active = 0, updated_at = ? WHERE method_type = ?",
                    (now, method_type),
                )
                # Activate this one
                conn.execute(
                    "UPDATE automation_methods SET active = 1, updated_at = ? WHERE id = ?",
                    (now, method_id),
                )
                conn.commit()
                return True

    def delete_automation_method(self, method_id: int) -> bool:
        if self._use_sqlalchemy:
            session = get_session()
            try:
                row = session.get(AutomationMethodRecord, method_id)
                if not row:
                    return False
                session.delete(row)
                session.commit()
                return True
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        with self._lock:
            with self.connect() as conn:
                cur = conn.execute("DELETE FROM automation_methods WHERE id = ?", (method_id,))
                conn.commit()
                return cur.rowcount > 0
