"""Employee document share notifications."""

from __future__ import annotations

import re
from typing import Any

from core.notifications import send_email_content
from modules.push.service import app_url_path, send_employee_push

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _looks_like_email(value: str | None) -> bool:
    return bool(value and _EMAIL_RE.match(str(value).strip()))


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
        notification_key=f"document_shared:{document_id}",
        title=push_title,
        body=push_body,
        url=app_url_path(portal_path),
        tag=f"document-{document_id}",
        conn=conn,
    )

    if commit:
        conn.commit()
    return email_sent
