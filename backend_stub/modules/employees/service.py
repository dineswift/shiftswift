"""Employee core service — sponsor profile sync, SMS auto-log, domain events."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from core.events import emit_event
from sponsor_licence_compliance import log_sms_reportable_change

SMS_FIELDS = ("job_title", "salary", "work_location")


def sync_sponsor_profile(
    *,
    tenant_id: int,
    employee_id: int,
    is_sponsored: bool,
    conn: Any,
    visa_type: str | None = None,
    visa_expiry_date: str | None = None,
    share_code: str | None = None,
    cos_reference: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO employee_sponsor_profiles (
              tenant_id, employee_id, is_sponsored_worker, visa_type,
              visa_expiry_date, share_code, cos_reference, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
              is_sponsored_worker = EXCLUDED.is_sponsored_worker,
              visa_type = COALESCE(EXCLUDED.visa_type, employee_sponsor_profiles.visa_type),
              visa_expiry_date = COALESCE(EXCLUDED.visa_expiry_date, employee_sponsor_profiles.visa_expiry_date),
              share_code = COALESCE(EXCLUDED.share_code, employee_sponsor_profiles.share_code),
              cos_reference = COALESCE(EXCLUDED.cos_reference, employee_sponsor_profiles.cos_reference),
              updated_at = NOW()
            """,
            (
                tenant_id,
                employee_id,
                is_sponsored,
                visa_type,
                visa_expiry_date,
                share_code,
                cos_reference,
            ),
        )
    conn.commit()


def get_employee_row(*, tenant_id: int, employee_id: int, conn: Any) -> dict[str, Any] | None:
    from modules.employees.repository import fetch_employee

    return fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)


def after_employee_created(
    *,
    tenant_id: int,
    employee: dict[str, Any],
    data: dict[str, Any],
    actor_username: str,
    actor_role: str,
    conn: Any,
) -> None:
    sync_sponsor_profile(
        tenant_id=tenant_id,
        employee_id=employee["id"],
        is_sponsored=bool(data.get("is_sponsored", False)),
        conn=conn,
        visa_type=data.get("visa_type"),
        visa_expiry_date=data.get("visa_expiry_date"),
        share_code=data.get("share_code"),
        cos_reference=data.get("cos_reference"),
    )


def after_employee_updated(
    *,
    tenant_id: int,
    employee_id: int,
    old_row: dict[str, Any],
    new_row: dict[str, Any],
    actor_username: str,
    actor_role: str,
    conn: Any,
    reason: str | None = None,
) -> None:
    if old_row.get("is_sponsored") != new_row.get("is_sponsored") or new_row.get("is_sponsored"):
        sync_sponsor_profile(
            tenant_id=tenant_id,
            employee_id=employee_id,
            is_sponsored=bool(new_row.get("is_sponsored")),
            conn=conn,
        )

    for field in SMS_FIELDS:
        old_val = old_row.get(field)
        new_val = new_row.get(field)
        if old_val != new_val and new_row.get("is_sponsored"):
            log_sms_reportable_change(
                tenant_id=tenant_id,
                employee_id=employee_id,
                field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(new_val) if new_val is not None else None,
                changed_by=actor_username,
                conn=conn,
            )

    if old_row.get("status") != new_row.get("status"):
        emit_event(
            conn=conn,
            tenant_id=tenant_id,
            event_type="employee.status_changed",
            entity_type="employee",
            entity_id=employee_id,
            payload={
                "employee_id": employee_id,
                "old_status": old_row.get("status"),
                "new_status": new_row.get("status"),
                "reason": reason or "employee update",
            },
            actor_username=actor_username,
            actor_role=actor_role,
        )

    from modules.employees.entity_history import record_employee_version

    record_employee_version(
        tenant_id=tenant_id,
        employee_id=employee_id,
        old_row=old_row,
        new_row=new_row,
        changed_by=actor_username,
        changed_by_role=actor_role,
        conn=conn,
        change_reason=reason,
    )
