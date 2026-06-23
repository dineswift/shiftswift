"""Entity version snapshots — current row plus timestamped history."""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _employee_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "id",
        "first_name",
        "last_name",
        "email",
        "phone",
        "job_title",
        "salary",
        "work_location",
        "department",
        "employment_type",
        "contract_hours_weekly",
        "start_date",
        "status",
        "is_sponsored",
        "date_of_birth",
        "home_address",
        "ni_number",
        "probation_end_date",
        "termination_date",
        "termination_reason",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relationship",
    )
    return _json_safe({key: row.get(key) for key in keys if key in row})


def _diff_fields(old_row: dict[str, Any], new_row: dict[str, Any]) -> list[dict[str, Any]]:
    snapshot = _employee_snapshot(new_row)
    changes: list[dict[str, Any]] = []
    for key, new_val in snapshot.items():
        if key == "id":
            continue
        old_val = _json_safe(old_row.get(key))
        if old_val != new_val:
            changes.append({"field": key, "old": old_val, "new": new_val})
    return changes


def record_employee_version(
    *,
    tenant_id: int,
    employee_id: int,
    old_row: dict[str, Any],
    new_row: dict[str, Any],
    changed_by: str,
    changed_by_role: str,
    conn: Any,
    change_reason: str | None = None,
) -> int | None:
    """Close prior version and store a new employee snapshot. Returns version id."""
    from employee_audit import log_employee_data_event

    changes = _diff_fields(old_row, new_row)
    if not changes:
        return None

    for item in changes:
        log_employee_data_event(
            tenant_id=tenant_id,
            actor_username=changed_by,
            actor_role=changed_by_role,
            action="update",
            entity_type="employee",
            entity_id=employee_id,
            field_name=item["field"],
            old_value=json.dumps(item["old"]) if item["old"] is not None else None,
            new_value=json.dumps(item["new"]) if item["new"] is not None else None,
            conn=conn,
        )

    snapshot = _employee_snapshot(new_row)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE entity_versions
            SET effective_to = NOW()
            WHERE tenant_id = %s
              AND entity_type = 'employee'
              AND entity_id = %s
              AND effective_to IS NULL
            """,
            (tenant_id, employee_id),
        )
        cur.execute(
            """
            SELECT COALESCE(MAX(version_no), 0) + 1
            FROM entity_versions
            WHERE tenant_id = %s AND entity_type = 'employee' AND entity_id = %s
            """,
            (tenant_id, employee_id),
        )
        version_no = int(cur.fetchone()[0])
        cur.execute(
            """
            INSERT INTO entity_versions (
              tenant_id, entity_type, entity_id, version_no, snapshot, changed_fields,
              changed_by, changed_by_role, change_reason, effective_from
            )
            VALUES (%s, 'employee', %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, NOW())
            RETURNING id
            """,
            (
                tenant_id,
                employee_id,
                version_no,
                json.dumps(snapshot),
                json.dumps(changes),
                changed_by,
                changed_by_role,
                change_reason,
            ),
        )
        row = cur.fetchone()
    return int(row[0]) if row else None


def list_employee_versions(
    *,
    tenant_id: int,
    employee_id: int,
    conn: Any,
    limit: int = 50,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, version_no, snapshot, changed_fields, changed_by, changed_by_role,
                   change_reason, effective_from, effective_to, created_at
            FROM entity_versions
            WHERE tenant_id = %s AND entity_type = 'employee' AND entity_id = %s
            ORDER BY version_no DESC
            LIMIT %s
            """,
            (tenant_id, employee_id, limit),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        snapshot = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
        changed = row[3] if isinstance(row[3], list) else json.loads(row[3] or "[]")
        out.append(
            {
                "id": int(row[0]),
                "version_no": int(row[1]),
                "snapshot": snapshot,
                "changed_fields": changed,
                "changed_by": row[4],
                "changed_by_role": row[5],
                "change_reason": row[6],
                "effective_from": row[7].isoformat() if row[7] else None,
                "effective_to": row[8].isoformat() if row[8] else None,
                "created_at": row[9].isoformat() if row[9] else None,
            }
        )
    return out
