"""Named base rotas: save a week's shifts and load them into another week as a draft."""

from __future__ import annotations

from datetime import date, time, timedelta
from typing import Any

from core.schema import table_columns
from modules.rota.service import (
    RotaValidationError,
    _load_active_employee_ids,
    _load_active_punch_site_ids,
    assert_week_copy_allowed,
    list_shifts_for_week,
    rota_shifts_have_site_column,
    save_week_shifts,
    tenant_requires_shift_site,
)

_UNAVAILABLE = (
    "Base rotas need the latest database update. Apply migrations/102_rota_base_templates.sql and restart the API."
)


def base_templates_ready(conn: Any) -> bool:
    return "id" in table_columns(conn, "rota_base_templates") and "day_offset" in table_columns(
        conn, "rota_base_template_shifts"
    )


def _require_ready(conn: Any) -> None:
    if not base_templates_ready(conn):
        raise RotaValidationError(_UNAVAILABLE, field="template")


def _clock(value: Any) -> str:
    if isinstance(value, time):
        return value.strftime("%H:%M")
    return str(value or "")[:5]


def pattern_from_shifts(*, week_start: date, shifts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Store each shift as a day offset from the week start, so it can land on a later week."""
    pattern: list[dict[str, Any]] = []
    for shift in shifts:
        raw_date = shift.get("shift_date")
        shift_date = raw_date if isinstance(raw_date, date) else date.fromisoformat(str(raw_date)[:10])
        offset = (shift_date - week_start).days
        if offset < 0 or offset > 6:
            continue
        site_id = shift.get("punch_site_id")
        pattern.append(
            {
                "day_offset": offset,
                "employee_id": int(shift["employee_id"]),
                "start_time": _clock(shift.get("start_time")),
                "end_time": _clock(shift.get("end_time")),
                "role_label": str(shift.get("role_label") or "")[:80],
                "notes": str(shift.get("notes") or "")[:500],
                "punch_site_id": int(site_id) if site_id else None,
            }
        )
    return pattern


def week_shifts_from_pattern(
    *,
    week_start: date,
    pattern: list[dict[str, Any]],
    active_employee_ids: set[int],
    active_site_ids: set[int] | None,
    require_site: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Map a saved pattern onto a week. Drop people or locations that are no longer available."""
    kept: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in pattern:
        employee_id = int(item["employee_id"])
        offset = int(item["day_offset"])
        site_id = item.get("punch_site_id")
        site_id = int(site_id) if site_id else None
        if employee_id not in active_employee_ids:
            skipped.append({"reason": "employee_unavailable", "employee_id": employee_id, "day_offset": offset})
            continue
        if site_id is not None and active_site_ids is not None and site_id not in active_site_ids:
            site_id = None
        if require_site and site_id is None:
            skipped.append({"reason": "missing_location", "employee_id": employee_id, "day_offset": offset})
            continue
        kept.append(
            {
                "employee_id": employee_id,
                "shift_date": (week_start + timedelta(days=offset)).isoformat(),
                "start_time": _clock(item.get("start_time")),
                "end_time": _clock(item.get("end_time")),
                "role_label": str(item.get("role_label") or ""),
                "notes": str(item.get("notes") or ""),
                "punch_site_id": site_id,
            }
        )
    return kept, skipped


def _clean_name(name: str) -> str:
    clean = (name or "").strip()
    if not clean:
        raise RotaValidationError("Give this base rota a name", field="name")
    return clean[:120]


def _row_summary(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": int(row[0]),
        "name": row[1],
        "shift_count": int(row[2]),
        "updated_at": row[3].isoformat() if row[3] else None,
    }


def list_base_templates(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    _require_ready(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.id, t.name,
                   (SELECT COUNT(*) FROM rota_base_template_shifts s WHERE s.template_id = t.id),
                   t.updated_at
            FROM rota_base_templates t
            WHERE t.tenant_id = %s
            ORDER BY lower(t.name), t.id
            """,
            (tenant_id,),
        )
        return [_row_summary(row) for row in cur.fetchall()]


def _find_by_name(*, tenant_id: int, name: str, conn: Any) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM rota_base_templates
            WHERE tenant_id = %s AND lower(btrim(name)) = lower(btrim(%s))
            """,
            (tenant_id, name),
        )
        row = cur.fetchone()
    return int(row[0]) if row else None


def _load_pattern(*, tenant_id: int, template_id: int, conn: Any) -> tuple[str, list[dict[str, Any]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT name FROM rota_base_templates
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, template_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Base rota not found")
        cur.execute(
            """
            SELECT day_offset, employee_id, start_time, end_time, role_label, notes, punch_site_id
            FROM rota_base_template_shifts
            WHERE tenant_id = %s AND template_id = %s
            ORDER BY day_offset, start_time, employee_id
            """,
            (tenant_id, template_id),
        )
        pattern = [
            {
                "day_offset": int(item[0]),
                "employee_id": int(item[1]),
                "start_time": _clock(item[2]),
                "end_time": _clock(item[3]),
                "role_label": item[4] or "",
                "notes": item[5] or "",
                "punch_site_id": int(item[6]) if item[6] is not None else None,
            }
            for item in cur.fetchall()
        ]
    return str(row[0]), pattern


def _replace_shifts(*, tenant_id: int, template_id: int, pattern: list[dict[str, Any]], conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM rota_base_template_shifts WHERE tenant_id = %s AND template_id = %s",
            (tenant_id, template_id),
        )
        for item in pattern:
            cur.execute(
                """
                INSERT INTO rota_base_template_shifts (
                  tenant_id, template_id, day_offset, employee_id,
                  start_time, end_time, role_label, notes, punch_site_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id,
                    template_id,
                    item["day_offset"],
                    item["employee_id"],
                    item["start_time"],
                    item["end_time"],
                    item["role_label"],
                    item["notes"],
                    item["punch_site_id"],
                ),
            )
        cur.execute(
            "UPDATE rota_base_templates SET updated_at = NOW() WHERE tenant_id = %s AND id = %s",
            (tenant_id, template_id),
        )


def save_base_from_week(
    *,
    tenant_id: int,
    week_start: date,
    name: str,
    replace: bool,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    _require_ready(conn)
    clean_name = _clean_name(name)
    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    pattern = pattern_from_shifts(week_start=week_start, shifts=shifts)
    if not pattern:
        raise RotaValidationError(
            "Save this week's shifts before storing them as a base rota",
            field="shifts",
        )
    existing_id = _find_by_name(tenant_id=tenant_id, name=clean_name, conn=conn)
    if existing_id and not replace:
        raise RotaValidationError(
            "A base rota with this name already exists. Save again to replace it.",
            field="name",
        )
    with conn.cursor() as cur:
        if existing_id:
            cur.execute(
                """
                UPDATE rota_base_templates
                SET name = %s, updated_at = NOW()
                WHERE tenant_id = %s AND id = %s
                """,
                (clean_name, tenant_id, existing_id),
            )
            template_id = existing_id
        else:
            cur.execute(
                """
                INSERT INTO rota_base_templates (tenant_id, name, created_by)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (tenant_id, clean_name, actor_username),
            )
            template_id = int(cur.fetchone()[0])
    _replace_shifts(tenant_id=tenant_id, template_id=template_id, pattern=pattern, conn=conn)
    conn.commit()
    return {
        "id": template_id,
        "name": clean_name,
        "shift_count": len(pattern),
        "message": f"Saved “{clean_name}” ({len(pattern)} shifts). Load it on another week, edit, then publish.",
    }


def rename_base_template(*, tenant_id: int, template_id: int, name: str, conn: Any) -> dict[str, Any]:
    _require_ready(conn)
    clean_name = _clean_name(name)
    taken = _find_by_name(tenant_id=tenant_id, name=clean_name, conn=conn)
    if taken and taken != template_id:
        raise RotaValidationError("A base rota with this name already exists.", field="name")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE rota_base_templates
            SET name = %s, updated_at = NOW()
            WHERE tenant_id = %s AND id = %s
            RETURNING id
            """,
            (clean_name, tenant_id, template_id),
        )
        if not cur.fetchone():
            raise LookupError("Base rota not found")
    conn.commit()
    return {"id": template_id, "name": clean_name, "message": "Base rota renamed"}


def delete_base_template(*, tenant_id: int, template_id: int, conn: Any) -> None:
    _require_ready(conn)
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM rota_base_templates WHERE tenant_id = %s AND id = %s RETURNING id",
            (tenant_id, template_id),
        )
        if not cur.fetchone():
            raise LookupError("Base rota not found")
    conn.commit()


def apply_base_template(
    *,
    tenant_id: int,
    week_start: date,
    template_id: int,
    expected_version: int | None,
    replace: bool,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    _require_ready(conn)
    assert_week_copy_allowed(week_start=week_start)
    name, pattern = _load_pattern(tenant_id=tenant_id, template_id=template_id, conn=conn)
    if not pattern:
        raise RotaValidationError("This base rota has no shifts", field="template_id")

    _, current_shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    if current_shifts and not replace:
        raise RotaValidationError(
            "This week already has shifts. Load the base rota again to replace them.",
            field="shifts",
        )

    has_site = rota_shifts_have_site_column(conn)
    payload, skipped = week_shifts_from_pattern(
        week_start=week_start,
        pattern=pattern,
        active_employee_ids=_load_active_employee_ids(tenant_id=tenant_id, conn=conn),
        active_site_ids=_load_active_punch_site_ids(tenant_id=tenant_id, conn=conn) if has_site else None,
        require_site=tenant_requires_shift_site(tenant_id=tenant_id, conn=conn) if has_site else False,
    )
    if not payload:
        raise RotaValidationError(
            "None of the people or locations on this base rota are available for this week.",
            field="template_id",
        )
    if not has_site:
        for item in payload:
            item.pop("punch_site_id", None)

    saved = save_week_shifts(
        tenant_id=tenant_id,
        week_start=week_start,
        shifts_payload=payload,
        expected_version=expected_version,
        actor_username=actor_username,
        conn=conn,
    )
    skipped_count = len(skipped)
    extra = ""
    if skipped_count:
        extra = f" {skipped_count} shift{' was' if skipped_count == 1 else 's were'} left out because that person or location is no longer available."
    saved["message"] = (
        f"Loaded {len(payload)} shifts from “{name}” as a draft.{extra} Edit them, then publish when staff should see the rota."
    )
    saved["template_id"] = template_id
    saved["template_name"] = name
    saved["skipped_count"] = skipped_count
    return saved
