"""Compare rota shifts to time punches — late, no-show, on-shift."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from modules.rota.service import shift_window, uk_date_range_utc

UK_TZ = ZoneInfo("Europe/London")

LATE_GRACE_MINUTES = 5
CLOCK_IN_EARLY_MINUTES = 15
NO_SHOW_GRACE_AFTER_END_MINUTES = 30


def _parse_punch_time(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _work_state_at(*, punches: list[dict[str, Any]], at: datetime) -> tuple[str, datetime | None]:
    """Replay punches up to `at` and return work state plus any open clock-in."""
    state = "off"
    open_clock_in: datetime | None = None
    for punch in sorted(punches, key=lambda item: item["punched_at"]):
        ts = punch["punched_at"]
        if ts > at:
            break
        punch_type = punch["punch_type"]
        if punch_type == "in":
            open_clock_in = ts
            state = "clocked_in"
        elif punch_type == "break_start":
            state = "on_break"
        elif punch_type == "break_end":
            state = "clocked_in"
        elif punch_type == "out":
            open_clock_in = None
            state = "off"
    return state, open_clock_in


def _shift_day_punches(*, punches: list[dict[str, Any]], shift_date: date, until: datetime) -> list[dict[str, Any]]:
    day_start, _day_end = uk_date_range_utc(date_from=shift_date, date_to=shift_date)
    return [p for p in punches if day_start <= p["punched_at"] < until]


def _resolve_shift_clock_events(
    *,
    punches: list[dict[str, Any]],
    shift_date: date,
    window_start: datetime,
    window_end: datetime,
    check_from: datetime,
    check_until: datetime,
) -> tuple[datetime | None, datetime | None]:
    """Match clock-in/out to a scheduled shift, including early or ongoing sessions."""
    day_punches = _shift_day_punches(punches=punches, shift_date=shift_date, until=check_until)
    state, open_clock_in = _work_state_at(punches=day_punches, at=window_start)
    clock_in = open_clock_in if state in {"clocked_in", "on_break"} and open_clock_in else None

    if clock_in is None:
        for punch in day_punches:
            ts = punch["punched_at"]
            if ts < check_from or ts > check_until:
                continue
            if punch["punch_type"] == "in":
                clock_in = ts
                break

    if clock_in is None:
        return None, None

    clock_out = None
    for punch in day_punches:
        ts = punch["punched_at"]
        if ts <= clock_in or ts > check_until:
            continue
        if punch["punch_type"] == "out":
            clock_out = ts
            break
    return clock_in, clock_out


def load_punches_for_employees(
    *,
    tenant_id: int,
    employee_ids: list[int],
    from_date: date,
    to_date: date,
    conn: Any,
) -> dict[int, list[dict[str, Any]]]:
    if not employee_ids:
        return {}
    punch_from, punch_until = uk_date_range_utc(date_from=from_date, date_to=to_date)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_id, punch_type, punched_at
            FROM time_punches
            WHERE tenant_id = %s
              AND employee_id = ANY(%s)
              AND punched_at >= %s
              AND punched_at < %s
            ORDER BY punched_at
            """,
            (
                tenant_id,
                employee_ids,
                punch_from,
                punch_until,
            ),
        )
        rows = cur.fetchall()
    grouped: dict[int, list[dict[str, Any]]] = {eid: [] for eid in employee_ids}
    for employee_id, punch_type, punched_at in rows:
        grouped[int(employee_id)].append(
            {
                "punch_type": punch_type,
                "punched_at": _parse_punch_time(punched_at),
            }
        )
    return grouped


def evaluate_shift_attendance(
    *,
    shift: dict[str, Any],
    punches: list[dict[str, Any]],
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return attendance flags for one scheduled shift."""
    now = now or datetime.now(timezone.utc)
    shift_date = date.fromisoformat(str(shift["shift_date"])[:10])
    start_time = time.fromisoformat(str(shift["start_time"])[:5])
    end_time = time.fromisoformat(str(shift["end_time"])[:5])
    window_start, window_end = shift_window(shift_date=shift_date, start_time=start_time, end_time=end_time)
    check_from = window_start - timedelta(minutes=CLOCK_IN_EARLY_MINUTES)
    check_until = window_end + timedelta(minutes=NO_SHOW_GRACE_AFTER_END_MINUTES)
    late_after = window_start + timedelta(minutes=LATE_GRACE_MINUTES)

    clock_in, clock_out = _resolve_shift_clock_events(
        punches=punches,
        shift_date=shift_date,
        window_start=window_start,
        window_end=window_end,
        check_from=check_from,
        check_until=check_until,
    )

    if now < window_start:
        status = "scheduled"
        detail = "Shift not started yet"
    elif clock_in is None and now > check_until:
        status = "no_show"
        detail = "No clock-in recorded for this shift"
    elif clock_in is None:
        status = "awaiting"
        detail = "Awaiting clock-in"
    elif clock_in > late_after:
        status = "late"
        detail = f"Clocked in at {clock_in.astimezone(UK_TZ).strftime('%H:%M')} (late)"
    elif clock_out is None and now > window_end:
        status = "missing_clock_out"
        detail = "Clocked in but no clock-out after shift end"
    elif clock_in is not None:
        status = "attended"
        if clock_in < check_from:
            detail = "Clock-in recorded for shift (already on clock)"
        else:
            detail = "Clock-in recorded for shift"
    else:
        status = "awaiting"
        detail = "Awaiting clock-in"

    return {
        "shift_id": shift.get("id"),
        "employee_id": shift.get("employee_id"),
        "employee_name": shift.get("employee_name"),
        "shift_date": shift_date.isoformat(),
        "start_time": shift["start_time"],
        "end_time": shift["end_time"],
        "role_label": shift.get("role_label") or "",
        "attendance_status": status,
        "attendance_detail": detail,
        "clock_in_at": clock_in.isoformat() if clock_in else None,
        "clock_out_at": clock_out.isoformat() if clock_out else None,
    }


def build_week_attendance(
    *,
    tenant_id: int,
    week_start: date,
    shifts: list[dict[str, Any]],
    conn: Any,
    now: datetime | None = None,
) -> dict[str, Any]:
    employee_ids = sorted({int(s["employee_id"]) for s in shifts})
    punches_by_employee = load_punches_for_employees(
        tenant_id=tenant_id,
        employee_ids=employee_ids,
        from_date=week_start,
        to_date=week_start + timedelta(days=6),
        conn=conn,
    )
    items = [
        evaluate_shift_attendance(
            shift=shift,
            punches=punches_by_employee.get(int(shift["employee_id"]), []),
            now=now,
        )
        for shift in shifts
    ]
    summary = {
        "scheduled": sum(1 for i in items if i["attendance_status"] == "scheduled"),
        "awaiting": sum(1 for i in items if i["attendance_status"] == "awaiting"),
        "attended": sum(1 for i in items if i["attendance_status"] == "attended"),
        "late": sum(1 for i in items if i["attendance_status"] == "late"),
        "no_show": sum(1 for i in items if i["attendance_status"] == "no_show"),
        "missing_clock_out": sum(1 for i in items if i["attendance_status"] == "missing_clock_out"),
    }
    return {"items": items, "summary": summary}


def expected_shift_for_employee_on_date(
    *,
    tenant_id: int,
    employee_id: int,
    on_date: date,
    conn: Any,
) -> dict[str, Any] | None:
    """Published shift for employee on a calendar day with attendance flags."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.employee_id, s.shift_date, s.start_time, s.end_time, s.role_label, s.notes,
                   trim(both ' ' from coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
                   e.status
            FROM rota_shifts s
            JOIN rota_weeks w ON w.id = s.rota_week_id AND w.tenant_id = s.tenant_id
            JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
            WHERE s.tenant_id = %s
              AND s.employee_id = %s
              AND s.shift_date = %s
              AND w.status = 'published'
            ORDER BY s.start_time
            LIMIT 1
            """,
            (tenant_id, employee_id, on_date),
        )
        row = cur.fetchone()
    if not row:
        return None
    shift = {
        "id": row[0],
        "employee_id": row[1],
        "shift_date": row[2].isoformat(),
        "start_time": row[3].strftime("%H:%M"),
        "end_time": row[4].strftime("%H:%M"),
        "role_label": row[5] or "",
        "notes": row[6] or "",
        "employee_name": row[7],
        "employee_status": row[8],
    }
    punches = load_punches_for_employees(
        tenant_id=tenant_id,
        employee_ids=[employee_id],
        from_date=on_date,
        to_date=on_date,
        conn=conn,
    ).get(employee_id, [])
    attendance = evaluate_shift_attendance(shift=shift, punches=punches)
    return {**shift, **attendance}


def list_employee_week_shifts(
    *,
    tenant_id: int,
    employee_id: int,
    week_start: date,
    conn: Any,
) -> list[dict[str, Any]]:
    week_end = week_start + timedelta(days=6)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.employee_id, s.shift_date, s.start_time, s.end_time,
                   s.role_label, s.notes,
                   trim(both ' ' from coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
                   e.status
            FROM rota_shifts s
            JOIN rota_weeks w ON w.id = s.rota_week_id AND w.tenant_id = s.tenant_id
            JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
            WHERE s.tenant_id = %s
              AND s.employee_id = %s
              AND s.shift_date >= %s
              AND s.shift_date <= %s
              AND w.status = 'published'
            ORDER BY s.shift_date, s.start_time
            """,
            (tenant_id, employee_id, week_start, week_end),
        )
        return [
            {
                "id": row[0],
                "employee_id": row[1],
                "shift_date": row[2].isoformat(),
                "start_time": row[3].strftime("%H:%M"),
                "end_time": row[4].strftime("%H:%M"),
                "role_label": row[5] or "",
                "notes": row[6] or "",
                "employee_name": row[7],
                "employee_status": row[8],
            }
            for row in cur.fetchall()
        ]
