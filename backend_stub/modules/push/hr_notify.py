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


def notify_hr_missed_clock_out(
    *,
    tenant_id: int,
    shift_label: str,
    employee_name: str,
    shift_id: int,
    tenant_name: str,
    minutes_after_end: int,
    preferences: dict[str, str],
    conn: Any,
) -> dict[str, Any]:
    """Alert HR when an employee is still clocked in after shift end."""
    from modules.push.service import app_url_path, broadcast_admin_push

    # Reuse missed_punch_hr delivery preference (same attendance family).
    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}
    title = "Missed clock-out"
    body = (
        f"{employee_name} is still clocked in {minutes_after_end} minutes after "
        f"{shift_label}."
    )

    if _hr_allows_email(preferences, "missed_punch_hr"):
        from core.email_templates import missed_clock_out_hr_email

        content = missed_clock_out_hr_email(
            tenant_name=tenant_name,
            employee_name=employee_name,
            shift_label=shift_label,
            minutes_after_end=minutes_after_end,
        )
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="compliance",
            payload={"shift_id": shift_id, "type": "missed_clock_out"},
        )

    if _hr_allows_push(preferences, "missed_punch_hr"):
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"missed_clock_out_hr:{shift_id}",
            title=title,
            body=body,
            url=app_url_path("admin.html#time-punch"),
            tag=f"hr-missed-out-{shift_id}",
            alert_type="missed_clock_out_hr",
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


def notify_hr_rtw_expiry(
    *,
    tenant_id: int,
    employee_name: str,
    expiry_date: str,
    days_until_expiry: int,
    rtw_check_id: int,
    preferences: dict[str, str],
    conn: Any,
    tenant_name: str | None = None,
) -> dict[str, Any]:
    from modules.push.service import app_url_path, broadcast_admin_push

    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}
    title = f"RTW expires in {days_until_expiry} days"
    body = f"{employee_name}'s right-to-work check expires on {expiry_date}."

    if _hr_allows_email(preferences, "rtw_expiry"):
        from core.email_templates import rtw_expiry_hr_email
        from core.notifications import fetch_tenant_contacts

        contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
        resolved = tenant_name or contacts.get("tenant_name") or "Your organisation"
        content = rtw_expiry_hr_email(
            tenant_name=str(resolved),
            employee_name=employee_name,
            expiry_date=expiry_date,
            days_until_expiry=days_until_expiry,
        )
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="compliance",
            payload={"rtw_check_id": rtw_check_id, "days": days_until_expiry},
        )

    if _hr_allows_push(preferences, "rtw_expiry"):
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"rtw_expiry:{rtw_check_id}:{days_until_expiry}",
            title=title,
            body=body,
            url=app_url_path("admin.html#compliance"),
            tag=f"hr-rtw-{rtw_check_id}-{days_until_expiry}",
            alert_type="rtw_expiry",
            conn=conn,
        )

    return {
        "email": email_result,
        "push": push_result,
        "sent": int(email_result.get("sent") or 0) + int(push_result.get("sent") or 0),
    }


def notify_hr_visa_expiry(
    *,
    tenant_id: int,
    employee_name: str,
    expiry_date: str,
    days_until_expiry: int,
    employee_id: int,
    preferences: dict[str, str],
    conn: Any,
    tenant_name: str | None = None,
) -> dict[str, Any]:
    from modules.push.service import app_url_path, broadcast_admin_push

    pref_key = "visa_expiry" if "visa_expiry" in preferences else "rtw_expiry"
    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}
    title = f"Visa expires in {days_until_expiry} days"
    body = f"{employee_name}'s visa expires on {expiry_date}."

    if _hr_allows_email(preferences, pref_key):
        from core.email_templates import visa_expiry_hr_email
        from core.notifications import fetch_tenant_contacts

        contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
        resolved = tenant_name or contacts.get("tenant_name") or "Your organisation"
        content = visa_expiry_hr_email(
            tenant_name=str(resolved),
            employee_name=employee_name,
            expiry_date=expiry_date,
            days_until_expiry=days_until_expiry,
        )
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="compliance",
            payload={"employee_id": employee_id, "days": days_until_expiry, "type": "visa_expiry"},
        )

    if _hr_allows_push(preferences, pref_key):
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"visa_expiry_hr:{employee_id}:{days_until_expiry}",
            title=title,
            body=body,
            url=app_url_path("admin.html#compliance"),
            tag=f"hr-visa-{employee_id}-{days_until_expiry}",
            alert_type="visa_expiry",
            conn=conn,
        )

    return {
        "email": email_result,
        "push": push_result,
        "sent": int(email_result.get("sent") or 0) + int(push_result.get("sent") or 0),
    }


def notify_hr_document_expiry(
    *,
    tenant_id: int,
    document_title: str,
    employee_name: str | None,
    expiry_date: str,
    days_until_expiry: int,
    document_key: str,
    preferences: dict[str, str],
    conn: Any,
    tenant_name: str | None = None,
) -> dict[str, Any]:
    from modules.push.service import app_url_path, broadcast_admin_push

    pref_key = "document_expiry" if "document_expiry" in preferences else "rtw_expiry"
    who = employee_name or "Organisation"
    title = f"Document expires in {days_until_expiry} days"
    body = f"{who}: “{document_title}” expires on {expiry_date}."
    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}

    if _hr_allows_email(preferences, pref_key):
        from core.email_templates import document_expiry_hr_email
        from core.notifications import fetch_tenant_contacts

        contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
        resolved = tenant_name or contacts.get("tenant_name") or "Your organisation"
        content = document_expiry_hr_email(
            tenant_name=str(resolved),
            document_title=document_title,
            employee_name=who,
            expiry_date=expiry_date,
            days_until_expiry=days_until_expiry,
        )
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="compliance",
            payload={"document_key": document_key, "days": days_until_expiry},
        )

    if _hr_allows_push(preferences, pref_key):
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"document_expiry:{document_key}:{days_until_expiry}",
            title=title,
            body=body,
            url=app_url_path("admin.html#documents"),
            tag=f"hr-doc-{document_key}-{days_until_expiry}",
            alert_type="document_expiry",
            conn=conn,
        )

    return {
        "email": email_result,
        "push": push_result,
        "sent": int(email_result.get("sent") or 0) + int(push_result.get("sent") or 0),
    }


def notify_hr_sms_login_reminder(
    *,
    tenant_id: int,
    month_key: str,
    preferences: dict[str, str],
    conn: Any,
    tenant_name: str | None = None,
) -> dict[str, Any]:
    """Monthly nudge to log into the Home Office Sponsor Management System (SMS)."""
    from modules.push.service import app_url_path, broadcast_admin_push

    delivery = preferences.get("sms_login_reminder", "email_push")
    if delivery == "off":
        return {"sent": 0, "skipped": "off"}

    email_result: dict[str, Any] = {"sent": 0}
    push_result: dict[str, Any] = {"sent": 0}
    title = "Monthly SMS login reminder"
    body = (
        "Log into the Home Office Sponsor Management System (SMS) this month "
        "to review your sponsor licence duties and reporting."
    )

    allows_email = delivery in {"email", "email_push"}
    allows_push = delivery in {"push", "email_push"}

    if allows_email:
        from core.email_templates import sms_login_reminder_hr_email
        from core.notifications import fetch_tenant_contacts

        contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
        resolved = tenant_name or contacts.get("tenant_name") or "Your organisation"
        content = sms_login_reminder_hr_email(tenant_name=str(resolved))
        email_result = _send_hr_email(
            tenant_id=tenant_id,
            conn=conn,
            content=content,
            purpose="compliance",
            payload={"type": "sms_login_reminder", "month": month_key},
        )

    if allows_push:
        push_result = broadcast_admin_push(
            tenant_id=tenant_id,
            notification_key=f"sms_login_reminder:{month_key}",
            title=title,
            body=body,
            url=app_url_path("admin.html#compliance"),
            tag=f"hr-sms-login-{month_key}",
            alert_type="sms_login_reminder",
            conn=conn,
        )

    return {
        "email": email_result,
        "push": push_result,
        "sent": int(email_result.get("sent") or 0) + int(push_result.get("sent") or 0),
    }
