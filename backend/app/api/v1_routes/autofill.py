"""Autofill, locator, and field-mapping endpoints."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.database import Database
from app.models.schemas import (
    AutofillFillRequest,
    AutofillFillResponse,
    AutofillRule,
    AutofillRuleProposalRequest,
    AutofillRuleSyncResponse,
    FieldMappingProposeRequest,
    LocatorProposeRequest,
)

from .utils import ensure_master_key, ensure_service_allowed

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1"])


@router.post("/autofill/fill", response_model=AutofillFillResponse)
async def autofill_fill(request: Request, payload: AutofillFillRequest) -> AutofillFillResponse:
    """
    Resolve form field selectors to fill values.
    profile_data is sent by the extension from local storage (not persisted here).
    """
    ensure_service_allowed(request, "autofill")
    container = request.app.state.container
    key_record = request.state.api_key_record
    client_ip = request.client.host if request.client else None
    normalized = Database._normalize_domain(payload.domain)

    try:
        fields_raw = [{"selector": f.selector, "label": f.label} for f in payload.fields]
        fills = container.autofill_service.resolve_fill(
            domain=normalized,
            fields=fields_raw,
            profile_data=payload.profile_data,
        )
        container.usage_service.record(
            key_id=int(key_record["id"]),
            task_type="autofill",
            status="ok",
            processing_ms=0,
            model_used="rule_engine",
            domain=normalized or None,
            ip=client_ip,
        )
        return AutofillFillResponse(fills=fills, domain=normalized)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("autofill_fill_failed", extra={"context": {"error": str(error)}})
        raise HTTPException(500, "autofill fill failed") from error


@router.get("/autofill/routes")
async def autofill_routes(request: Request) -> dict:
    """Return all approved field mapping routes for extension sync."""
    ensure_service_allowed(request, "autofill")
    container = request.app.state.container
    return container.autofill_service.get_all_routes()


@router.get("/autofill/routes/{domain}")
async def autofill_domain_routes(request: Request, domain: str) -> dict:
    """Return field mapping routes for a specific domain."""
    ensure_service_allowed(request, "autofill")
    container = request.app.state.container
    normalized = Database._normalize_domain(domain)
    return container.autofill_service.get_field_routes(normalized)


@router.post("/autofill/proposals")
async def autofill_rule_proposals(request: Request, payload: AutofillRuleProposalRequest) -> dict:
    """Extension submits a recorded rule (V26 engine) for admin review."""
    ensure_master_key(request)
    container = request.app.state.container
    key_record = request.state.api_key_record

    rule_json = payload.rule.model_dump_json()

    proposal = container.db.submit_autofill_proposal(
        idempotency_key=payload.idempotency_key,
        device_id=payload.client.device_id,
        api_key_id=int(key_record["id"]),
        rule_json=rule_json,
        submitted_at=payload.submitted_at,
    )
    return {"status": "accepted", "proposal_id": proposal.get("id")}


@router.get("/autofill/sync", response_model=AutofillRuleSyncResponse)
async def autofill_sync(request: Request) -> AutofillRuleSyncResponse:
    """Extension downloads approved rules (V26 engine) for local playback."""
    ensure_service_allowed(request, "autofill")
    container = request.app.state.container
    approved_rows = container.db.get_approved_autofill_rules()

    rules: list[AutofillRule] = []
    for row in approved_rows:
        try:
            rule_data = json.loads(row["rule_json"])
            rule_data["server_rule_id"] = row["approved_rule_id"]
            rules.append(AutofillRule(**rule_data))
        except Exception:
            logger.exception("failed_to_parse_approved_rule", extra={"context": {"id": row["id"]}})

    return AutofillRuleSyncResponse(rules=rules)


@router.get("/locators")
async def get_locators(request: Request) -> dict:
    # NOTE: This endpoint intentionally has no API-key auth — locators are
    # public metadata that the extension reads before authenticating.
    container = request.app.state.container
    return container.db.get_approved_locators()


@router.get("/field-mappings")
async def get_field_mappings(request: Request) -> dict:
    container = request.app.state.container
    domain = Database._normalize_domain(request.query_params.get("domain", ""))
    if not domain:
        return {}
    return container.db.get_domain_field_mappings(domain)


@router.get("/field-mappings/routes")
async def get_all_field_mapping_routes(request: Request) -> dict:
    container = request.app.state.container
    return container.db.get_all_domain_field_mappings()


@router.post("/locators/propose")
async def propose_locator(request: Request, payload: LocatorProposeRequest) -> dict:
    ensure_master_key(request)
    container = request.app.state.container
    container.db.propose_locator(payload.domain, payload.image_selector, payload.input_selector)
    return {"status": "proposed"}


@router.post("/field-mappings/propose")
async def propose_field_mapping(request: Request, payload: FieldMappingProposeRequest) -> dict:
    ensure_master_key(request)
    container = request.app.state.container
    key_record = request.state.api_key_record
    container.db.propose_field_mapping(
        domain=payload.domain.strip(),
        task_type=payload.task_type,
        source_data_type=payload.source_data_type.strip(),
        source_selector=payload.source_selector.strip(),
        target_data_type=payload.target_data_type.strip(),
        target_selector=payload.target_selector.strip(),
        proposed_field_name=payload.proposed_field_name.strip(),
        reported_by=int(key_record["id"]),
    )
    return {"status": "proposed"}
