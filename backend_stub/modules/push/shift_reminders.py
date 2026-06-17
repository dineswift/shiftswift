"""Shift-relative push reminders — cron-driven, no background GPS."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from modules.push.service import app_url_path, send_employee_push
from modules.rota.attendance import evaluate_shift_attendance, load_punches_for_employees
from modules.rota.missed_punch import list_published_shifts_on_date, tenant_has_active_punch_sites
from modules.rota.service import shift_window

REMINDER_MINUTES_BEFORE = 10
EARLY_MISSED_CLOCK_IN_MINUTES = 10
MISSED_CLOCK_IN_MINUTES = 30
TRIGGER_WINDOW_MINUTES = 8


def _parse_now(now: datetime | None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    return now if now.tzinfo else now.replace(tzinfo=timezone.utc)


def _app_path(path: str) -> str:
    return app_url_path(path)


def _primary_site_name(*, tenant_id: int, conn: Any) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT name FROM punch_sites
            WHERE tenant_id = %s AND is_active = TRUE
            ORDER BY is_primary DESC, id
            LIMIT 1
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
    return row[0] if row else "your work site"


def _within_minutes(actual_minutes: float, target_minutes: float, window: int = TRIGGER_WINDOW_MINUTES) -> bool:
    return abs(actual_minutes - target_minutes) <= window


def evaluate_shift_push_reminders(
    *,
    tenant_id: int,
    conn: Any,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Send shift start / reminder / missed clock-in / end pushes when due."""
    now = _parse_now(now)
    if not tenant_has_active_punch_sites(tenant_id=tenant_id, conn=conn):
        return []

    on_date = now.date()
    shifts = list_published_shifts_on_date(tenant_id=tenant_id, on_date=on_date, conn=conn)
    if not shifts:
        return []

    site_name = _primary_site_name(tenant_id=tenant_id, conn=conn)
    clock_url = _app_path("employee.html#time-clock")
    employee_ids = sorted({int(s["employee_id"]) for s in shifts})
    punches_by_employee = load_punches_for_employees(
        tenant_id=tenant_id,
        employee_ids=employee_ids,
        from_date=on_date,
        to_date=on_date,
        conn=conn,
    )

    sent: list[dict[str, Any]] = []
    for shift in shifts:
        shift_date = date.fromisoformat(str(shift["shift_date"])[:10])
        start_time = time.fromisoformat(str(shift["start_time"])[:5])
        end_time = time.fromisoformat(str(shift["end_time"])[:5])
        window_start, window_end = shift_window(
            shift_date=shift_date,
            start_time=start_time,
            end_time=end_time,
        )
        minutes_until_start = (window_start - now).total_seconds() / 60.0
        minutes_after_start = (now - window_start).total_seconds() / 60.0
        minutes_after_end = (now - window_end).total_seconds() / 60.0
        employee_id = int(shift["employee_id"])
        shift_id = int(shift["id"])

        if _within_minutes(minutes_until_start, REMINDER_MINUTES_BEFORE):
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_reminder_10:{shift_id}",
                title="Shift in 10 minutes",
                body=(
                    f"Your shift starts at {shift['start_time']} — tap to open the clock at {site_name}."
                ),
                url=clock_url,
                tag=f"shift-{shift_id}-reminder",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_reminder_10", "shift_id": shift_id, **result})
            continue

        if _within_minutes(minutes_after_start, 0):
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_start:{shift_id}",
                title="Clock in now",
                body=f"Your shift at {site_name} has started. Tap to clock in.",
                url=clock_url,
                tag=f"shift-{shift_id}-start",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_start", "shift_id": shift_id, **result})
            continue

        if _within_minutes(minutes_after_start, EARLY_MISSED_CLOCK_IN_MINUTES):
            attendance = evaluate_shift_attendance(
                shift=shift,
                punches=punches_by_employee.get(employee_id, []),
                now=now,
            )
            if attendance["attendance_status"] != "awaiting":
                continue
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_missed_clock_in_10:{shift_id}",
                title="Reminder: clock in for your shift",
                body=(
                    f"Your shift at {site_name} started 10 minutes ago and you have not clocked in yet. "
                    "Tap to clock in now."
                ),
                url=clock_url,
                tag=f"shift-{shift_id}-missed-10",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_missed_clock_in_10", "shift_id": shift_id, **result})
            continue

        if _within_minutes(minutes_after_start, MISSED_CLOCK_IN_MINUTES):
            attendance = evaluate_shift_attendance(
                shift=shift,
                punches=punches_by_employee.get(employee_id, []),
                now=now,
            )
            if attendance["attendance_status"] != "awaiting":
                continue
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_missed_clock_in_30:{shift_id}",
                title="You still haven't clocked in",
                body="Tap to clock in or contact your manager if you're unable to work this shift.",
                url=clock_url,
                tag=f"shift-{shift_id}-missed-30",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_missed_clock_in_30", "shift_id": shift_id, **result})
            continue

        if _within_minutes(minutes_after_end, 0):
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_end:{shift_id}",
                title="Shift ending now",
                body=f"Your shift at {site_name} ends now — tap to clock out.",
                url=clock_url,
                tag=f"shift-{shift_id}-end",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_end", "shift_id": shift_id, **result})

    return sent
