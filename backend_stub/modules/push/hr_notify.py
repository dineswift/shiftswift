"""HR push + in-app notification triggers."""

from __future__ import annotations

from typing import Any

from modules.push.service import app_url_path, broadcast_admin_push


def _hr_allows_push(preferences: dict[str, str], event_id: str) -> bool:
    delivery = preferences.get(event_id, "email")
    return delivery in {"push", "email_push"}


def notify_hr_missed_punch(
    *,
    tenant_id: int,
    shift_label: str,
    employee_name: str,
    shift_id: int,
    preferences: dict[str, str],
    conn: Any,
) -> dict[str, Any]:
    if not _hr_allows_push(preferences, "missed_punch_hr"):
        return {"sent": 0, "skipped": "push_disabled"}
    return broadcast_admin_push(
        tenant_id=tenant_id,
        notification_key=f"missed_punch_hr:{shift_id}",
        title="Missed clock-in",
        body=f"{employee_name} has not clocked in for {shift_label}.",
        url=app_url_path("admin.html#time-punch"),
        tag=f"hr-missed-punch-{shift_id}",
        alert_type="missed_punch_hr",
        conn=conn,
    )


def notify_hr_leave_request(
    *,
    tenant_id: int,
    employee_name: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    request_id: int,
    preferences: dict[str, str],
    conn: Any,
) -> dict[str, Any]:
    if not _hr_allows_push(preferences, "leave_request_hr"):
        return {"sent": 0, "skipped": "push_disabled"}
    label = leave_type.replace("_", " ").title()
    return broadcast_admin_push(
        tenant_id=tenant_id,
        notification_key=f"leave_request_hr:{request_id}",
        title="New leave request",
        body=f"{employee_name} requested {label} ({start_date} → {end_date}).",
        url=app_url_path("admin.html#leave"),
        tag=f"hr-leave-{request_id}",
        alert_type="leave_request",
        conn=conn,
    )
