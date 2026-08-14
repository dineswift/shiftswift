"""Sponsor licence holder confirmation — customer duty acknowledgement before compliance tools."""

from __future__ import annotations

from datetime import datetime
from typing import Any

SPONSOR_LICENCE_ACK_VERSION = "2026-06-11"

SPONSOR_LICENCE_TOOLS_NOTICE = (
    "ShiftSwift HR provides tools to record compliance activity and surface alerts. "
    "It does not carry out Right to Work checks, submit Sponsorship Management System (SMS) "
    "reports, or act as your Authorising Officer. Those duties remain with your organisation."
)

SPONSOR_LICENCE_DUTIES: list[dict[str, str]] = [
    {
        "title": "Right to Work checks",
        "customer_duty": "Complete lawful RTW checks before employment starts and retain evidence as required by law.",
        "software_role": "Store immutable PDF evidence, track expiry dates, and remind you when checks lapse.",
    },
    {
        "title": "Worker absences",
        "customer_duty": "Monitor sponsored workers and report unauthorised absences to the Home Office within 10 consecutive working days when required.",
        "software_role": "Record paid, unpaid, and unauthorised absences and alert you before the day-9 threshold.",
    },
    {
        "title": "SMS change reporting",
        "customer_duty": "Report job title, salary, and work location changes via the Home Office SMS within 10 working days.",
        "software_role": "Log reportable changes and highlight open reporting windows — you must submit via SMS.",
    },
    {
        "title": "Recruitment & adverts",
        "customer_duty": "Advertise vacancies lawfully, meet RLMT where applicable, and keep advert evidence for audit.",
        "software_role": "Record advert URLs, platforms, and dates to support your audit trail.",
    },
    {
        "title": "Record keeping & inspections",
        "customer_duty": "Maintain accurate sponsor records and produce evidence promptly if the Home Office requests it.",
        "software_role": "Export audit packs (JSON/PDF) from data your team enters — not a substitute for SMS submissions.",
    },
]

SPONSOR_LICENCE_ACK_TEXT = (
    "I confirm that our organisation holds a valid UK Sponsor Licence (or is applying under our "
    "own legal responsibility). Those duties remain with our organisation."
)


def get_sponsor_licence_ack_status(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT holds_sponsor_licence,
                   sponsor_licence_acknowledged_at,
                   sponsor_licence_acknowledged_by,
                   sponsor_licence_ack_version
            FROM tenants
            WHERE id = %s
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
    acknowledged_at = row[1]
    return {
        "holds_sponsor_licence": bool(row[0]),
        "acknowledged": acknowledged_at is not None,
        "acknowledged_at": acknowledged_at.isoformat() if acknowledged_at else None,
        "acknowledged_by": row[2],
        "ack_version": row[3],
        "current_ack_version": SPONSOR_LICENCE_ACK_VERSION,
        "ack_text": SPONSOR_LICENCE_ACK_TEXT,
        "tools_notice": SPONSOR_LICENCE_TOOLS_NOTICE,
        "duties": SPONSOR_LICENCE_DUTIES,
    }


def assert_sponsor_licence_acknowledged(*, tenant_id: int, conn: Any) -> None:
    status = get_sponsor_licence_ack_status(tenant_id=tenant_id, conn=conn)
    if status.get("acknowledged"):
        return
    from fastapi import HTTPException

    raise HTTPException(
        status_code=403,
        detail=(
            "Confirm your organisation holds a UK Sponsor Licence and acknowledge that you "
            "remain responsible for Home Office duties before using sponsor compliance recording tools."
        ),
    )


def acknowledge_sponsor_licence(
    *,
    tenant_id: int,
    acknowledged_by: str,
    holds_sponsor_licence: bool,
    conn: Any,
) -> dict[str, Any]:
    if not holds_sponsor_licence:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="You must confirm your organisation holds a UK Sponsor Licence.",
        )
    with conn.cursor() as cur:
        from core.schema import table_columns

        punch_mode_set = (
            ", punch_time_mode = 'timestamped'"
            if "punch_time_mode" in table_columns(conn, "tenants")
            else ""
        )
        cur.execute(
            f"""
            UPDATE tenants
            SET holds_sponsor_licence = TRUE,
                sponsor_licence_acknowledged_at = NOW(),
                sponsor_licence_acknowledged_by = %s,
                sponsor_licence_ack_version = %s
                {punch_mode_set}
            WHERE id = %s
            """,
            (acknowledged_by.strip(), SPONSOR_LICENCE_ACK_VERSION, tenant_id),
        )
        if cur.rowcount == 0:
            raise LookupError("tenant not found")
    return get_sponsor_licence_ack_status(tenant_id=tenant_id, conn=conn)
