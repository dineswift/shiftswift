"""Unified document store service."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from modules.documents.constants import (
    EMPLOYEE_DOCUMENT_REQUIREMENTS,
    EMPLOYEE_SELF_SERVICE_CATEGORIES,
    VALID_EMPLOYEE_CATEGORIES,
    VALID_EXPIRY_ALERT_DAYS,
    VALID_LIFECYCLE_STAGES,
    VALID_TENANT_CATEGORIES,
)

NI_PATTERN = re.compile(r"^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]?$", re.I)
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_email(value: str | None, *, field_label: str = "Email") -> None:
    if value is None or not str(value).strip():
        return
    if not EMAIL_PATTERN.match(str(value).strip()):
        raise ValueError(f"{field_label} format looks invalid")


def validate_ni_number(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    cleaned = re.sub(r"\s+", "", str(value).upper())
    if not NI_PATTERN.match(cleaned):
        raise ValueError("National Insurance number format looks invalid")
    return cleaned


def validate_information_fields(section: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Validate employee information sections before save."""
    validated = dict(updates)
    if section == "induction":
        if "ni_number" in validated:
            validated["ni_number"] = validate_ni_number(validated.get("ni_number"))
        if "date_of_birth" in validated and validated["date_of_birth"]:
            dob = validated["date_of_birth"]
            if isinstance(dob, str):
                dob = date.fromisoformat(dob)
            if dob > date.today():
                raise ValueError("Date of birth cannot be in the future")
        for phone_field in ("phone", "emergency_contact_phone"):
            if phone_field in validated and validated[phone_field]:
                digits = re.sub(r"\D", "", str(validated[phone_field]))
                if len(digits) < 10:
                    raise ValueError(f"{phone_field.replace('_', ' ').title()} looks too short")
    if section == "onboarding":
        start = validated.get("start_date")
        probation = validated.get("probation_end_date")
        if start and probation:
            if isinstance(start, str):
                start = date.fromisoformat(start)
            if isinstance(probation, str):
                probation = date.fromisoformat(probation)
            if probation < start:
                raise ValueError("Probation end date cannot be before start date")
        if "contract_hours_weekly" in validated:
            raw = validated["contract_hours_weekly"]
            if raw is None or raw == "":
                validated["contract_hours_weekly"] = None
            else:
                hours = float(raw)
                if hours < 0 or hours > 168:
                    raise ValueError("Contract hours must be between 0 and 168")
                validated["contract_hours_weekly"] = hours
    if section == "recruitment" and "email" in validated and validated["email"]:
        validate_email(validated["email"], field_label="Work email")
    return validated


def fetch_document_categories_by_employee(*, tenant_id: int, conn: Any) -> dict[int, list[str]]:
    """Map employee_id → distinct document categories (for completion summaries)."""
    from core.schema import table_columns

    if not table_columns(conn, "employee_documents"):
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_id, category
            FROM employee_documents
            WHERE tenant_id = %s
            """,
            (tenant_id,),
        )
        grouped: dict[int, set[str]] = {}
        for employee_id, category in cur.fetchall():
            grouped.setdefault(int(employee_id), set()).add(category)
    return {employee_id: sorted(categories) for employee_id, categories in grouped.items()}


def document_requirements(*, is_sponsored: bool) -> list[dict[str, Any]]:
    key = "sponsored" if is_sponsored else "standard"
    return [dict(item) for item in EMPLOYEE_DOCUMENT_REQUIREMENTS[key]]


def requirements_status(
    *,
    is_sponsored: bool,
    documents: list[dict[str, Any]],
) -> dict[str, Any]:
    requirements = document_requirements(is_sponsored=is_sponsored)
    present_categories = {doc.get("category") for doc in documents if doc.get("category")}
    items = []
    missing_required = 0
    for req in requirements:
        satisfied = req["category"] in present_categories
        if req["required"] and not satisfied:
            missing_required += 1
        items.append({**req, "satisfied": satisfied})
    required_total = sum(1 for req in requirements if req["required"])
    satisfied_required = required_total - missing_required
    return {
        "items": items,
        "required_total": required_total,
        "satisfied_required": satisfied_required,
        "complete": missing_required == 0,
        "missing_required": missing_required,
    }


def _normalize_expiry_alert_days(value: Any, *, default: int = 30) -> int:
    if value is None or value == "":
        return default
    days = int(value)
    if days not in VALID_EXPIRY_ALERT_DAYS:
        raise ValueError("Expiry alert window must be 30, 60, or 90 days")
    return days


def _normalize_employee_visible(value: Any, *, default: bool | None = None) -> bool | None:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return bool(value)


def document_expiry_status(
    *,
    expires_at: date | None,
    alert_days: int = 30,
    as_of: date | None = None,
) -> str:
    """Return none | valid | expiring_soon | expired for UI colour coding."""
    if expires_at is None:
        return "none"
    today = as_of or date.today()
    if isinstance(expires_at, str):
        expires_at = date.fromisoformat(expires_at[:10])
    days_left = (expires_at - today).days
    if days_left < 0:
        return "expired"
    if days_left <= alert_days:
        return "expiring_soon"
    return "valid"


def portal_document_visible(doc: dict[str, Any]) -> bool:
    """Whether a document should appear in the employee self-service portal."""
    if not doc.get("has_file") and not doc.get("document_url"):
        return False
    visible = doc.get("employee_visible")
    if visible is False:
        return False
    if visible is True:
        return True
    return doc.get("category") in EMPLOYEE_SELF_SERVICE_CATEGORIES


def validate_employee_document_data(data: dict[str, Any]) -> dict[str, Any]:
    title = (data.get("title") or "").strip()
    if not title:
        raise ValueError("Document title is required")
    category = data.get("category", "general")
    if category not in VALID_EMPLOYEE_CATEGORIES:
        raise ValueError("Invalid document category")
    lifecycle_stage = data.get("lifecycle_stage", "document_store")
    employee_stages = VALID_LIFECYCLE_STAGES - {"policy"}
    if lifecycle_stage not in employee_stages:
        lifecycle_stage = "document_store"
    document_url = data.get("document_url")
    if document_url is not None:
        document_url = str(document_url).strip() or None
    if not document_url and not data.get("notes") and not data.get("storage_path"):
        raise ValueError("Provide a document URL, upload a file, or notes describing where the file is stored")
    pay_period = data.get("pay_period")
    if pay_period is not None:
        pay_period = str(pay_period).strip() or None
    employee_visible = _normalize_employee_visible(data.get("employee_visible"), default=True)
    return {
        "title": title,
        "category": category,
        "lifecycle_stage": lifecycle_stage,
        "document_url": document_url,
        "notes": data.get("notes"),
        "expires_at": data.get("expires_at"),
        "expiry_alert_days": _normalize_expiry_alert_days(data.get("expiry_alert_days")),
        "employee_visible": employee_visible if employee_visible is not None else True,
        "pay_period": pay_period,
        "original_filename": data.get("original_filename"),
        "storage_path": data.get("storage_path"),
        "content_sha256": data.get("content_sha256"),
        "content_type": data.get("content_type"),
        "file_size_bytes": data.get("file_size_bytes"),
    }


def validate_tenant_document_data(data: dict[str, Any]) -> dict[str, Any]:
    title = (data.get("title") or "").strip()
    if not title:
        raise ValueError("Document title is required")
    category = data.get("category", "general")
    if category not in VALID_TENANT_CATEGORIES:
        raise ValueError("Invalid document category")
    lifecycle_stage = data.get("lifecycle_stage", "general")
    if lifecycle_stage not in VALID_LIFECYCLE_STAGES:
        lifecycle_stage = "general"
    document_url = data.get("document_url")
    if document_url is not None:
        document_url = str(document_url).strip() or None
    if not document_url and not data.get("notes") and not data.get("storage_path"):
        raise ValueError("Provide a document URL, upload a file, or notes describing where the file is stored")
    employee_visible = _normalize_employee_visible(data.get("employee_visible"), default=False)
    return {
        "title": title,
        "category": category,
        "lifecycle_stage": lifecycle_stage,
        "document_url": document_url,
        "notes": data.get("notes"),
        "expires_at": data.get("expires_at"),
        "expiry_alert_days": _normalize_expiry_alert_days(data.get("expiry_alert_days")),
        "employee_visible": employee_visible if employee_visible is not None else False,
        "original_filename": data.get("original_filename"),
        "employee_id": data.get("employee_id"),
        "storage_path": data.get("storage_path"),
        "content_sha256": data.get("content_sha256"),
        "content_type": data.get("content_type"),
        "file_size_bytes": data.get("file_size_bytes"),
    }


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _table_has_columns(conn: Any, table: str, *columns: str) -> bool:
    if not columns:
        return True
    available = _table_columns(conn, table)
    return all(column in available for column in columns)


def _table_columns(conn: Any, table: str) -> frozenset[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
            """,
            (table,),
        )
        return frozenset(row[0] for row in cur.fetchall())


def _employee_document_select_columns(conn: Any) -> list[str]:
    available = _table_columns(conn, "employee_documents")
    return [column for column in EMPLOYEE_DOCUMENT_SELECT.replace("\n", " ").split(",") if column.strip() in available]


def _row_to_employee_document(row: tuple[Any, ...], *, columns: list[str] | None = None) -> dict[str, Any]:
    if columns:
        data = dict(zip(columns, row, strict=False))
        return {
            "id": data.get("id"),
            "title": data.get("title"),
            "category": data.get("category"),
            "lifecycle_stage": data.get("lifecycle_stage"),
            "document_url": data.get("document_url"),
            "notes": data.get("notes"),
            "uploaded_by": data.get("uploaded_by"),
            "expires_at": _iso(data.get("expires_at")),
            "original_filename": data.get("original_filename"),
            "created_at": _iso(data.get("created_at")),
            "updated_at": _iso(data.get("updated_at")),
            "employee_id": data.get("employee_id"),
            "storage_path": data.get("storage_path"),
            "content_sha256": data.get("content_sha256"),
            "content_type": data.get("content_type"),
            "file_size_bytes": data.get("file_size_bytes"),
            "pay_period": data.get("pay_period"),
            "expiry_alert_days": data.get("expiry_alert_days", 30),
            "employee_visible": data.get("employee_visible", True),
            "has_file": bool(data.get("storage_path")),
        }
    return {
        "id": row[0],
        "title": row[1],
        "category": row[2],
        "lifecycle_stage": row[3],
        "document_url": row[4],
        "notes": row[5],
        "uploaded_by": row[6],
        "expires_at": _iso(row[7]),
        "original_filename": row[8],
        "created_at": _iso(row[9]),
        "updated_at": _iso(row[10]),
        "employee_id": row[11],
        "storage_path": row[12],
        "content_sha256": row[13],
        "content_type": row[14],
        "file_size_bytes": row[15],
        "pay_period": row[16],
        "expiry_alert_days": row[17],
        "employee_visible": row[18],
        "has_file": bool(row[12]),
    }


EMPLOYEE_DOCUMENT_SELECT = """
    id, title, category, lifecycle_stage, document_url, notes, uploaded_by,
    expires_at, original_filename, created_at, updated_at, employee_id,
    storage_path, content_sha256, content_type, file_size_bytes, pay_period,
    expiry_alert_days, employee_visible
"""


def _load_employee_document(
    *,
    tenant_id: int,
    employee_id: int,
    document_id: int,
    conn: Any,
) -> dict[str, Any] | None:
    select_cols = _employee_document_select_columns(conn)
    if not select_cols:
        return None
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {", ".join(select_cols)}
            FROM employee_documents
            WHERE tenant_id = %s AND employee_id = %s AND id = %s
            """,
            (tenant_id, employee_id, document_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    doc = _row_to_employee_document(row, columns=select_cols)
    doc["employee_id"] = employee_id
    return doc


def list_employee_documents(
    *,
    tenant_id: int,
    employee_id: int,
    conn: Any,
    category: str | None = None,
    lifecycle_stage: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["tenant_id = %s", "employee_id = %s"]
    params: list[Any] = [tenant_id, employee_id]
    if category:
        clauses.append("category = %s")
        params.append(category)
    if lifecycle_stage:
        clauses.append("lifecycle_stage = %s")
        params.append(lifecycle_stage)
    where = " AND ".join(clauses)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {EMPLOYEE_DOCUMENT_SELECT}
            FROM employee_documents
            WHERE {where}
            ORDER BY created_at DESC
            """,
            params,
        )
        return [_row_to_employee_document(row) for row in cur.fetchall()]


def get_employee_document(
    *,
    tenant_id: int,
    employee_id: int,
    document_id: int,
    conn: Any,
) -> dict[str, Any] | None:
    return _load_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        document_id=document_id,
        conn=conn,
    )


def create_employee_document(
    *,
    tenant_id: int,
    employee_id: int,
    data: dict[str, Any],
    uploaded_by: str,
    conn: Any,
) -> dict[str, Any]:
    payload = validate_employee_document_data(data)
    available = _table_columns(conn, "employee_documents")
    values = {
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "title": payload["title"],
        "category": payload["category"],
        "lifecycle_stage": payload["lifecycle_stage"],
        "document_url": payload["document_url"],
        "notes": payload["notes"],
        "uploaded_by": uploaded_by,
        "expires_at": payload.get("expires_at"),
        "original_filename": payload.get("original_filename"),
        "storage_path": payload.get("storage_path"),
        "content_sha256": payload.get("content_sha256"),
        "content_type": payload.get("content_type"),
        "file_size_bytes": payload.get("file_size_bytes"),
        "pay_period": payload.get("pay_period"),
        "expiry_alert_days": payload["expiry_alert_days"],
        "employee_visible": payload["employee_visible"],
    }
    insert_cols = [key for key in values if key in available]
    required = {"tenant_id", "employee_id", "title", "category"}
    missing = required - set(insert_cols)
    if missing:
        raise RuntimeError(
            f"employee_documents table missing required columns: {', '.join(sorted(missing))}"
        )

    col_sql = ", ".join(insert_cols)
    placeholders = ", ".join(["%s"] * len(insert_cols))
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO employee_documents ({col_sql}) VALUES ({placeholders}) RETURNING id",
            tuple(values[key] for key in insert_cols),
        )
        document_id = int(cur.fetchone()[0])
        conn.commit()

    doc = _load_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        document_id=document_id,
        conn=conn,
    )
    if not doc:
        raise RuntimeError("Document insert succeeded but could not be loaded")
    return doc


def update_employee_document(
    *,
    tenant_id: int,
    employee_id: int,
    document_id: int,
    updates: dict[str, Any],
    conn: Any,
) -> dict[str, Any]:
    allowed = {
        k: v
        for k, v in updates.items()
        if k
        in (
            "title",
            "category",
            "lifecycle_stage",
            "document_url",
            "notes",
            "expires_at",
            "original_filename",
            "storage_path",
            "content_sha256",
            "content_type",
            "file_size_bytes",
            "pay_period",
            "expiry_alert_days",
            "employee_visible",
        )
    }
    if not allowed:
        raise ValueError("no fields to update")
    merged = {**allowed}
    if "title" in merged:
        merged["title"] = str(merged["title"]).strip()
        if not merged["title"]:
            raise ValueError("Document title is required")
    if "category" in merged and merged["category"] not in VALID_EMPLOYEE_CATEGORIES:
        raise ValueError("Invalid document category")
    if "lifecycle_stage" in merged and merged["lifecycle_stage"] not in VALID_LIFECYCLE_STAGES - {"policy"}:
        raise ValueError("Invalid lifecycle stage")
    if "expiry_alert_days" in merged:
        merged["expiry_alert_days"] = _normalize_expiry_alert_days(merged["expiry_alert_days"])
    if "employee_visible" in merged:
        visible = _normalize_employee_visible(merged["employee_visible"])
        if visible is None:
            del merged["employee_visible"]
        else:
            merged["employee_visible"] = visible
    available = _table_columns(conn, "employee_documents")
    merged = {key: value for key, value in merged.items() if key in available}
    if "updated_at" in available:
        merged["updated_at"] = datetime.utcnow()
    if not merged:
        raise ValueError("no fields to update")
    sets = ", ".join(f"{key} = %s" for key in merged)
    values = list(merged.values()) + [tenant_id, employee_id, document_id]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE employee_documents SET {sets}
            WHERE tenant_id = %s AND employee_id = %s AND id = %s
            RETURNING id
            """,
            values,
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("document not found")
        conn.commit()
    doc = _load_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        document_id=document_id,
        conn=conn,
    )
    if not doc:
        raise LookupError("document not found")
    return doc


def delete_employee_document(
    *,
    tenant_id: int,
    employee_id: int,
    document_id: int,
    conn: Any,
) -> None:
    from modules.documents.storage import delete_stored_file

    existing = get_employee_document(
        tenant_id=tenant_id, employee_id=employee_id, document_id=document_id, conn=conn
    )
    if not existing:
        raise LookupError("document not found")
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM employee_documents
            WHERE tenant_id = %s AND employee_id = %s AND id = %s
            """,
            (tenant_id, employee_id, document_id),
        )
        conn.commit()
    delete_stored_file(existing.get("storage_path"))


def _row_to_tenant_document(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "title": row[1],
        "category": row[2],
        "lifecycle_stage": row[3],
        "document_url": row[4],
        "notes": row[5],
        "uploaded_by": row[6],
        "expires_at": _iso(row[7]),
        "original_filename": row[8],
        "created_at": _iso(row[9]),
        "updated_at": _iso(row[10]),
        "employee_id": row[11],
        "storage_path": row[12],
        "content_sha256": row[13],
        "content_type": row[14],
        "file_size_bytes": row[15],
        "expiry_alert_days": row[16],
        "employee_visible": row[17],
        "has_file": bool(row[12]),
    }


TENANT_DOCUMENT_SELECT = """
    id, title, category, lifecycle_stage, document_url, notes, uploaded_by,
    expires_at, original_filename, created_at, updated_at, employee_id,
    storage_path, content_sha256, content_type, file_size_bytes,
    expiry_alert_days, employee_visible
"""


def list_tenant_documents(
    *,
    tenant_id: int,
    conn: Any,
    category: str | None = None,
    lifecycle_stage: str | None = None,
    employee_id: int | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    clauses = ["tenant_id = %s"]
    params: list[Any] = [tenant_id]
    if category:
        clauses.append("category = %s")
        params.append(category)
    if lifecycle_stage:
        clauses.append("lifecycle_stage = %s")
        params.append(lifecycle_stage)
    if employee_id is not None:
        clauses.append("employee_id = %s")
        params.append(employee_id)
    where = " AND ".join(clauses)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {TENANT_DOCUMENT_SELECT}
            FROM tenant_documents
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            [*params, limit],
        )
        return [_row_to_tenant_document(row) for row in cur.fetchall()]


def tenant_document_accessible_to_employee(doc: dict[str, Any], employee_id: int) -> bool:
    """True when a tenant document is company-wide or assigned to this employee."""
    assigned = doc.get("employee_id")
    return assigned is None or int(assigned) == int(employee_id)


def list_portal_tenant_documents(
    *,
    tenant_id: int,
    employee_id: int,
    conn: Any,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Tenant documents for the employee portal — company-wide plus any assigned to them."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {TENANT_DOCUMENT_SELECT}
            FROM tenant_documents
            WHERE tenant_id = %s
              AND (employee_id IS NULL OR employee_id = %s)
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (tenant_id, employee_id, limit),
        )
        return [_row_to_tenant_document(row) for row in cur.fetchall()]


def get_tenant_document(*, tenant_id: int, document_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {TENANT_DOCUMENT_SELECT}
            FROM tenant_documents
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, document_id),
        )
        row = cur.fetchone()
    return _row_to_tenant_document(row) if row else None


def create_tenant_document(
    *,
    tenant_id: int,
    data: dict[str, Any],
    uploaded_by: str,
    conn: Any,
) -> dict[str, Any]:
    payload = validate_tenant_document_data(data)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tenant_documents (
              tenant_id, title, category, lifecycle_stage, document_url, notes,
              uploaded_by, expires_at, original_filename, employee_id,
              storage_path, content_sha256, content_type, file_size_bytes,
              expiry_alert_days, employee_visible
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING """
            + TENANT_DOCUMENT_SELECT,
            (
                tenant_id,
                payload["title"],
                payload["category"],
                payload["lifecycle_stage"],
                payload["document_url"],
                payload["notes"],
                uploaded_by,
                payload.get("expires_at"),
                payload.get("original_filename"),
                payload.get("employee_id"),
                payload.get("storage_path"),
                payload.get("content_sha256"),
                payload.get("content_type"),
                payload.get("file_size_bytes"),
                payload["expiry_alert_days"],
                payload["employee_visible"],
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return _row_to_tenant_document(row)


def update_tenant_document(
    *,
    tenant_id: int,
    document_id: int,
    updates: dict[str, Any],
    conn: Any,
) -> dict[str, Any]:
    allowed = {
        k: v
        for k, v in updates.items()
        if k
        in (
            "title",
            "category",
            "lifecycle_stage",
            "document_url",
            "notes",
            "expires_at",
            "original_filename",
            "employee_id",
            "storage_path",
            "content_sha256",
            "content_type",
            "file_size_bytes",
            "expiry_alert_days",
            "employee_visible",
        )
    }
    if "expiry_alert_days" in allowed:
        allowed["expiry_alert_days"] = _normalize_expiry_alert_days(allowed["expiry_alert_days"])
    if "employee_visible" in allowed:
        visible = _normalize_employee_visible(allowed["employee_visible"])
        if visible is None:
            del allowed["employee_visible"]
        else:
            allowed["employee_visible"] = visible
    if not allowed:
        raise ValueError("no fields to update")
    if "category" in allowed and allowed["category"] not in VALID_TENANT_CATEGORIES:
        raise ValueError("Invalid document category")
    if "lifecycle_stage" in allowed and allowed["lifecycle_stage"] not in VALID_LIFECYCLE_STAGES:
        raise ValueError("Invalid lifecycle stage")
    allowed["updated_at"] = datetime.utcnow()
    sets = ", ".join(f"{key} = %s" for key in allowed)
    values = list(allowed.values()) + [tenant_id, document_id]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE tenant_documents SET {sets}
            WHERE tenant_id = %s AND id = %s
            RETURNING {TENANT_DOCUMENT_SELECT}
            """,
            values,
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("document not found")
        conn.commit()
    return _row_to_tenant_document(row)


def delete_tenant_document(*, tenant_id: int, document_id: int, conn: Any) -> None:
    from modules.documents.storage import delete_stored_file

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT storage_path FROM tenant_documents
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, document_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("document not found")
        storage_path = row[0]
        cur.execute(
            "DELETE FROM tenant_documents WHERE tenant_id = %s AND id = %s RETURNING id",
            (tenant_id, document_id),
        )
        conn.commit()
    delete_stored_file(storage_path)


def list_all_employee_documents(
    *,
    tenant_id: int,
    conn: Any,
    employee_id: int | None = None,
    category: str | None = None,
    lifecycle_stage: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    clauses = ["tenant_id = %s"]
    params: list[Any] = [tenant_id]
    if employee_id is not None:
        clauses.append("employee_id = %s")
        params.append(employee_id)
    if category:
        clauses.append("category = %s")
        params.append(category)
    if lifecycle_stage:
        clauses.append("lifecycle_stage = %s")
        params.append(lifecycle_stage)
    where = " AND ".join(clauses)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {EMPLOYEE_DOCUMENT_SELECT}
            FROM employee_documents
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            [*params, limit],
        )
        return [_row_to_employee_document(row) for row in cur.fetchall()]


def qualification_certificate_summary(*, tenant_id: int, conn: Any) -> dict[str, int]:
    """Count qualification documents by expiry status (training certs via document store)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE),
              COUNT(*) FILTER (
                WHERE expires_at IS NOT NULL
                  AND expires_at >= CURRENT_DATE
                  AND expires_at <= CURRENT_DATE + INTERVAL '30 days'
              ),
              COUNT(*) FILTER (
                WHERE expires_at IS NULL OR expires_at > CURRENT_DATE + INTERVAL '30 days'
              )
            FROM employee_documents
            WHERE tenant_id = %s AND category IN ('qualification', 'training')
            """,
            (tenant_id,),
        )
        expired, expiring_soon, valid = cur.fetchone()
    return {
        "expired": int(expired or 0),
        "expiring_soon": int(expiring_soon or 0),
        "valid": int(valid or 0),
        "total": int((expired or 0) + (expiring_soon or 0) + (valid or 0)),
    }


def _expiring_document_item(
    *,
    scope: str,
    doc: dict[str, Any],
    employee_name: str | None,
    as_of: date,
) -> dict[str, Any]:
    expires_raw = doc.get("expires_at")
    expires_at = date.fromisoformat(str(expires_raw)[:10]) if expires_raw else None
    alert_days = int(doc.get("expiry_alert_days") or 30)
    status = document_expiry_status(expires_at=expires_at, alert_days=alert_days, as_of=as_of)
    days_until_expiry = (expires_at - as_of).days if expires_at else None
    return {
        "scope": scope,
        "id": doc["id"],
        "title": doc["title"],
        "category": doc["category"],
        "lifecycle_stage": doc.get("lifecycle_stage"),
        "employee_id": doc.get("employee_id"),
        "employee_name": employee_name,
        "expires_at": _iso(expires_at),
        "expiry_alert_days": alert_days,
        "expiry_status": status,
        "days_until_expiry": days_until_expiry,
        "employee_visible": doc.get("employee_visible"),
    }


def _expiring_document_from_row(row: tuple[Any, ...], *, full: bool) -> dict[str, Any]:
    if full:
        return {
            "id": row[0],
            "title": row[1],
            "category": row[2],
            "lifecycle_stage": row[3],
            "expires_at": _iso(row[4]),
            "employee_id": row[5],
            "expiry_alert_days": row[6],
            "employee_visible": row[7],
        }
    return {
        "id": row[0],
        "title": row[1],
        "category": row[2],
        "expires_at": _iso(row[3]),
        "employee_id": row[4],
        "lifecycle_stage": None,
        "expiry_alert_days": 30,
        "employee_visible": True,
    }


def list_expiring_documents(
    *,
    tenant_id: int,
    conn: Any,
    limit: int = 100,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Documents with expiry dates, sorted soonest first, with red/amber/green status."""
    today = as_of or date.today()
    tenant_full = _table_has_columns(
        conn,
        "tenant_documents",
        "expires_at",
        "expiry_alert_days",
        "employee_visible",
        "lifecycle_stage",
    )
    employee_full = _table_has_columns(
        conn,
        "employee_documents",
        "expires_at",
        "expiry_alert_days",
        "employee_visible",
        "lifecycle_stage",
    )
    tenant_can_query = _table_has_columns(conn, "tenant_documents", "expires_at")
    employee_can_query = _table_has_columns(conn, "employee_documents", "expires_at")

    tenant_rows: list[tuple[Any, ...]] = []
    employee_rows: list[tuple[Any, ...]] = []
    with conn.cursor() as cur:
        if tenant_can_query:
            tenant_select = (
                "tenant_documents.id, tenant_documents.title, tenant_documents.category, "
                "tenant_documents.lifecycle_stage, tenant_documents.expires_at, tenant_documents.employee_id, "
                "tenant_documents.expiry_alert_days, tenant_documents.employee_visible"
                if tenant_full
                else "tenant_documents.id, tenant_documents.title, tenant_documents.category, "
                "tenant_documents.expires_at, tenant_documents.employee_id"
            )
            cur.execute(
                f"""
                SELECT {tenant_select},
                       NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '')
                FROM tenant_documents
                LEFT JOIN employees e
                  ON e.id = tenant_documents.employee_id AND e.tenant_id = tenant_documents.tenant_id
                WHERE tenant_documents.tenant_id = %s AND tenant_documents.expires_at IS NOT NULL
                """,
                (tenant_id,),
            )
            tenant_rows = cur.fetchall()
        if employee_can_query:
            employee_select = (
                "employee_documents.id, employee_documents.title, employee_documents.category, "
                "employee_documents.lifecycle_stage, employee_documents.expires_at, employee_documents.employee_id, "
                "employee_documents.expiry_alert_days, employee_documents.employee_visible"
                if employee_full
                else "employee_documents.id, employee_documents.title, employee_documents.category, "
                "employee_documents.expires_at, employee_documents.employee_id"
            )
            cur.execute(
                f"""
                SELECT {employee_select},
                       NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '')
                FROM employee_documents
                JOIN employees e
                  ON e.id = employee_documents.employee_id AND e.tenant_id = employee_documents.tenant_id
                WHERE employee_documents.tenant_id = %s AND employee_documents.expires_at IS NOT NULL
                """,
                (tenant_id,),
            )
            employee_rows = cur.fetchall()

    items: list[dict[str, Any]] = []
    for row in tenant_rows:
        name = row[-1]
        doc = _expiring_document_from_row(row[:-1], full=tenant_full)
        items.append(_expiring_document_item(scope="tenant", doc=doc, employee_name=name, as_of=today))
    for row in employee_rows:
        name = row[-1]
        doc = _expiring_document_from_row(row[:-1], full=employee_full)
        items.append(_expiring_document_item(scope="employee", doc=doc, employee_name=name, as_of=today))

    items.sort(key=lambda item: (item.get("expires_at") or "9999", item.get("title") or ""))
    summary = {
        "expired": sum(1 for item in items if item["expiry_status"] == "expired"),
        "expiring_soon": sum(1 for item in items if item["expiry_status"] == "expiring_soon"),
        "valid": sum(1 for item in items if item["expiry_status"] == "valid"),
        "total": len(items),
    }
    return {"items": items[:limit], "summary": summary, "count": min(len(items), limit)}
