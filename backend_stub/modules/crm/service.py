"""CRM business logic — add-on gate, default pipeline bootstrap."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from modules.crm.constants import DEFAULT_PIPELINE_NAME, DEFAULT_STAGES
from modules.crm import repository


def require_crm_addon(*, tenant_id: int, conn: Any) -> None:
    from admin_service import get_tenant_profile

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    if not profile.get("crm_addon"):
        raise HTTPException(
            status_code=403,
            detail="CRM is a paid add-on. Contact support to enable it on your account.",
        )


def ensure_default_pipeline(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    pipeline = repository.fetch_default_pipeline(tenant_id=tenant_id, conn=conn)
    if pipeline:
        return pipeline

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_pipelines (tenant_id, name, is_default)
            VALUES (%s, %s, TRUE)
            RETURNING id, name, is_default, created_at, updated_at
            """,
            (tenant_id, DEFAULT_PIPELINE_NAME),
        )
        row = cur.fetchone()
        pipeline_id = int(row[0])
        for index, (stage_key, label, is_won, is_lost) in enumerate(DEFAULT_STAGES):
            cur.execute(
                """
                INSERT INTO crm_deal_stages (
                  tenant_id, pipeline_id, stage_key, label, sort_order, is_won, is_lost
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (tenant_id, pipeline_id, stage_key, label, index + 1, is_won, is_lost),
            )

    return {
        "id": row[0],
        "name": row[1],
        "is_default": bool(row[2]),
        "created_at": row[3].isoformat() if row[3] else None,
        "updated_at": row[4].isoformat() if row[4] else None,
    }


def build_pipeline_board(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    pipeline = ensure_default_pipeline(tenant_id=tenant_id, conn=conn)
    stages = repository.list_stages(
        tenant_id=tenant_id,
        pipeline_id=pipeline["id"],
        conn=conn,
    )
    deals = repository.list_deals(
        tenant_id=tenant_id,
        pipeline_id=pipeline["id"],
        conn=conn,
    )
    deals_by_stage: dict[int, list[dict[str, Any]]] = {stage["id"]: [] for stage in stages}
    for deal in deals:
        deals_by_stage.setdefault(deal["stage_id"], []).append(deal)

    columns = [
        {
            **stage,
            "deals": deals_by_stage.get(stage["id"], []),
            "deal_count": len(deals_by_stage.get(stage["id"], [])),
        }
        for stage in stages
    ]
    return {
        "pipeline": pipeline,
        "stages": columns,
        "deal_count": len(deals),
    }


def validate_stage(*, tenant_id: int, pipeline_id: int, stage_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM crm_deal_stages
            WHERE tenant_id = %s AND pipeline_id = %s AND id = %s
            """,
            (tenant_id, pipeline_id, stage_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail="Invalid pipeline stage")


def validate_account(*, tenant_id: int, account_id: int | None, conn: Any) -> None:
    if account_id is None:
        return
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM crm_accounts WHERE tenant_id = %s AND id = %s",
            (tenant_id, account_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail="Account not found")


def validate_contact(*, tenant_id: int, contact_id: int | None, conn: Any) -> None:
    if contact_id is None:
        return
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM crm_contacts WHERE tenant_id = %s AND id = %s",
            (tenant_id, contact_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail="Contact not found")
