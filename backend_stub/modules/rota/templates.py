"""Staffing template CRUD for advanced rota."""

from __future__ import annotations

from datetime import time
from typing import Any

from modules.rota.service import RotaValidationError


def _requirement_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "day_of_week": int(row[1]),
        "start_time": row[2].strftime("%H:%M"),
        "end_time": row[3].strftime("%H:%M"),
        "role_label": row[4] or "",
        "min_staff": int(row[5]),
    }


def _template_row(row: tuple[Any, ...], *, requirements: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": row[0],
        "name": row[1],
        "is_default": bool(row[2]),
        "updated_at": row[3].isoformat() if row[3] else None,
        "requirements": requirements if requirements is not None else [],
    }


def _load_requirements(*, tenant_id: int, template_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, day_of_week, start_time, end_time, role_label, min_staff
            FROM rota_staffing_template_requirements
            WHERE tenant_id = %s AND template_id = %s
            ORDER BY day_of_week, start_time, role_label
            """,
            (tenant_id, template_id),
        )
        return [_requirement_row(row) for row in cur.fetchall()]


def _parse_time(value: str, *, field: str, index: int | None = None) -> time:
    try:
        return time.fromisoformat(str(value).strip()[:5])
    except (TypeError, ValueError) as exc:
        raise RotaValidationError(f"{field} must be HH:MM", field=field, index=index) from exc


def validate_requirements(requirements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not requirements:
        raise RotaValidationError("Add at least one staffing requirement to the template", field="requirements")
    parsed: list[dict[str, Any]] = []
    for index, item in enumerate(requirements):
        try:
            day_of_week = int(item["day_of_week"])
        except (KeyError, TypeError, ValueError) as exc:
            raise RotaValidationError("day_of_week is required (1=Mon … 7=Sun)", field="day_of_week", index=index) from exc
        if day_of_week < 1 or day_of_week > 7:
            raise RotaValidationError("day_of_week must be between 1 and 7", field="day_of_week", index=index)
        start_time = _parse_time(str(item["start_time"]), field="start_time", index=index)
        end_time = _parse_time(str(item["end_time"]), field="end_time", index=index)
        if start_time == end_time:
            raise RotaValidationError("Requirement start and end cannot be the same", field="end_time", index=index)
        role_label = str(item.get("role_label") or "").strip()[:80]
        try:
            min_staff = int(item.get("min_staff", 1))
        except (TypeError, ValueError) as exc:
            raise RotaValidationError("min_staff must be a number", field="min_staff", index=index) from exc
        if min_staff < 1 or min_staff > 50:
            raise RotaValidationError("min_staff must be between 1 and 50", field="min_staff", index=index)
        parsed.append(
            {
                "day_of_week": day_of_week,
                "start_time": start_time,
                "end_time": end_time,
                "role_label": role_label,
                "min_staff": min_staff,
            }
        )
    return parsed


def _clear_default_flag(*, tenant_id: int, conn: Any, except_id: int | None = None) -> None:
    with conn.cursor() as cur:
        if except_id is None:
            cur.execute(
                "UPDATE rota_staffing_templates SET is_default = FALSE WHERE tenant_id = %s",
                (tenant_id,),
            )
        else:
            cur.execute(
                """
                UPDATE rota_staffing_templates
                SET is_default = FALSE
                WHERE tenant_id = %s AND id <> %s
                """,
                (tenant_id, except_id),
            )


def list_templates(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.id, t.name, t.is_default, t.updated_at,
                   (SELECT COUNT(*) FROM rota_staffing_template_requirements r WHERE r.template_id = t.id) AS req_count
            FROM rota_staffing_templates t
            WHERE t.tenant_id = %s
            ORDER BY t.is_default DESC, lower(t.name), t.id
            """,
            (tenant_id,),
        )
        return [
            {
                "id": row[0],
                "name": row[1],
                "is_default": bool(row[2]),
                "updated_at": row[3].isoformat() if row[3] else None,
                "requirement_count": int(row[4]),
            }
            for row in cur.fetchall()
        ]


def get_template(*, tenant_id: int, template_id: int, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, is_default, updated_at
            FROM rota_staffing_templates
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, template_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("template not found")
    requirements = _load_requirements(tenant_id=tenant_id, template_id=template_id, conn=conn)
    return _template_row(row, requirements=requirements)


def resolve_template(
    *,
    tenant_id: int,
    template_id: int | None,
    conn: Any,
) -> dict[str, Any] | None:
    if template_id is not None:
        return get_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, is_default, updated_at
            FROM rota_staffing_templates
            WHERE tenant_id = %s
            ORDER BY is_default DESC, id ASC
            LIMIT 1
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
    requirements = _load_requirements(tenant_id=tenant_id, template_id=int(row[0]), conn=conn)
    return _template_row(row, requirements=requirements)


def create_template(
    *,
    tenant_id: int,
    name: str,
    is_default: bool,
    requirements: list[dict[str, Any]],
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    clean_name = (name or "").strip()
    if not clean_name:
        raise RotaValidationError("Template name is required", field="name")
    parsed_requirements = validate_requirements(requirements)

    with conn.cursor() as cur:
        if is_default:
            _clear_default_flag(tenant_id=tenant_id, conn=conn)
        cur.execute(
            """
            INSERT INTO rota_staffing_templates (tenant_id, name, is_default, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id, name, is_default, updated_at
            """,
            (tenant_id, clean_name[:120], is_default, actor_username),
        )
        template_row = cur.fetchone()
        template_id = int(template_row[0])
        for req in parsed_requirements:
            cur.execute(
                """
                INSERT INTO rota_staffing_template_requirements (
                  tenant_id, template_id, day_of_week, start_time, end_time, role_label, min_staff
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id,
                    template_id,
                    req["day_of_week"],
                    req["start_time"],
                    req["end_time"],
                    req["role_label"],
                    req["min_staff"],
                ),
            )
    conn.commit()
    return get_template(tenant_id=tenant_id, template_id=template_id, conn=conn)


def update_template(
    *,
    tenant_id: int,
    template_id: int,
    name: str | None,
    is_default: bool | None,
    requirements: list[dict[str, Any]] | None,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    existing = get_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
    clean_name = existing["name"]
    if name is not None:
        clean_name = (name or "").strip()
        if not clean_name:
            raise RotaValidationError("Template name is required", field="name")
    default_flag = existing["is_default"] if is_default is None else bool(is_default)
    parsed_requirements = validate_requirements(requirements) if requirements is not None else None

    with conn.cursor() as cur:
        if default_flag:
            _clear_default_flag(tenant_id=tenant_id, conn=conn, except_id=template_id)
        cur.execute(
            """
            UPDATE rota_staffing_templates
            SET name = %s,
                is_default = %s,
                updated_at = NOW()
            WHERE tenant_id = %s AND id = %s
            """,
            (clean_name[:120], default_flag, tenant_id, template_id),
        )
        if parsed_requirements is not None:
            cur.execute(
                "DELETE FROM rota_staffing_template_requirements WHERE tenant_id = %s AND template_id = %s",
                (tenant_id, template_id),
            )
            for req in parsed_requirements:
                cur.execute(
                    """
                    INSERT INTO rota_staffing_template_requirements (
                      tenant_id, template_id, day_of_week, start_time, end_time, role_label, min_staff
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        tenant_id,
                        template_id,
                        req["day_of_week"],
                        req["start_time"],
                        req["end_time"],
                        req["role_label"],
                        req["min_staff"],
                    ),
                )
    conn.commit()
    return get_template(tenant_id=tenant_id, template_id=template_id, conn=conn)


def delete_template(*, tenant_id: int, template_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM rota_staffing_templates WHERE tenant_id = %s AND id = %s RETURNING id",
            (tenant_id, template_id),
        )
        if not cur.fetchone():
            raise LookupError("template not found")
    conn.commit()
