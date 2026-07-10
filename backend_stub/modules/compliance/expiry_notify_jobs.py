"""Dispatch RTW / visa / document expiry and monthly Home Office SMS login reminders."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from modules.compliance.audit_export import evaluate_rtw_expiry_alerts, evaluate_visa_expiry_alerts
from modules.documents.service import list_expiring_documents
from modules.employees.notification_branding import employee_notification_from_name
from modules.push.hr_notify import (
    notify_hr_document_expiry,
    notify_hr_rtw_expiry,
    notify_hr_sms_login_reminder,
)
from modules.push.service import app_url_path, send_employee_push

UK_TZ = ZoneInfo("Europe/London")
DOC_THRESHOLDS = frozenset({90, 60, 30, 14, 7})
ID_CATEGORIES = frozenset({"id", "passport", "visa", "right_to_work", "rtw", "identity"})


def _prefs(tenant_id: int, conn: Any) -> dict[str, str]:
    from admin_service import get_notification_preferences

    return get_notification_preferences(tenant_id=tenant_id, conn=conn)["preferences"]


def _employee_name(conn: Any, tenant_id: int, employee_id: int) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), '')
            FROM employees
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
    return (row[0] if row and row[0] else f"Employee #{employee_id}") or f"Employee #{employee_id}"


def _notify_employee_visa(
    *,
    tenant_id: int,
    employee_id: int,
    employee_name: str,
    expiry_date: str,
    days: int,
    conn: Any,
) -> dict[str, Any]:
    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    first = (employee_name or "there").split()[0]
    push = send_employee_push(
        tenant_id=tenant_id,
        employee_id=employee_id,
        notification_key=f"visa_expiry_employee:{employee_id}:{days}",
        title=f"Visa expires in {days} days",
        body=f"Your visa expires on {expiry_date}. Please speak to HR about renewal.",
        url=app_url_path("employee.html#my-details"),
        tag=f"visa-{employee_id}-{days}",
        alert_type="visa_expiry",
        conn=conn,
    )
    email_sent = 0
    with conn.cursor() as cur:
        cur.execute(
            "SELECT email FROM employees WHERE tenant_id = %s AND id = %s",
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
    email = (row[0] or "").strip() if row else ""
    if email:
        from core.email_templates import employee_visa_expiry_email
        from core.notifications import send_email_content

        content = employee_visa_expiry_email(
            employee_name=first,
            tenant_name=tenant_name,
            expiry_date=expiry_date,
            days_until_expiry=days,
        )
        send_email_content(
            conn=conn,
            tenant_id=tenant_id,
            content=content,
            purpose="compliance",
            to=email,
            audience="employee",
            deliver_now=True,
            commit=False,
        )
        email_sent = 1
    return {"push": push, "email_sent": email_sent}


def _notify_employee_document(
    *,
    tenant_id: int,
    employee_id: int,
    employee_name: str,
    document_title: str,
    expiry_date: str,
    days: int,
    document_key: str,
    conn: Any,
) -> dict[str, Any]:
    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    first = (employee_name or "there").split()[0]
    push = send_employee_push(
        tenant_id=tenant_id,
        employee_id=employee_id,
        notification_key=f"document_expiry_employee:{document_key}:{days}",
        title=f"Document expires in {days} days",
        body=f"“{document_title}” expires on {expiry_date}. Contact HR if you need to renew it.",
        url=app_url_path("employee.html#documents"),
        tag=f"doc-{document_key}-{days}",
        alert_type="document_expiry",
        conn=conn,
    )
    email_sent = 0
    with conn.cursor() as cur:
        cur.execute(
            "SELECT email FROM employees WHERE tenant_id = %s AND id = %s",
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
    email = (row[0] or "").strip() if row else ""
    if email:
        from core.email_templates import employee_document_expiry_email
        from core.notifications import send_email_content

        content = employee_document_expiry_email(
            employee_name=first,
            tenant_name=tenant_name,
            document_title=document_title,
            expiry_date=expiry_date,
            days_until_expiry=days,
        )
        send_email_content(
            conn=conn,
            tenant_id=tenant_id,
            content=content,
            purpose="compliance",
            to=email,
            audience="employee",
            deliver_now=True,
            commit=False,
        )
        email_sent = 1
    return {"push": push, "email_sent": email_sent}


def dispatch_rtw_expiry_alerts(*, tenant_id: int, as_of: date, conn: Any) -> list[dict[str, Any]]:
    alerts = evaluate_rtw_expiry_alerts(tenant_id=tenant_id, as_of=as_of, conn=conn)
    if not alerts:
        return []
    prefs = _prefs(tenant_id, conn)
    sent: list[dict[str, Any]] = []
    for alert in alerts:
        employee_id = int(alert["employee_id"])
        name = _employee_name(conn, tenant_id, employee_id)
        result = notify_hr_rtw_expiry(
            tenant_id=tenant_id,
            employee_name=name,
            expiry_date=str(alert["expiry_date"]),
            days_until_expiry=int(alert["days_until_expiry"]),
            rtw_check_id=int(alert["rtw_check_id"]),
            preferences=prefs,
            conn=conn,
        )
        if result.get("sent"):
            sent.append({"type": "rtw_expiry", **alert, **result})
    try:
        conn.commit()
    except Exception:
        pass
    return sent


def dispatch_visa_expiry_alerts(*, tenant_id: int, as_of: date, conn: Any) -> list[dict[str, Any]]:
    """Visa emails are queued inside evaluate_visa_expiry_alerts; also push HR + employee."""
    from modules.push.service import broadcast_admin_push

    alerts = evaluate_visa_expiry_alerts(tenant_id=tenant_id, as_of=as_of, conn=conn)
    if not alerts:
        return []
    prefs = _prefs(tenant_id, conn)
    sent: list[dict[str, Any]] = []
    for alert in alerts:
        employee_id = int(alert["employee_id"])
        name = str(alert.get("employee_name") or _employee_name(conn, tenant_id, employee_id))
        days = int(alert["days_until_expiry"])
        expiry = str(alert["visa_expiry_date"])
        hr_push: dict[str, Any] = {"sent": 0}
        pref_key = "visa_expiry" if "visa_expiry" in prefs else "rtw_expiry"
        if prefs.get(pref_key, "email") in {"push", "email_push"}:
            hr_push = broadcast_admin_push(
                tenant_id=tenant_id,
                notification_key=f"visa_expiry_hr:{employee_id}:{days}",
                title=f"Visa expires in {days} days",
                body=f"{name}'s visa expires on {expiry}.",
                url=app_url_path("admin.html#compliance"),
                tag=f"hr-visa-{employee_id}-{days}",
                alert_type="visa_expiry",
                conn=conn,
            )
        emp = _notify_employee_visa(
            tenant_id=tenant_id,
            employee_id=employee_id,
            employee_name=name,
            expiry_date=expiry,
            days=days,
            conn=conn,
        )
        sent.append({"type": "visa_expiry", **alert, "hr_push": hr_push, "employee": emp})
    try:
        conn.commit()
    except Exception:
        pass
    return sent


def dispatch_document_expiry_alerts(*, tenant_id: int, as_of: date, conn: Any) -> list[dict[str, Any]]:
    pack = list_expiring_documents(tenant_id=tenant_id, conn=conn, as_of=as_of, limit=500)
    items = pack.get("items") or []
    prefs = _prefs(tenant_id, conn)
    sent: list[dict[str, Any]] = []
    for item in items:
        days = item.get("days_until_expiry")
        try:
            days_int = int(days)
        except (TypeError, ValueError):
            continue
        if days_int not in DOC_THRESHOLDS:
            continue
        category = str(item.get("category") or "").strip().lower()
        title = str(item.get("title") or "Document")
        # Prefer ID / passport / visa style docs; still alert on any doc hitting a threshold.
        if category and category not in ID_CATEGORIES and "id" not in category and "visa" not in category:
            # Still notify for any expiring employee document at thresholds
            if not item.get("employee_id"):
                continue
        expiry = str(item.get("expires_at") or "")[:10]
        if not expiry:
            continue
        scope = str(item.get("scope") or "employee")
        doc_id = item.get("id")
        document_key = f"{scope}:{doc_id}"
        employee_id = item.get("employee_id")
        employee_name = item.get("employee_name") or (
            _employee_name(conn, tenant_id, int(employee_id)) if employee_id else None
        )
        hr = notify_hr_document_expiry(
            tenant_id=tenant_id,
            document_title=title,
            employee_name=employee_name,
            expiry_date=expiry,
            days_until_expiry=days_int,
            document_key=document_key,
            preferences=prefs,
            conn=conn,
        )
        emp: dict[str, Any] = {}
        if employee_id:
            emp = _notify_employee_document(
                tenant_id=tenant_id,
                employee_id=int(employee_id),
                employee_name=str(employee_name or "there"),
                document_title=title,
                expiry_date=expiry,
                days=days_int,
                document_key=document_key,
                conn=conn,
            )
        if hr.get("sent") or emp.get("email_sent") or (emp.get("push") or {}).get("sent"):
            sent.append(
                {
                    "type": "document_expiry",
                    "document_key": document_key,
                    "days": days_int,
                    "hr": hr,
                    "employee": emp,
                }
            )
    try:
        conn.commit()
    except Exception:
        pass
    return sent


def dispatch_sms_login_reminder(*, tenant_id: int, now: datetime | None = None, conn: Any) -> dict[str, Any]:
    """Send once per calendar month (UK) during morning hours."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    local = now.astimezone(UK_TZ)
    # First 3 days of the month, 08:00–11:59 UK — cron every 15m will dedupe via notification_key
    if local.day > 3 or local.hour < 8 or local.hour > 11:
        return {"sent": 0, "skipped": "outside_window"}
    prefs = _prefs(tenant_id, conn)
    month_key = local.strftime("%Y-%m")
    result = notify_hr_sms_login_reminder(
        tenant_id=tenant_id,
        month_key=month_key,
        preferences=prefs,
        conn=conn,
    )
    try:
        conn.commit()
    except Exception:
        pass
    return result
