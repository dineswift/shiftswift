"""Advanced rota insights: coverage gaps, hours warnings, draft generation."""

from __future__ import annotations

from datetime import date, time, timedelta
from typing import Any

from modules.rota import templates as rota_templates
from modules.rota.service import RotaValidationError, shift_window, shifts_overlap

DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

DEFAULT_CONTRACT_HOURS: dict[str, float] = {
    "full_time": 40.0,
    "part_time": 20.0,
    "zero_hours": 0.0,
    "fixed_term": 40.0,
    "casual": 0.0,
}

DAY_OFF_PATTERN = ("day off", "off day", "annual leave", "holiday", "unpaid leave")


def normalize_role(value: str | None) -> str:
    return (value or "").strip().lower()


def role_matches(*, required_role: str, shift_role: str | None = None, job_title: str | None = None) -> bool:
    req = normalize_role(required_role)
    if not req:
        return True
    for candidate in (shift_role, job_title):
        val = normalize_role(candidate)
        if not val:
            continue
        if val == req or req in val or val in req:
            return True
    return False


def is_day_off_shift(shift: dict[str, Any]) -> bool:
    role = normalize_role(str(shift.get("role_label") or ""))
    return any(token in role for token in DAY_OFF_PATTERN)


def shift_duration_hours(*, shift_date: date, start_time: time, end_time: time) -> float:
    start, end = shift_window(shift_date=shift_date, start_time=start_time, end_time=end_time)
    return (end - start).total_seconds() / 3600.0


def _parse_shift_times(shift: dict[str, Any]) -> tuple[date, time, time]:
    shift_date = date.fromisoformat(str(shift["shift_date"])[:10])
    start_time = time.fromisoformat(str(shift["start_time"])[:5])
    end_time = time.fromisoformat(str(shift["end_time"])[:5])
    return shift_date, start_time, end_time


def shift_matches_requirement(
    *,
    shift: dict[str, Any],
    shift_date: date,
    req_start: time,
    req_end: time,
    role_label: str,
    job_title: str | None = None,
) -> bool:
    s_date, s_start, s_end = _parse_shift_times(shift)
    if s_date != shift_date:
        return False
    if is_day_off_shift(shift):
        return False
    if not role_matches(required_role=role_label, shift_role=str(shift.get("role_label") or ""), job_title=job_title):
        return False
    return shifts_overlap(s_date, s_start, s_end, shift_date, req_start, req_end)


def count_matching_shifts(
    *,
    shifts: list[dict[str, Any]],
    shift_date: date,
    req_start: time,
    req_end: time,
    role_label: str,
    employees_by_id: dict[int, dict[str, Any]] | None = None,
) -> int:
    count = 0
    for shift in shifts:
        emp = (employees_by_id or {}).get(int(shift.get("employee_id") or 0))
        job_title = emp.get("job_title") if emp else None
        if shift_matches_requirement(
            shift=shift,
            shift_date=shift_date,
            req_start=req_start,
            req_end=req_end,
            role_label=role_label,
            job_title=job_title,
        ):
            count += 1
    return count


def coverage_gaps_for_week(
    *,
    week_start: date,
    requirements: list[dict[str, Any]],
    shifts: list[dict[str, Any]],
    employees_by_id: dict[int, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    for req in requirements:
        day_of_week = int(req["day_of_week"])
        shift_date = week_start + timedelta(days=day_of_week - 1)
        req_start = time.fromisoformat(str(req["start_time"])[:5])
        req_end = time.fromisoformat(str(req["end_time"])[:5])
        role_label = str(req.get("role_label") or "")
        required = int(req.get("min_staff") or 1)
        actual = count_matching_shifts(
            shifts=shifts,
            shift_date=shift_date,
            req_start=req_start,
            req_end=req_end,
            role_label=role_label,
            employees_by_id=employees_by_id,
        )
        if actual < required:
            gaps.append(
                {
                    "shift_date": shift_date.isoformat(),
                    "day_name": shift_date.strftime("%a"),
                    "start_time": req["start_time"],
                    "end_time": req["end_time"],
                    "role_label": role_label,
                    "required": required,
                    "actual": actual,
                    "deficit": required - actual,
                }
            )
    return gaps


def _contract_hours_for_employee(employee: dict[str, Any]) -> float | None:
    raw = employee.get("contract_hours_weekly")
    if raw is not None and raw != "":
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    employment_type = str(employee.get("employment_type") or "full_time")
    return DEFAULT_CONTRACT_HOURS.get(employment_type)


def weekly_hours_warnings(
    *,
    shifts: list[dict[str, Any]],
    employees: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    scheduled: dict[int, float] = {}
    for shift in shifts:
        if is_day_off_shift(shift):
            continue
        employee_id = int(shift["employee_id"])
        shift_date, start_time, end_time = _parse_shift_times(shift)
        scheduled[employee_id] = scheduled.get(employee_id, 0.0) + shift_duration_hours(
            shift_date=shift_date,
            start_time=start_time,
            end_time=end_time,
        )

    warnings: list[dict[str, Any]] = []
    for employee in employees:
        if str(employee.get("status") or "") not in {"active", "onboarding", "suspended"}:
            continue
        employee_id = int(employee["id"])
        contracted = _contract_hours_for_employee(employee)
        if contracted is None:
            continue
        hours = round(scheduled.get(employee_id, 0.0), 2)
        delta = round(hours - contracted, 2)
        if contracted <= 0:
            if hours <= 0.25:
                continue
            severity = "over"
        elif delta > 0.25:
            severity = "over"
        elif delta < -0.25:
            severity = "under"
        else:
            continue
        name = f"{employee.get('first_name') or ''} {employee.get('last_name') or ''}".strip()
        warnings.append(
            {
                "employee_id": employee_id,
                "employee_name": name,
                "scheduled_hours": hours,
                "contracted_hours": contracted,
                "delta_hours": delta,
                "severity": severity,
            }
        )
    warnings.sort(key=lambda item: abs(float(item["delta_hours"])), reverse=True)
    return warnings


def build_week_insights(
    *,
    tenant_id: int,
    week_start: date,
    shifts: list[dict[str, Any]],
    template_id: int | None,
    conn: Any,
) -> dict[str, Any]:
    template = rota_templates.resolve_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
    employees = _load_rota_employees(tenant_id=tenant_id, conn=conn)
    employees_by_id = {int(emp["id"]): emp for emp in employees}
    if not template:
        return {
            "template_id": None,
            "template_name": None,
            "coverage_gaps": [],
            "hours_warnings": weekly_hours_warnings(shifts=shifts, employees=employees),
            "has_template": False,
        }
    return {
        "template_id": template["id"],
        "template_name": template["name"],
        "coverage_gaps": coverage_gaps_for_week(
            week_start=week_start,
            requirements=template["requirements"],
            shifts=shifts,
            employees_by_id=employees_by_id,
        ),
        "hours_warnings": weekly_hours_warnings(shifts=shifts, employees=employees),
        "has_template": True,
    }


def _load_rota_employees(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    from modules.employees.repository import employees_table_columns

    contract_hours_col = (
        "contract_hours_weekly"
        if "contract_hours_weekly" in employees_table_columns(conn)
        else "NULL::numeric AS contract_hours_weekly"
    )
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, first_name, last_name, job_title, employment_type, {contract_hours_col}, status
            FROM employees
            WHERE tenant_id = %s
            ORDER BY first_name, last_name, id
            """,
            (tenant_id,),
        )
        return [
            {
                "id": row[0],
                "first_name": row[1],
                "last_name": row[2],
                "job_title": row[3],
                "employment_type": row[4] or "full_time",
                "contract_hours_weekly": float(row[5]) if row[5] is not None else None,
                "status": row[6],
            }
            for row in cur.fetchall()
        ]


def _employee_has_overlap(
    *,
    employee_id: int,
    shift_date: date,
    start_time: time,
    end_time: time,
    existing: list[dict[str, Any]],
) -> bool:
    for shift in existing:
        if int(shift["employee_id"]) != employee_id:
            continue
        s_date, s_start, s_end = _parse_shift_times(shift)
        if shifts_overlap(s_date, s_start, s_end, shift_date, start_time, end_time):
            return True
    return False


def _employees_for_role(*, employees: list[dict[str, Any]], role_label: str) -> list[dict[str, Any]]:
    matched = [
        emp
        for emp in employees
        if str(emp.get("status") or "") in {"active", "onboarding", "suspended"}
        and role_matches(required_role=role_label, job_title=str(emp.get("job_title") or ""))
    ]
    if matched:
        return matched
    return [
        emp
        for emp in employees
        if str(emp.get("status") or "") in {"active", "onboarding", "suspended"}
    ]


def generate_draft_shifts(
    *,
    week_start: date,
    template: dict[str, Any],
    existing_shifts: list[dict[str, Any]],
    employees: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    generated: list[dict[str, Any]] = []
    working = [dict(shift) for shift in existing_shifts]

    for req in template["requirements"]:
        day_of_week = int(req["day_of_week"])
        shift_date = week_start + timedelta(days=day_of_week - 1)
        req_start = time.fromisoformat(str(req["start_time"])[:5])
        req_end = time.fromisoformat(str(req["end_time"])[:5])
        role_label = str(req.get("role_label") or "")
        required = int(req.get("min_staff") or 1)
        employees_by_id = {int(emp["id"]): emp for emp in employees}
        actual = count_matching_shifts(
            shifts=working,
            shift_date=shift_date,
            req_start=req_start,
            req_end=req_end,
            role_label=role_label,
            employees_by_id=employees_by_id,
        )
        deficit = max(required - actual, 0)
        if deficit <= 0:
            continue

        candidates = _employees_for_role(employees=employees, role_label=role_label)
        assigned = 0
        for employee in candidates:
            if assigned >= deficit:
                break
            employee_id = int(employee["id"])
            if _employee_has_overlap(
                employee_id=employee_id,
                shift_date=shift_date,
                start_time=req_start,
                end_time=req_end,
                existing=working,
            ):
                continue
            shift_payload = {
                "employee_id": employee_id,
                "shift_date": shift_date.isoformat(),
                "start_time": req["start_time"],
                "end_time": req["end_time"],
                "role_label": role_label,
                "notes": "Generated from template",
            }
            generated.append(shift_payload)
            working.append(shift_payload)
            assigned += 1
    return generated


def generate_draft_from_template(
    *,
    tenant_id: int,
    week_start: date,
    template_id: int | None,
    expected_version: int | None,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    from modules.rota.service import assert_week_copy_allowed, get_or_create_week, list_shifts_for_week, save_week_shifts

    assert_week_copy_allowed(week_start=week_start)
    template = rota_templates.resolve_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
    if not template:
        raise RotaValidationError(
            "Create a staffing template in Settings → Rota scheduling before generating a draft",
            field="template_id",
        )
    if not template["requirements"]:
        raise RotaValidationError("Template has no staffing requirements", field="requirements")

    get_or_create_week(
        tenant_id=tenant_id,
        week_start=week_start,
        actor_username=actor_username,
        conn=conn,
    )
    conn.commit()

    _, existing_shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=week_start, conn=conn)
    employees = _load_rota_employees(tenant_id=tenant_id, conn=conn)
    generated = generate_draft_shifts(
        week_start=week_start,
        template=template,
        existing_shifts=existing_shifts,
        employees=employees,
    )
    if not generated:
        return {
            "message": "No gaps to fill — rota already meets the template for this week",
            "generated_count": 0,
            "shifts_added": [],
        }

    merge_payload = [
        {
            "employee_id": int(item["employee_id"]),
            "shift_date": str(item["shift_date"])[:10],
            "start_time": str(item["start_time"])[:5],
            "end_time": str(item["end_time"])[:5],
            "role_label": str(item.get("role_label") or ""),
            "notes": str(item.get("notes") or ""),
        }
        for item in existing_shifts
    ] + generated

    saved = save_week_shifts(
        tenant_id=tenant_id,
        week_start=week_start,
        shifts_payload=merge_payload,
        expected_version=expected_version,
        actor_username=actor_username,
        conn=conn,
    )
    return {
        "message": f"Added {len(generated)} shift{'s' if len(generated) != 1 else ''} from template",
        "generated_count": len(generated),
        "shifts_added": generated,
        "week": saved.get("week"),
        "shifts": saved.get("shifts"),
    }
