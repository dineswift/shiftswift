"""Prevent duplicate employee records within a tenant."""

from __future__ import annotations

from typing import Any


class DuplicateEmployeeError(ValueError):
    """Raised when a create/update would duplicate an existing employee."""

    def __init__(
        self,
        message: str,
        *,
        conflict: str,
        existing_employee_id: int | None = None,
    ) -> None:
        super().__init__(message)
        self.conflict = conflict
        self.existing_employee_id = existing_employee_id

    def as_detail(self) -> dict[str, Any]:
        return {
            "message": str(self),
            "conflict": self.conflict,
            "existing_employee_id": self.existing_employee_id,
        }


def normalize_work_email(email: str | None) -> str | None:
    if email is None:
        return None
    cleaned = str(email).strip().lower()
    return cleaned or None


def normalize_name_part(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _format_existing_label(row: dict[str, Any]) -> str:
    name = f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip() or "Existing employee"
    parts = [name]
    if row.get("job_title"):
        parts.append(str(row["job_title"]))
    elif row.get("department"):
        parts.append(str(row["department"]))
    return " — ".join(parts)


def find_employee_email_conflict(
    *,
    tenant_id: int,
    email: str | None,
    conn: Any,
    exclude_employee_id: int | None = None,
) -> dict[str, Any] | None:
    norm_email = normalize_work_email(email)
    if not norm_email:
        return None

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, email, job_title, department, status
            FROM employees
            WHERE tenant_id = %s
              AND status <> 'terminated'
              AND email IS NOT NULL
              AND btrim(email) <> ''
              AND lower(btrim(email)) = %s
              AND (%s IS NULL OR id <> %s)
            LIMIT 1
            """,
            (tenant_id, norm_email, exclude_employee_id, exclude_employee_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "first_name": row[1],
        "last_name": row[2],
        "email": row[3],
        "job_title": row[4],
        "department": row[5],
        "status": row[6],
        "conflict": "email",
    }


def find_employee_name_conflict(
    *,
    tenant_id: int,
    first_name: str | None,
    last_name: str | None,
    conn: Any,
    exclude_employee_id: int | None = None,
) -> dict[str, Any] | None:
    norm_first = normalize_name_part(first_name)
    norm_last = normalize_name_part(last_name)
    if not norm_first or not norm_last:
        return None

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, email, job_title, department, status
            FROM employees
            WHERE tenant_id = %s
              AND status <> 'terminated'
              AND lower(btrim(first_name)) = %s
              AND lower(btrim(last_name)) = %s
              AND (%s IS NULL OR id <> %s)
            LIMIT 1
            """,
            (tenant_id, norm_first, norm_last, exclude_employee_id, exclude_employee_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "first_name": row[1],
        "last_name": row[2],
        "email": row[3],
        "job_title": row[4],
        "department": row[5],
        "status": row[6],
        "conflict": "name",
    }


def assert_no_duplicate_employee(
    *,
    tenant_id: int,
    conn: Any,
    first_name: str,
    last_name: str,
    email: str | None,
    exclude_employee_id: int | None = None,
) -> None:
    """Raise DuplicateEmployeeError if email or full name matches another active record."""
    email_conflict = find_employee_email_conflict(
        tenant_id=tenant_id,
        email=email,
        conn=conn,
        exclude_employee_id=exclude_employee_id,
    )
    if email_conflict:
        label = _format_existing_label(email_conflict)
        raise DuplicateEmployeeError(
            f"An employee with this work email already exists ({label}). "
            "Open their existing record instead of creating a duplicate.",
            conflict="email",
            existing_employee_id=email_conflict["id"],
        )

    name_conflict = find_employee_name_conflict(
        tenant_id=tenant_id,
        first_name=first_name,
        last_name=last_name,
        conn=conn,
        exclude_employee_id=exclude_employee_id,
    )
    if name_conflict:
        display_name = f"{first_name.strip()} {last_name.strip()}".strip()
        label = _format_existing_label(name_conflict)
        raise DuplicateEmployeeError(
            f"An employee named {display_name} already exists ({label}). "
            "If this is the same person, open their record instead of adding another.",
            conflict="name",
            existing_employee_id=name_conflict["id"],
        )
