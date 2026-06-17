"""Employee document share notifications."""

from __future__ import annotations

import re
from typing import Any

from core.notifications import send_email_content
from modules.documents.constants import EMPLOYEE_DOCUMENT_CATEGORY_LABELS
from modules.push.service import app_url_path, send_employee_push

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ACTIVE_EMPLOYEE_STATUSES = frozenset({"active", "onboarding"})


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
    with conn.cursor() as cur:
        if employee_id is not None:
            cur.execute(
                """
                SELECT id, first_name, last_name, email, email_notifications_enabled, status
                FROM employees
                WHERE tenant_id = %s AND id = %s
                """,
                (tenant_id, employee_id),
            )
        elif employee_ids:
            cur.execute(
                """
                SELECT id, first_name, last_name, email, email_notifications_enabled, status
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
                """
                SELECT id, first_name, last_name, email, email_notifications_enabled, status
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
) -> bool:
    """Notify the employee when HR shares a document. Returns True if email sent."""
    from core.email_templates import employee_document_shared_email
    from modules.employees.notification_branding import employee_notification_from_name

    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    employee_name = f"{employee.get('first_name', '')} {employee.get('last_name', '')}".strip() or "there"
    employee_id = int(employee["id"])

    email_sent = False
    if send_email and employee.get("email_notifications_enabled", True):
        email = employee.get("email")
        if _looks_like_email(email):
            content = employee_document_shared_email(
                employee_name=employee_name,
                document_title=document_title,
                category_label=category_label,
                pay_period=pay_period if category == "payslip" else None,
                tenant_name=tenant_name,
            )
            send_email_content(
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
            email_sent = True

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

    send_employee_push(
        tenant_id=tenant_id,
        employee_id=employee_id,
        notification_key=f"document_shared:{document_scope}:{document_id}",
        title=push_title,
        body=push_body,
        url=app_url_path(portal_path),
        tag=f"document-{document_scope}-{document_id}",
        conn=conn,
    )

    if commit:
        conn.commit()
    return email_sent


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
) -> dict[str, int]:
    """Notify one or more employees about a shared document."""
    category_label = EMPLOYEE_DOCUMENT_CATEGORY_LABELS.get(category, category)
    emails_sent = 0
    emails_skipped = 0
    for employee in employees:
        if notify_employee_document_shared(
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
        ):
            emails_sent += 1
        elif send_email:
            emails_skipped += 1

    if commit:
        conn.commit()
    return {
        "notified_count": len(employees),
        "emails_sent": emails_sent,
        "emails_skipped": emails_skipped,
    }
