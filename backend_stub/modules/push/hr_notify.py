"""HR push + email + in-app notification triggers."""

from __future__ import annotations

from typing import Any


def _hr_allows_email(preferences: dict[str, str], event_id: str) -> bool:
    delivery = preferences.get(event_id, "email")
    return delivery in {"email", "email_push"}


def _hr_allows_push(preferences: dict[str, str], event_id: str) -> bool:
    delivery = preferences.get(event_id, "email")
    return delivery in {"push", "email_push"}


def _send_hr_email(
    *,
    tenant_id: int,
    conn: Any,
    content: Any,
    purpose: str = "hr",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from core.notifications import (
        email_delivered,
        fetch_tenant_contacts,
        resolve_email_recipient,
        send_email_content,
    )

    contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
    to = resolve_email_recipient(purpose=purpose, contacts=contacts)
    if not to:
        return {"sent": 0, "skipped": "no_recipient"}
    delivery = send_email_content(
        conn=conn,
        tenant_id=tenant_id,
        to=to,
        content=content,
        purpose=purpose,
        audience="hr",
        payload=payload,
        deliver_now=True,
        commit=False,
    )
    if email_delivered(delivery):
        return {"sent": 1, "to": to}
    return {
        "sent": 0,
        "skipped": "delivery_failed",
        "delivery_error": delivery.get("delivery_error"),
    }


def notify_hr_missed_punch(
    *,
    tenant_id: int,
    shift_label: str,
    employee_name: str,
    shift_id: int,
    tenant_name: str,
    role_label: str,
    grace_minutes: int,
    preferences: dict[str, str],
    conn: Any,
    alert_id: int | None = None,
) -> dict[str, Any]:
    from modules.push.service import app_url_path, broadcast_admin_push

    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}

    if _hr_allows_email(preferences, "missed_punch_hr"):
        from core.email_templates import missed_punch_hr_email

        content = missed_punch_hr_email(
            tenant_name=tenant_name,
            employee_name=employee_name,
            shift_label=shift_label,
            role_label=role_label,
            grace_minutes=grace_minutes,
        )
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="compliance",
            payload={"alert_id": alert_id, "shift_id": shift_id},
        )

    if _hr_allows_push(preferences, "missed_punch_hr"):
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"missed_punch_hr:{shift_id}",
            title="Missed clock-in",
            body=f"{employee_name} has not clocked in for {shift_label}.",
            url=app_url_path("admin.html#time-punch"),
            tag=f"hr-missed-punch-{shift_id}",
            alert_type="missed_punch_hr",
            conn=conn,
        )

    return {
        "email": email_result,
        "push": push_result,
        "sent": int(email_result.get("sent") or 0) + int(push_result.get("sent") or 0),
    }


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
    tenant_name: str | None = None,
) -> dict[str, Any]:
    from modules.push.service import app_url_path, broadcast_admin_push

    label = leave_type.replace("_", " ").title()
    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}

    if _hr_allows_email(preferences, "leave_request_hr"):
        from core.email_templates import leave_request_hr_email

        resolved_tenant_name = tenant_name
        if not resolved_tenant_name:
            from core.notifications import fetch_tenant_contacts

            contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
            resolved_tenant_name = contacts.get("tenant_name") or "Your organisation"
        content = leave_request_hr_email(
            tenant_name=str(resolved_tenant_name),
            employee_name=employee_name,
            leave_type=label,
            start_date=start_date,
            end_date=end_date,
        )
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="hr",
            payload={"leave_request_id": request_id},
        )

    if _hr_allows_push(preferences, "leave_request_hr"):
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"leave_request_hr:{request_id}",
            title="New leave request",
            body=f"{employee_name} requested {label} ({start_date} → {end_date}).",
            url=app_url_path("admin.html#leave"),
            tag=f"hr-leave-{request_id}",
            alert_type="leave_request",
            conn=conn,
        )

    return {
        "email": email_result,
        "push": push_result,
        "sent": int(email_result.get("sent") or 0) + int(push_result.get("sent") or 0),
    }
