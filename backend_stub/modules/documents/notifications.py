"""Employee document share notifications."""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from core.notifications import email_delivered, send_email_content
from modules.documents.constants import EMPLOYEE_DOCUMENT_CATEGORY_LABELS
from modules.documents.errors import _rollback_quietly
from modules.documents.service import _table_columns, get_employee_document, get_tenant_document
from modules.push.service import app_url_path, send_employee_push

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ACTIVE_EMPLOYEE_STATUSES = frozenset({"active", "onboarding"})
logger = logging.getLogger(__name__)


def _looks_like_email(value: str | None) -> bool:
    return bool(value and _EMAIL_RE.match(str(value).strip()))


def parse_employee_id_list(raw: str | None) -> list[int] | None:
    """Parse comma-separated employee ids; empty input means no explicit selection."""
    if raw is None:
        return None
    ids: list[int] = []
    for part in str(raw).split(","):
        piece = part.strip()
        if not piece:
            continue
        ids.append(int(piece))
    return ids or None


def load_document_notification_targets(
    *,
    tenant_id: int,
    employee_id: int | None = None,
    employee_ids: list[int] | None = None,
    conn: Any,
) -> list[dict[str, Any]]:
    """Load employees who should receive a document-share notification."""
    employee_columns = _table_columns(conn, "employees")
    email_pref_sql = (
        "email_notifications_enabled"
        if "email_notifications_enabled" in employee_columns
        else "TRUE AS email_notifications_enabled"
    )
    with conn.cursor() as cur:
        if employee_id is not None:
            cur.execute(
                f"""
                SELECT id, first_name, last_name, email, {email_pref_sql}, status
                FROM employees
                WHERE tenant_id = %s AND id = %s
                """,
                (tenant_id, employee_id),
            )
        elif employee_ids:
            cur.execute(
                f"""
                SELECT id, first_name, last_name, email, {email_pref_sql}, status
                FROM employees
                WHERE tenant_id = %s
                  AND id = ANY(%s)
                  AND status = ANY(%s)
                ORDER BY last_name, first_name
                """,
                (tenant_id, employee_ids, list(ACTIVE_EMPLOYEE_STATUSES)),
            )
        else:
            cur.execute(
                f"""
                SELECT id, first_name, last_name, email, {email_pref_sql}, status
                FROM employees
                WHERE tenant_id = %s AND status = ANY(%s)
                ORDER BY last_name, first_name
                """,
                (tenant_id, list(ACTIVE_EMPLOYEE_STATUSES)),
            )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "first_name": row[1],
            "last_name": row[2],
            "email": (row[3] or "").strip() or None,
            "email_notifications_enabled": bool(row[4]),
            "status": row[5],
        }
        for row in rows
    ]


def notify_employee_document_shared(
    *,
    tenant_id: int,
    employee: dict[str, Any],
    document_id: int,
    document_title: str,
    category: str,
    category_label: str,
    pay_period: str | None,
    conn: Any,
    commit: bool = True,
    send_email: bool = True,
    document_scope: str = "employee",
    resend: bool = False,
) -> dict[str, Any]:
    """Notify the employee when HR shares a document."""
    from core.email_templates import employee_document_shared_email
    from modules.employees.notification_branding import employee_notification_from_name

    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    employee_name = f"{employee.get('first_name', '')} {employee.get('last_name', '')}".strip() or "there"
    employee_id = int(employee["id"])
    result: dict[str, Any] = {
        "employee_id": employee_id,
        "name": employee_name,
        "email": employee.get("email"),
        "email_sent": False,
        "push_sent": 0,
        "skipped_reason": None,
        "error": None,
    }

    if send_email and employee.get("email_notifications_enabled", True):
        email = employee.get("email")
        if _looks_like_email(email):
            try:
                content = employee_document_shared_email(
                    employee_name=employee_name,
                    document_title=document_title,
                    category_label=category_label,
                    pay_period=pay_period if category == "payslip" else None,
                    tenant_name=tenant_name,
                )
                delivery = send_email_content(
                    conn=conn,
                    tenant_id=tenant_id,
                    content=content,
                    purpose="employee",
                    to=str(email),
                    audience="employee",
                    payload={
                        "type": "employee_document_shared",
                        "employee_id": employee_id,
                        "document_id": document_id,
                        "document_scope": document_scope,
                        "document_title": document_title,
                        "category": category,
                    },
                    deliver_now=True,
                    commit=False,
                )
                if email_delivered(delivery):
                    result["email_sent"] = True
                else:
                    result["error"] = str(delivery.get("delivery_error") or "Email delivery failed")
            except Exception as exc:
                logger.exception(
                    "Document share email failed for tenant %s employee %s document %s",
                    tenant_id,
                    employee_id,
                    document_id,
                )
                _rollback_quietly(conn)
                result["error"] = str(exc)
        else:
            result["skipped_reason"] = "no_valid_email"
    elif send_email and not employee.get("email_notifications_enabled", True):
        result["skipped_reason"] = "employee_email_disabled"
    elif not send_email:
        result["skipped_reason"] = "email_not_requested"

    if category == "payslip":
        portal_path = "employee.html#payslips"
        if pay_period:
            push_title = "New payslip available — ShiftSwift HR"
            push_body = f"Your {pay_period} payslip is available — tap to view."
        else:
            push_title = "New payslip available — ShiftSwift HR"
            push_body = f"Your payslip ({document_title}) is available — tap to view."
    else:
        portal_path = "employee.html#documents"
        push_title = "New document available — ShiftSwift HR"
        push_body = f"{document_title} is ready — tap to view in your portal."

    push_key = (
        f"document_shared_resend:{int(time.time())}:{document_scope}:{document_id}:{employee_id}"
        if resend
        else f"document_shared:{document_scope}:{document_id}"
    )
    try:
        push_result = send_employee_push(
            tenant_id=tenant_id,
            employee_id=employee_id,
            notification_key=push_key,
            title=push_title,
            body=push_body,
            url=app_url_path(portal_path),
            tag=f"document-{document_scope}-{document_id}",
            conn=conn,
        )
        result["push_sent"] = int(push_result.get("sent") or 0)
        if result["push_sent"] == 0 and push_result.get("skipped"):
            result["push_skip"] = str(push_result.get("skipped"))
    except Exception as exc:
        logger.exception(
            "Document share push failed for tenant %s employee %s document %s",
            tenant_id,
            employee_id,
            document_id,
        )
        _rollback_quietly(conn)
        result["push_error"] = str(exc)

    if commit:
        try:
            conn.commit()
        except Exception:
            _rollback_quietly(conn)
            raise
    return result


def notify_document_recipients(
    *,
    tenant_id: int,
    employees: list[dict[str, Any]],
    document_id: int,
    document_scope: str,
    document_title: str,
    category: str,
    pay_period: str | None,
    send_email: bool,
    conn: Any,
    commit: bool = False,
    resend: bool = False,
) -> dict[str, Any]:
    """Notify one or more employees about a shared document."""
    category_label = EMPLOYEE_DOCUMENT_CATEGORY_LABELS.get(category, category)
    emails_sent = 0
    emails_skipped = 0
    pushes_sent = 0
    email_failures: list[dict[str, Any]] = []
    for employee in employees:
        item = notify_employee_document_shared(
            tenant_id=tenant_id,
            employee=employee,
            document_id=document_id,
            document_title=document_title,
            category=category,
            category_label=category_label,
            pay_period=pay_period,
            conn=conn,
            commit=False,
            send_email=send_email,
            document_scope=document_scope,
            resend=resend,
        )
        if item.get("email_sent"):
            emails_sent += 1
        elif send_email:
            emails_skipped += 1
            if item.get("error") or item.get("skipped_reason"):
                email_failures.append(
                    {
                        "employee_id": item["employee_id"],
                        "name": item.get("name"),
                        "email": item.get("email"),
                        "error": item.get("error") or item.get("skipped_reason"),
                    }
                )
        pushes_sent += int(item.get("push_sent") or 0)

    if commit:
        conn.commit()
    return {
        "notified_count": len(employees),
        "emails_sent": emails_sent,
        "emails_skipped": emails_skipped,
        "pushes_sent": pushes_sent,
        "email_failures": email_failures,
        "resend": resend,
    }


def resend_document_share_notifications(
    *,
    tenant_id: int,
    document_id: int,
    document_scope: str,
    employee_id: int | None,
    employee_ids: list[int] | None,
    conn: Any,
    send_email: bool = True,
) -> dict[str, Any]:
    """Resend document-share email/push to one or more employees."""
    if document_scope == "employee":
        if employee_id is None:
            raise ValueError("employee_id is required for employee documents")
        doc = get_employee_document(
            tenant_id=tenant_id,
            employee_id=employee_id,
            document_id=document_id,
            conn=conn,
        )
        if not doc:
            raise LookupError("Document not found")
        if not doc.get("storage_path") and not doc.get("document_url"):
            raise ValueError("Upload a file or add a link before resending notifications")
        if not doc.get("employee_visible"):
            raise ValueError("Turn on employee portal visibility before resending notifications")
        targets = load_document_notification_targets(
            tenant_id=tenant_id,
            employee_id=employee_id,
            conn=conn,
        )
        pay_period = doc.get("pay_period")
    else:
        doc = get_tenant_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
        if not doc:
            raise LookupError("Document not found")
        if not doc.get("employee_visible"):
            raise ValueError("This document is not shared with employees")
        targets = load_document_notification_targets(
            tenant_id=tenant_id,
            employee_id=doc.get("employee_id") if employee_ids is None and doc.get("employee_id") else None,
            employee_ids=employee_ids,
            conn=conn,
        )
        pay_period = doc.get("pay_period")

    if not targets:
        raise ValueError("No employees selected to notify")

    result = notify_document_recipients(
        tenant_id=tenant_id,
        employees=targets,
        document_id=document_id,
        document_scope=document_scope,
        document_title=str(doc.get("title") or "Document"),
        category=str(doc.get("category") or "general"),
        pay_period=(str(pay_period).strip() if pay_period else None) or None,
        send_email=send_email,
        conn=conn,
        commit=True,
        resend=True,
    )
    sent = int(result.get("emails_sent") or 0)
    failed = len(result.get("email_failures") or [])
    result["message"] = (
        f"Resent to {sent} employee{'s' if sent != 1 else ''}."
        + (f" {failed} still failed." if failed else "")
    )
    return result
