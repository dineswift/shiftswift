"""Upload a document to one or all active employees, with optional email."""

from __future__ import annotations

from typing import Any

from modules.documents.constants import EMPLOYEE_DOCUMENT_CATEGORY_LABELS
from modules.documents.service import create_employee_document, update_employee_document
from modules.documents.storage import write_document_file

ACTIVE_EMPLOYEE_STATUSES = frozenset({"active", "onboarding"})


def _load_target_employees(
    *,
    tenant_id: int,
    employee_id: int | None,
    conn: Any,
) -> list[dict[str, Any]]:
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
    employees = [
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
    if employee_id is not None and not employees:
        raise ValueError("Employee not found")
    if employee_id is None and not employees:
        raise ValueError("No active employees to receive this document")
    return employees


def distribute_document(
    *,
    tenant_id: int,
    file_bytes: bytes,
    content_type: str,
    ext: str,
    original_filename: str | None,
    title: str,
    category: str,
    pay_period: str | None,
    notes: str | None,
    employee_id: int | None,
    send_email: bool,
    uploaded_by: str,
    conn: Any,
) -> dict[str, Any]:
    """Create per-employee document records and optionally notify by email."""
    employees = _load_target_employees(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if category == "payslip" and not pay_period:
        raise ValueError("Pay period is required for payslip uploads (e.g. 2026-04 or April 2026)")

    created: list[dict[str, Any]] = []
    emails_sent = 0
    emails_skipped = 0

    for employee in employees:
        doc = create_employee_document(
            tenant_id=tenant_id,
            employee_id=int(employee["id"]),
            data={
                "title": title.strip(),
                "category": category,
                "lifecycle_stage": "document_store",
                "notes": notes or "File stored on ShiftSwift HR",
                "pay_period": pay_period,
                "original_filename": original_filename,
            },
            uploaded_by=uploaded_by,
            conn=conn,
        )
        storage_path, content_sha256, file_size = write_document_file(
            tenant_id=tenant_id,
            document_id=int(doc["id"]),
            title=title.strip(),
            original_filename=original_filename,
            data=file_bytes,
            content_type=content_type,
            ext=ext,
            scope="employee",
            employee_id=int(employee["id"]),
        )
        doc = update_employee_document(
            tenant_id=tenant_id,
            employee_id=int(employee["id"]),
            document_id=int(doc["id"]),
            updates={
                "storage_path": storage_path,
                "content_sha256": content_sha256,
                "content_type": content_type,
                "file_size_bytes": file_size,
                "original_filename": original_filename,
            },
            conn=conn,
        )
        created.append(
            {
                "employee_id": employee["id"],
                "employee_name": f"{employee['first_name']} {employee['last_name']}".strip(),
                "document_id": doc["id"],
            }
        )

        from modules.documents.notifications import notify_employee_document_shared

        if notify_employee_document_shared(
            tenant_id=tenant_id,
            employee=employee,
            document_id=int(doc["id"]),
            document_title=title.strip(),
            category=category,
            category_label=EMPLOYEE_DOCUMENT_CATEGORY_LABELS.get(category, category),
            pay_period=pay_period,
            conn=conn,
            commit=False,
            send_email=send_email,
            document_scope="employee",
        ):
            emails_sent += 1
        elif send_email:
            emails_skipped += 1

    conn.commit()
    return {
        "distributed_count": len(created),
        "emails_sent": emails_sent,
        "emails_skipped": emails_skipped,
        "items": created,
        "message": f"Document sent to {len(created)} employee{'s' if len(created) != 1 else ''}",
    }
