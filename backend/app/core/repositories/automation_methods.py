from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from .base import BaseRepository

class AutomationMethodRepository(BaseRepository):
    def list_automation_methods(self, method_type: str | None = None) -> list[dict[str, Any]]:
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
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM automation_methods WHERE id = ?", (method_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_active_automation_method(self, method_type: str = "stall-flow") -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM automation_methods WHERE method_type = ? AND active = 1 AND enabled = 1",
                (method_type,),
            ).fetchone()
            return dict(row) if row else None

    def create_automation_method(
        self, name: str, description: str, method_type: str, payload_json: str
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
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
        
        now = datetime.now(timezone.utc).isoformat()
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
                now = datetime.now(timezone.utc).isoformat()
                
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
        with self._lock:
            with self.connect() as conn:
                cur = conn.execute("DELETE FROM automation_methods WHERE id = ?", (method_id,))
                conn.commit()
                return cur.rowcount > 0
