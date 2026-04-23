"""Autofill service — profile store and field mapping rule engine."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class AutofillService:
    """
    Manages user autofill profiles and resolves field mappings.

    User personal data is stored on-device (in chrome.storage.local).
    The backend only stores:
      - Field mapping rules (domain → CSS selector → field_name)
      - Per-domain approved field routes
    This preserves user privacy — the server never sees personal data.
    """

    def __init__(self, db: Any) -> None:
        self._db = db

    # ── Profile API (thin wrapper — server stores metadata only) ─────────────

    def get_field_routes(self, domain: str) -> dict[str, Any]:
        """
        Return field routing rules for a domain.
        Extension uses this to map CSS selectors → field_name keys,
        then fills values from its local profile storage.
        """
        mappings = self._db.get_domain_field_mappings(domain)
        return mappings

    def get_all_routes(self) -> dict[str, Any]:
        """Return all approved field routes grouped by domain (used for extension sync)."""
        return self._db.get_all_domain_field_mappings()

    def propose_rule(
        self,
        domain: str,
        task_type: str,
        source_data_type: str,
        source_selector: str,
        target_data_type: str,
        target_selector: str,
        proposed_field_name: str,
        reported_by: int,
    ) -> None:
        """Extension proposes a new field mapping for admin review."""
        self._db.propose_field_mapping(
            domain=domain,
            task_type=task_type,
            source_data_type=source_data_type,
            source_selector=source_selector,
            target_data_type=target_data_type,
            target_selector=target_selector,
            proposed_field_name=proposed_field_name,
            reported_by=reported_by,
        )
        logger.info("autofill_rule_proposed", extra={"context": {"domain": domain, "field": proposed_field_name}})

    def resolve_fill(
        self,
        domain: str,
        fields: list[dict[str, str]],
        profile_data: dict[str, str],
    ) -> list[dict[str, str]]:
        """
        Given a list of {selector, label} from the page and the user's
        profile_data {field_name: value}, return {selector, value} fill instructions.

        profile_data is sent by the extension (from local storage) — not stored here.
        """
        # Get approved rules for this domain
        rules: dict = self._db.get_domain_field_mappings(domain) or {}

        results: list[dict[str, str]] = []
        for field in fields:
            selector = field.get("selector", "")
            label    = field.get("label", "").lower().strip()

            # Try approved rule match by selector
            fill_value: str | None = None
            if selector in rules:
                field_name = rules[selector].get("field_name")
                fill_value = profile_data.get(field_name, "") if field_name else None

            # Fallback: label-based heuristic match
            if not fill_value:
                fill_value = self._heuristic_match(label, profile_data)

            if fill_value:
                results.append({"selector": selector, "value": fill_value})

        logger.info("autofill_resolved", extra={"context": {"domain": domain, "filled": len(results), "total": len(fields)}})
        return results

    def _heuristic_match(self, label: str, profile: dict[str, str]) -> str | None:
        """Simple keyword-based field mapping for unknown fields."""
        LABEL_MAPS: list[tuple[list[str], str]] = [
            (["name", "full name", "applicant"],           "full_name"),
            (["first name", "firstname"],                  "first_name"),
            (["last name", "surname", "lastname"],         "last_name"),
            (["email", "e-mail", "mail"],                  "email"),
            (["phone", "mobile", "cell", "contact"],       "phone"),
            (["dob", "date of birth", "birth date"],       "dob"),
            (["father", "father's name"],                  "father_name"),
            (["mother", "mother's name"],                  "mother_name"),
            (["address", "street", "residence"],           "address"),
            (["city", "town"],                             "city"),
            (["state", "province"],                        "state"),
            (["pin", "postal", "zipcode", "pincode"],      "pincode"),
            (["aadhar", "aadhaar", "uid"],                 "aadhar"),
            (["pan", "pan card"],                          "pan"),
            (["dl", "driving licence", "license no"],      "dl_number"),
            (["gender", "sex"],                            "gender"),
        ]
        for keywords, field_name in LABEL_MAPS:
            if any(kw in label for kw in keywords):
                val = profile.get(field_name)
                if val:
                    return val
        return None
