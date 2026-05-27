from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
import json as _json
import hashlib as _hashlib
from .base import BaseRepository

class AutofillRepository(BaseRepository):
    @staticmethod
    def _rule_signature(rule_json: str) -> str:
        try:
            rule = _json.loads(rule_json or "{}")
        except Exception:
            return _hashlib.sha1(str(rule_json or "").encode()).hexdigest()
        steps = []
        for step in rule.get("steps", []) or []:
            selector = step.get("selector", {}) or {}
            steps.append({
                "field_key": step.get("field_key", ""),
                "action": step.get("action", ""),
                "value": str(step.get("value", "")),
                "selector": {
                    "strategy": selector.get("strategy", ""),
                    "primary": selector.get("primary", ""),
                    "id": selector.get("id", ""),
                    "element_id": selector.get("element_id", ""),
                    "name": selector.get("name", ""),
                    "css": selector.get("css", ""),
                    "xpath": selector.get("xpath", ""),
                },
            })
        canonical = {
            "profile": rule.get("profile_scope", "default"),
            "site": {
                "match_mode": (rule.get("site") or {}).get("match_mode", ""),
                "pattern": (rule.get("site") or {}).get("pattern", ""),
                "domain": (rule.get("site") or {}).get("domain", ""),
                "path": (rule.get("site") or {}).get("path", ""),
            },
            "steps": steps,
        }
        return _hashlib.sha1(_json.dumps(canonical, sort_keys=True).encode()).hexdigest()

    def submit_autofill_proposal(
        self,
        idempotency_key: str,
        device_id: str,
        api_key_id: int,
        rule_json: str,
        submitted_at: str,
    ) -> dict[str, Any]:
        """Insert a new rule proposal (idempotent). Returns the row as dict."""
        now = datetime.now(timezone.utc).isoformat()
        incoming_sig = self._rule_signature(rule_json)
        with self._lock:
            with self.connect() as conn:
                existing_rows = conn.execute(
                    """
                    SELECT * FROM autofill_rule_proposals
                    WHERE status IN ('pending', 'approved')
                    ORDER BY created_at DESC
                    """
                ).fetchall()
                for row in existing_rows:
                    if self._rule_signature(row["rule_json"]) == incoming_sig:
                        return dict(row)

                conn.execute(
                    """
                    INSERT OR IGNORE INTO autofill_rule_proposals
                        (idempotency_key, device_id, api_key_id, status,
                         submitted_at, rule_json, created_at)
                    VALUES (?, ?, ?, 'pending', ?, ?, ?)
                    """,
                    (idempotency_key, device_id, api_key_id, submitted_at, rule_json, now),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM autofill_rule_proposals WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                return dict(row) if row else {}

    def get_autofill_proposals(self, status: str | None = None, limit: int = 200) -> list[dict]:
        """Return proposals optionally filtered by status."""
        with self.connect() as conn:
            if status:
                rows = conn.execute(
                    "SELECT * FROM autofill_rule_proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                    (status, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM autofill_rule_proposals ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            return [dict(r) for r in rows]

    def approve_autofill_proposal(self, proposal_id: int, reviewed_by: str = "admin") -> str:
        """Approve a proposal, generate a server_rule_id, return it."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT rule_json FROM autofill_rule_proposals WHERE id = ?",
                    (proposal_id,),
                ).fetchone()
                if not row:
                    raise ValueError(f"Proposal {proposal_id} not found")
                server_rule_id = "srv_" + _hashlib.sha1(
                    (str(proposal_id) + row["rule_json"]).encode()
                ).hexdigest()[:12]
                conn.execute(
                    """
                    UPDATE autofill_rule_proposals
                    SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
                        approved_rule_id = ?
                    WHERE id = ?
                    """,
                    (reviewed_by, now, server_rule_id, proposal_id),
                )
                conn.commit()
                return server_rule_id

    def reject_autofill_proposal(self, proposal_id: int, reviewed_by: str = "admin") -> None:
        """Reject a proposal."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            with self.connect() as conn:
                conn.execute(
                    """
                    UPDATE autofill_rule_proposals
                    SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
                    WHERE id = ?
                    """,
                    (reviewed_by, now, proposal_id),
                )
                conn.commit()

    def delete_autofill_proposal(self, proposal_id: int) -> bool:
        """Permanently delete a proposal. Returns True if a row was deleted."""
        with self._lock:
            with self.connect() as conn:
                cur = conn.execute(
                    "DELETE FROM autofill_rule_proposals WHERE id = ?", (proposal_id,)
                )
                conn.commit()
                return cur.rowcount > 0

    def update_autofill_proposal(self, proposal_id: int, rule_json: str | None = None, status: str | None = None) -> bool:
        """Patch editable fields on a proposal. Returns True if a row was updated."""
        parts, params = [], []
        if rule_json is not None:
            parts.append("rule_json = ?")
            params.append(rule_json)
        if status is not None:
            allowed = {"pending", "approved", "rejected"}
            if status not in allowed:
                raise ValueError(f"Invalid status: {status!r}")
            parts.append("status = ?")
            params.append(status)
        if not parts:
            return False
        params.append(proposal_id)
        # SAFETY: parts only contains hardcoded column names ("rule_json", "status").
        # status is validated against a whitelist above. Parameters use ? placeholders.
        sql = f"UPDATE autofill_rule_proposals SET {', '.join(parts)} WHERE id = ?"
        with self._lock:
            with self.connect() as conn:
                cur = conn.execute(sql, params)
                conn.commit()
                return cur.rowcount > 0

    def get_approved_autofill_rules(self) -> list[dict]:
        """Return all approved proposals for extension sync download."""
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, approved_rule_id, rule_json, reviewed_at
                FROM autofill_rule_proposals
                WHERE status = 'approved'
                ORDER BY reviewed_at DESC
                """
            ).fetchall()
            deduped: list[dict] = []
            seen: set[str] = set()
            for row in rows:
                item = dict(row)
                sig = self._rule_signature(item.get("rule_json", ""))
                if sig in seen:
                    continue
                seen.add(sig)
                deduped.append(item)
            return deduped

    def propose_locator(self, domain: str, img: str, inp: str) -> None:
        clean_domain = self._normalize_domain(domain)
        if not clean_domain:
            return
        with self._lock, self.connect() as conn:
            now = datetime.now(timezone.utc).isoformat()
            # If the exact proposal already exists and is pending, ignore
            exists = conn.execute("SELECT id FROM locators WHERE domain=? AND image_selector=? AND input_selector=? AND status='pending'", (clean_domain, img, inp)).fetchone()
            if not exists:
                conn.execute("INSERT INTO locators (domain, image_selector, input_selector, created_at) VALUES (?, ?, ?, ?)", (clean_domain, img, inp, now))
                conn.commit()

    def get_pending_locators(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM locators WHERE status='pending' ORDER BY id DESC")]

    def get_approved_locators(self) -> dict[str, dict[str, str]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT domain, image_selector, input_selector FROM locators WHERE status='approved'")
            return {row["domain"]: {"img": row["image_selector"], "input": row["input_selector"]} for row in rows}

    def approve_locator(self, locator_id: int) -> None:
        with self._lock, self.connect() as conn:
            # First get the domain of this locator
            row = conn.execute("SELECT domain FROM locators WHERE id=?", (locator_id,)).fetchone()
            if row:
                domain = row["domain"]
                # Reject any currently approved locators for this domain
                conn.execute("UPDATE locators SET status='rejected' WHERE domain=? AND status='approved'", (domain,))
                # Approve the new one
                conn.execute("UPDATE locators SET status='approved' WHERE id=?", (locator_id,))
                conn.commit()

    def reject_locator(self, locator_id: int) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("UPDATE locators SET status='rejected' WHERE id=?", (locator_id,))
            conn.commit()

    def bulk_import_approved_rules(self, rules: list[dict]) -> int:
        """Import rules. Accept exported rows or raw autofill rule objects."""
        now = datetime.now(timezone.utc).isoformat()
        count = 0
        with self._lock:
            with self.connect() as conn:
                for index, rule in enumerate(rules):
                    if not isinstance(rule, dict):
                        continue
                    rule_json = rule.get("rule_json")
                    if rule_json and not isinstance(rule_json, str):
                        rule_json = _json.dumps(rule_json)
                    if not rule_json:
                        rule_json = _json.dumps(rule)

                    approved_id = (
                        rule.get("approved_rule_id")
                        or rule.get("server_rule_id")
                        or "srv_" + _hashlib.sha1(f"{now}:{index}:{rule_json}".encode()).hexdigest()[:12]
                    )
                    raw_status = str(rule.get("status") or "approved").strip().lower()
                    status = "rejected" if raw_status in {"inactive", "disabled", "rejected"} else "approved"
                    existing = conn.execute(
                        "SELECT id FROM autofill_rule_proposals WHERE approved_rule_id = ?",
                        (approved_id,),
                    ).fetchone()
                    if existing:
                        continue
                    cur = conn.execute(
                        """
                        INSERT INTO autofill_rule_proposals 
                            (idempotency_key, device_id, api_key_id, status, submitted_at, rule_json, approved_rule_id, reviewed_at, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        ("imported_" + approved_id, "admin", 0, status, now, rule_json, approved_id, now, now),
                    )
                    if cur.rowcount > 0:
                        count += 1
                conn.commit()
        return count
