"""Shift-relative push reminders — cron-driven, no background GPS."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from modules.employees.business_schedule import get_business_schedule, local_now
from modules.push.service import app_url_path, send_employee_push
from modules.rota.attendance import evaluate_shift_attendance, load_punches_for_employees
from modules.rota.missed_punch import list_published_shifts_on_date, tenant_has_active_punch_sites
from modules.rota.service import shift_window

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
    """Send shift start / end / reminder / missed clock-in pushes when due."""
    now = _parse_now(now)
    schedule = get_business_schedule(tenant_id=tenant_id, conn=conn)
    on_date = local_now(now=now, schedule=schedule).date()
    shifts = list_published_shifts_on_date(tenant_id=tenant_id, on_date=on_date, conn=conn)
    if not shifts:
        return []

    has_punch_sites = tenant_has_active_punch_sites(tenant_id=tenant_id, conn=conn)
    reminder_before = schedule.shift_reminder_minutes_before
    end_reminder_before = schedule.shift_end_reminder_minutes_before
    missed_early = schedule.missed_clock_in_early_minutes
    missed_late = schedule.missed_clock_in_late_minutes

    site_name = _primary_site_name(tenant_id=tenant_id, conn=conn) if has_punch_sites else "your workplace"
    rota_url = _app_path("employee.html#my-shifts")
    clock_url = _app_path("employee.html#time-clock") if has_punch_sites else rota_url
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
        minutes_until_end = (window_end - now).total_seconds() / 60.0
        minutes_after_end = (now - window_end).total_seconds() / 60.0
        employee_id = int(shift["employee_id"])
        shift_id = int(shift["id"])

        if _within_minutes(minutes_until_start, reminder_before):
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_reminder_{reminder_before}:{shift_id}",
                title=f"Shift in {reminder_before} minutes",
                body=(
                    f"Your shift starts at {shift['start_time']} — tap to view your rota at {site_name}."
                ),
                url=rota_url,
                tag=f"shift-{shift_id}-reminder",
                alert_type="shift_reminder",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": f"shift_reminder_{reminder_before}", "shift_id": shift_id, **result})
            continue

        if has_punch_sites and _within_minutes(minutes_after_start, 0):
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_start:{shift_id}",
                title="Clock in now",
                body=f"Your shift at {site_name} has started. Tap to clock in.",
                url=clock_url,
                tag=f"shift-{shift_id}-start",
                alert_type="clock_in",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_start", "shift_id": shift_id, **result})
            continue

        if has_punch_sites and _within_minutes(minutes_after_start, missed_early):
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
                notification_key=f"shift_missed_clock_in_{missed_early}:{shift_id}",
                title="Reminder: clock in for your shift",
                body=(
                    f"Your shift at {site_name} started {missed_early} minutes ago and you have not clocked in yet. "
                    "Tap to clock in now."
                ),
                url=clock_url,
                tag=f"shift-{shift_id}-missed-{missed_early}",
                alert_type="missed_clock_in_early",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": f"shift_missed_clock_in_{missed_early}", "shift_id": shift_id, **result})
            continue

        if has_punch_sites and _within_minutes(minutes_after_start, missed_late):
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
                notification_key=f"shift_missed_clock_in_{missed_late}:{shift_id}",
                title="You still haven't clocked in",
                body="Tap to clock in or contact your manager if you're unable to work this shift.",
                url=clock_url,
                tag=f"shift-{shift_id}-missed-{missed_late}",
                alert_type="missed_clock_in",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": f"shift_missed_clock_in_{missed_late}", "shift_id": shift_id, **result})
            continue

        if _within_minutes(minutes_until_end, end_reminder_before) and minutes_until_end > 0:
            attendance = evaluate_shift_attendance(
                shift=shift,
                punches=punches_by_employee.get(employee_id, []),
                now=now,
            )
            # Only nudge clock-out when they are (or were) on the clock
            if has_punch_sites and not attendance.get("clock_in_at"):
                continue
            if has_punch_sites and attendance.get("clock_out_at"):
                continue
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_end_reminder_{end_reminder_before}:{shift_id}",
                title=f"Shift ends in {end_reminder_before} minutes",
                body=(
                    f"Your shift ends at {shift['end_time']} — tap to clock out at {site_name}."
                    if has_punch_sites
                    else f"Your shift ends at {shift['end_time']} — tap to view your rota."
                ),
                url=clock_url if has_punch_sites else rota_url,
                tag=f"shift-{shift_id}-end-reminder",
                alert_type="shift_end_reminder",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": f"shift_end_reminder_{end_reminder_before}", "shift_id": shift_id, **result})
            continue

        if has_punch_sites and _within_minutes(minutes_after_end, 0):
            attendance = evaluate_shift_attendance(
                shift=shift,
                punches=punches_by_employee.get(employee_id, []),
                now=now,
            )
            if not attendance.get("clock_in_at") or attendance.get("clock_out_at"):
                continue
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_end:{shift_id}",
                title="Clock out now",
                body=f"Your shift at {site_name} ends now — tap to clock out.",
                url=clock_url,
                tag=f"shift-{shift_id}-end",
                alert_type="clock_out",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_end", "shift_id": shift_id, **result})
            continue

        if has_punch_sites and _within_minutes(minutes_after_end, 15):
            attendance = evaluate_shift_attendance(
                shift=shift,
                punches=punches_by_employee.get(employee_id, []),
                now=now,
            )
            if attendance.get("attendance_status") != "missing_clock_out":
                continue
            result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"shift_missed_clock_out:{shift_id}",
                title="Reminder: clock out",
                body=(
                    f"Your shift at {site_name} ended 15 minutes ago and you are still clocked in. "
                    "Tap to clock out now."
                ),
                url=clock_url,
                tag=f"shift-{shift_id}-missed-out",
                alert_type="missed_clock_out",
                conn=conn,
            )
            if result.get("sent"):
                sent.append({"type": "shift_missed_clock_out", "shift_id": shift_id, **result})

            try:
                from admin_service import get_notification_preferences
                from modules.employees.notification_branding import employer_legal_name
                from modules.push.hr_notify import notify_hr_missed_clock_out

                prefs = get_notification_preferences(tenant_id=tenant_id, conn=conn)["preferences"]
                employee_name = (
                    attendance.get("employee_name")
                    or shift.get("employee_name")
                    or f"Employee #{employee_id}"
                )
                shift_label = (
                    f"{shift.get('shift_date')} {shift.get('start_time')}–{shift.get('end_time')}"
                )
                hr_result = notify_hr_missed_clock_out(
                    tenant_id=tenant_id,
                    shift_label=shift_label,
                    employee_name=str(employee_name),
                    shift_id=shift_id,
                    tenant_name=employer_legal_name(tenant_id=tenant_id, conn=conn),
                    minutes_after_end=15,
                    preferences=prefs,
                    conn=conn,
                )
                if hr_result.get("sent"):
                    sent.append({"type": "missed_clock_out_hr", "shift_id": shift_id, **hr_result})
            except Exception:
                pass

    return sent
