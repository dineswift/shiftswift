"""Employee contact detail change requests — submit, HR review, apply on approval."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

EMPLOYEE_EDITABLE_FIELDS = frozenset(
    {
        "phone",
        "home_address",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relationship",
    }
)

FIELD_LABELS = {
    "phone": "Telephone",
    "home_address": "Home address",
    "emergency_contact_name": "Emergency contact name",
    "emergency_contact_phone": "Emergency contact phone",
    "emergency_contact_relationship": "Emergency contact relationship",
}

REQUEST_STATUSES = frozenset({"pending", "approved", "rejected", "cancelled"})


def _normalize_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _snapshot_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _normalize_value(row.get(key)) for key in EMPLOYEE_EDITABLE_FIELDS}


def _diff_changes(*, previous: dict[str, Any], proposed: dict[str, Any]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for key in EMPLOYEE_EDITABLE_FIELDS:
        if key not in proposed:
            continue
        old_val = previous.get(key)
        new_val = _normalize_value(proposed.get(key))
        if old_val != new_val:
            changes.append(
                {
                    "field": key,
                    "label": FIELD_LABELS.get(key, key),
                    "old": old_val,
                    "new": new_val,
                }
            )
    return changes


def _serialize_row(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        request_id,
        employee_id,
        first_name,
        last_name,
        status,
        proposed_raw,
        previous_raw,
        employee_note,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
    ) = row
    proposed = proposed_raw if isinstance(proposed_raw, dict) else json.loads(proposed_raw or "{}")
    previous = previous_raw if isinstance(previous_raw, dict) else json.loads(previous_raw or "{}")
    name = f"{first_name or ''} {last_name or ''}".strip()
    return {
        "id": int(request_id),
        "employee_id": int(employee_id),
        "employee_name": name,
        "status": status,
        "proposed_changes": proposed,
        "previous_snapshot": previous,
        "changes": _diff_changes(previous=previous, proposed=proposed),
        "employee_note": employee_note,
        "reviewed_by": reviewed_by,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "review_note": review_note,
        "created_at": created_at.isoformat() if created_at else None,
    }


def list_profile_change_requests(
    *,
    tenant_id: int,
    conn: Any,
    status: str | None = None,
    employee_id: int | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = """
        SELECT r.id, r.employee_id, e.first_name, e.last_name,
               r.status, r.proposed_changes, r.previous_snapshot,
               r.employee_note, r.reviewed_by, r.reviewed_at, r.review_note, r.created_at
        FROM employee_profile_change_requests r
        JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
        WHERE r.tenant_id = %s
    """
    params: list[Any] = [tenant_id]
    if status:
        if status not in REQUEST_STATUSES:
            raise ValueError("Invalid status filter")
        query += " AND r.status = %s"
        params.append(status)
    if employee_id is not None:
        query += " AND r.employee_id = %s"
        params.append(employee_id)
    query += " ORDER BY r.created_at DESC LIMIT %s"
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(query, params)
        return [_serialize_row(row) for row in cur.fetchall()]


def count_pending_profile_change_requests(*, tenant_id: int, conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM employee_profile_change_requests
            WHERE tenant_id = %s AND status = 'pending'
            """,
            (tenant_id,),
        )
        return int(cur.fetchone()[0])


def get_current_details(*, tenant_id: int, employee_id: int, conn: Any) -> dict[str, Any]:
    from modules.employees.service import get_employee_row

    row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not row:
        raise LookupError("Employee not found")
    snapshot = _snapshot_from_row(row)
    return {
        "employee_id": employee_id,
        "fields": snapshot,
        "field_labels": {key: FIELD_LABELS[key] for key in EMPLOYEE_EDITABLE_FIELDS},
    }


def create_profile_change_request(
    *,
    tenant_id: int,
    employee_id: int,
    updates: dict[str, Any],
    employee_note: str | None,
    conn: Any,
) -> dict[str, Any]:
    from modules.employees.service import get_employee_row

    row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not row:
        raise LookupError("Employee not found")
    if row.get("status") not in {"active", "onboarding", "suspended"}:
        raise ValueError("Your account is not eligible to submit profile updates.")

    proposed = {
        key: _normalize_value(updates[key])
        for key in updates
        if key in EMPLOYEE_EDITABLE_FIELDS
    }
    if not proposed:
        raise ValueError("No valid fields to update.")

    previous = _snapshot_from_row(row)
    merged = {**previous, **proposed}
    changes = _diff_changes(previous=previous, proposed=merged)
    if not changes:
        raise ValueError("No changes detected — enter at least one updated value.")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM employee_profile_change_requests
            WHERE tenant_id = %s AND employee_id = %s AND status = 'pending'
            LIMIT 1
            """,
            (tenant_id, employee_id),
        )
        if cur.fetchone():
            raise ValueError("You already have a pending update waiting for HR approval.")

        cur.execute(
            """
            INSERT INTO employee_profile_change_requests (
              tenant_id, employee_id, status, proposed_changes, previous_snapshot, employee_note
            )
            VALUES (%s, %s, 'pending', %s::jsonb, %s::jsonb, %s)
            RETURNING id
            """,
            (
                tenant_id,
                employee_id,
                json.dumps(merged),
                json.dumps(previous),
                (employee_note or "").strip() or None,
            ),
        )
        request_id = int(cur.fetchone()[0])

    conn.commit()
    _notify_hr_new_request(tenant_id=tenant_id, employee_id=employee_id, request_id=request_id, conn=conn)
    items = list_profile_change_requests(
        tenant_id=tenant_id, conn=conn, employee_id=employee_id, limit=20
    )
    match = next((item for item in items if item["id"] == request_id), None)
    if not match:
        raise RuntimeError("Request created but could not be loaded")
    return match


def review_profile_change_request(
    *,
    tenant_id: int,
    request_id: int,
    decision: str,
    reviewed_by: str,
    review_note: str | None,
    conn: Any,
) -> dict[str, Any]:
    decision = decision.strip().lower()
    if decision not in {"approved", "rejected"}:
        raise ValueError("Decision must be approved or rejected.")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_id, status, proposed_changes
            FROM employee_profile_change_requests
            WHERE tenant_id = %s AND id = %s
            FOR UPDATE
            """,
            (tenant_id, request_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Profile change request not found")
        employee_id, status, proposed_raw = row
        if status != "pending":
            raise ValueError("Only pending requests can be reviewed.")
        proposed = proposed_raw if isinstance(proposed_raw, dict) else json.loads(proposed_raw or "{}")

    if decision == "approved":
        from modules.employees.repository import update_employee_fields
        from modules.employees.service import after_employee_updated, get_employee_row

        old_row = get_employee_row(tenant_id=tenant_id, employee_id=int(employee_id), conn=conn)
        if not old_row:
            raise LookupError("Employee not found")
        update_employee_fields(
            tenant_id=tenant_id,
            employee_id=int(employee_id),
            updates=proposed,
            conn=conn,
        )
        new_row = get_employee_row(tenant_id=tenant_id, employee_id=int(employee_id), conn=conn)
        if new_row:
            after_employee_updated(
                tenant_id=tenant_id,
                employee_id=int(employee_id),
                old_row=old_row,
                new_row=new_row,
                actor_username=reviewed_by,
                actor_role="hr",
                conn=conn,
                reason="Approved employee profile change request",
            )

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE employee_profile_change_requests
            SET status = %s,
                reviewed_by = %s,
                reviewed_at = NOW(),
                review_note = %s,
                updated_at = NOW()
            WHERE tenant_id = %s AND id = %s
            """,
            (
                decision,
                reviewed_by.strip(),
                (review_note or "").strip() or None,
                tenant_id,
                request_id,
            ),
        )
    conn.commit()
    _notify_employee_decision(
        tenant_id=tenant_id,
        employee_id=int(employee_id),
        request_id=request_id,
        decision=decision,
        review_note=review_note,
        conn=conn,
    )
    items = list_profile_change_requests(tenant_id=tenant_id, conn=conn, limit=500)
    match = next((item for item in items if item["id"] == request_id), None)
    if not match:
        raise RuntimeError("Request updated but could not be loaded")
    return match


def cancel_profile_change_request(
    *,
    tenant_id: int,
    request_id: int,
    employee_id: int,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE employee_profile_change_requests
            SET status = 'cancelled', updated_at = NOW()
            WHERE tenant_id = %s AND id = %s AND employee_id = %s AND status = 'pending'
            RETURNING id
            """,
            (tenant_id, request_id, employee_id),
        )
        if not cur.fetchone():
            raise LookupError("Pending profile change request not found")
    conn.commit()
    items = list_profile_change_requests(
        tenant_id=tenant_id, conn=conn, employee_id=employee_id, limit=20
    )
    match = next((item for item in items if item["id"] == request_id), None)
    if not match:
        raise RuntimeError("Request cancelled but could not be loaded")
    return match


def _notify_hr_new_request(
    *,
    tenant_id: int,
    employee_id: int,
    request_id: int,
    conn: Any,
) -> None:
    from admin_service import get_tenant_profile
    from core.email_templates import profile_change_hr_alert_email
    from core.notifications import send_email_content

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    to_email = profile.get("billing_email") or profile.get("signatory_email")
    if not to_email:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT username FROM app_users
                WHERE tenant_id = %s AND role = 'hr' AND is_active = TRUE
                ORDER BY username LIMIT 1
                """,
                (tenant_id,),
            )
            hr_row = cur.fetchone()
            to_email = hr_row[0] if hr_row else None
    if not to_email:
        return

    items = list_profile_change_requests(tenant_id=tenant_id, conn=conn, employee_id=employee_id, limit=5)
    item = next((row for row in items if row["id"] == request_id), None)
    if not item:
        return

    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    content = profile_change_hr_alert_email(
        tenant_name=profile.get("trading_name") or profile.get("name") or "Your business",
        employee_name=item["employee_name"],
        changes=item.get("changes") or [],
        admin_url=f"{app_url}/admin.html#profile-changes",
    )
    send_email_content(
        conn=conn,
        tenant_id=tenant_id,
        content=content,
        purpose="general",
        to=str(to_email),
        audience="hr",
        deliver_now=True,
        commit=False,
    )


def _notify_employee_decision(
    *,
    tenant_id: int,
    employee_id: int,
    request_id: int,
    decision: str,
    review_note: str | None,
    conn: Any,
) -> None:
    from core.email_templates import profile_change_employee_decision_email
    from core.notifications import send_email_content
    from modules.employees.service import get_employee_row

    row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not row or not row.get("email"):
        return

    items = list_profile_change_requests(tenant_id=tenant_id, conn=conn, employee_id=employee_id, limit=10)
    item = next((r for r in items if r["id"] == request_id), None)
    if not item:
        return

    from modules.employees.notification_branding import employee_notification_from_name

    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    content = profile_change_employee_decision_email(
        employee_name=(row.get("first_name") or "").strip() or "there",
        tenant_name=tenant_name,
        approved=decision == "approved",
        review_note=review_note,
        portal_url=f"{app_url}/employee.html#my-details",
    )
    send_email_content(
        conn=conn,
        tenant_id=tenant_id,
        content=content,
        purpose="general",
        to=str(row["email"]),
        audience="employee",
        deliver_now=True,
        commit=False,
    )
