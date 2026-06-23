"""Missed clock-in alerts — compare published rota to time punches (no background GPS)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from modules.rota.attendance import evaluate_shift_attendance, load_punches_for_employees
from modules.rota.service import shift_window

UK_TZ = ZoneInfo("Europe/London")

MISSED_PUNCH_ALERT_MINUTES = 15


def _parse_now(now: datetime | None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    return now if now.tzinfo else now.replace(tzinfo=timezone.utc)


def tenant_has_active_punch_sites(*, tenant_id: int, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM punch_sites
            WHERE tenant_id = %s AND is_active = TRUE
            LIMIT 1
            """,
            (tenant_id,),
        )
        return cur.fetchone() is not None


def list_published_shifts_on_date(*, tenant_id: int, on_date: date, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.employee_id, s.shift_date, s.start_time, s.end_time,
                   s.role_label, s.notes,
                   trim(both ' ' from coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
                   e.email, e.email_notifications_enabled
            FROM rota_shifts s
            JOIN rota_weeks w ON w.id = s.rota_week_id AND w.tenant_id = s.tenant_id
            JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
            WHERE s.tenant_id = %s
              AND s.shift_date = %s
              AND w.status = 'published'
              AND e.status IN ('active', 'onboarding')
            ORDER BY s.start_time, s.id
            """,
            (tenant_id, on_date),
        )
        rows = cur.fetchall()
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
            "employee_email": row[8] or "",
            "email_notifications_enabled": bool(row[9]),
        }
        for row in rows
    ]


def count_missed_punch_alerts_on_date(*, tenant_id: int, on_date: date, conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM rota_missed_punch_alerts
            WHERE tenant_id = %s AND shift_date = %s
            """,
            (tenant_id, on_date),
        )
        return int(cur.fetchone()[0])


def evaluate_missed_punch_alerts(
    *,
    tenant_id: int,
    conn: Any,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    After shift start + grace period, if no clock-in exists, notify HR and optionally the employee.
    Returns newly created alert records.
    """
    now = _parse_now(now)
    if not tenant_has_active_punch_sites(tenant_id=tenant_id, conn=conn):
        return []

    on_date = now.astimezone(UK_TZ).date()
    shifts = list_published_shifts_on_date(tenant_id=tenant_id, on_date=on_date, conn=conn)
    if not shifts:
        return []

    from admin_service import get_notification_preferences
    from modules.employees.notification_branding import (
        employee_notification_from_name,
        employer_legal_name,
    )

    prefs = get_notification_preferences(tenant_id=tenant_id, conn=conn)["preferences"]
    hr_delivery = prefs.get("missed_punch_hr", "email")
    employee_delivery = prefs.get("missed_punch_employee", "email")
    if hr_delivery == "off" and employee_delivery == "off":
        return []

    hr_tenant_name = employer_legal_name(tenant_id=tenant_id, conn=conn)
    employee_from_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)

    employee_ids = sorted({int(s["employee_id"]) for s in shifts})
    punches_by_employee = load_punches_for_employees(
        tenant_id=tenant_id,
        employee_ids=employee_ids,
        from_date=on_date,
        to_date=on_date,
        conn=conn,
    )

    created: list[dict[str, Any]] = []
    for shift in shifts:
        shift_date = date.fromisoformat(str(shift["shift_date"])[:10])
        start_time = time.fromisoformat(str(shift["start_time"])[:5])
        end_time = time.fromisoformat(str(shift["end_time"])[:5])
        window_start, window_end = shift_window(
            shift_date=shift_date,
            start_time=start_time,
            end_time=end_time,
        )
        alert_at = window_start + timedelta(minutes=MISSED_PUNCH_ALERT_MINUTES)
        if now < alert_at or now > window_end:
            continue

        attendance = evaluate_shift_attendance(
            shift=shift,
            punches=punches_by_employee.get(int(shift["employee_id"]), []),
            now=now,
        )
        if attendance["attendance_status"] != "awaiting":
            continue

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO rota_missed_punch_alerts (
                  tenant_id, rota_shift_id, employee_id, alert_type,
                  shift_date, shift_start_at
                ) VALUES (%s, %s, %s, 'missed_clock_in', %s, %s)
                ON CONFLICT (tenant_id, rota_shift_id, alert_type) DO NOTHING
                RETURNING id
                """,
                (tenant_id, shift["id"], shift["employee_id"], shift_date, window_start),
            )
            row = cur.fetchone()
        if not row:
            continue

        alert_id = int(row[0])
        notified_hr = False
        notified_employee = False

        shift_label = (
            f"{shift_date.strftime('%a %d %b')} · {shift['start_time']}–{shift['end_time']}"
        )

        if hr_delivery != "off":
            from core.email_templates import missed_punch_hr_email
            from core.notifications import queue_notification

            content = missed_punch_hr_email(
                tenant_name=hr_tenant_name,
                employee_name=shift["employee_name"],
                shift_label=shift_label,
                role_label=shift.get("role_label") or "",
                grace_minutes=MISSED_PUNCH_ALERT_MINUTES,
            )
            channels = ["email", "sms"] if hr_delivery == "email_sms" else ["email"]
            for channel in channels:
                queue_notification(
                    conn=conn,
                    tenant_id=tenant_id,
                    channel=channel,
                    subject=content.subject,
                    body=content.text,
                    payload={"html": content.html, "alert_id": alert_id, "shift_id": shift["id"]},
                    purpose="compliance" if channel == "email" else "general",
                    commit=False,
                )
            notified_hr = True

        if (
            employee_delivery != "off"
            and shift.get("employee_email")
            and shift.get("email_notifications_enabled")
        ):
            from core.email_templates import missed_punch_employee_email
            from core.notifications import send_email_content

            content = missed_punch_employee_email(
                employee_name=shift["employee_name"],
                tenant_name=employee_from_name,
                shift_label=shift_label,
                grace_minutes=MISSED_PUNCH_ALERT_MINUTES,
            )
            send_email_content(
                conn=conn,
                tenant_id=tenant_id,
                to=shift["employee_email"],
                content=content,
                purpose="employee",
                audience="employee",
                payload={"alert_id": alert_id, "shift_id": shift["id"]},
                commit=False,
            )
            notified_employee = True

        from modules.push.service import app_url_path, send_employee_push

        push_result = send_employee_push(
            tenant_id=tenant_id,
            employee_id=int(shift["employee_id"]),
            notification_key=f"missed_punch_alert:{shift['id']}",
            title="Missed clock-in — tap to clock in now",
            body=f"Your shift {shift_label} started but you have not clocked in yet.",
            url=app_url_path("employee.html#time-clock"),
            tag=f"missed-punch-{shift['id']}",
            alert_type="missed_clock_in",
            conn=conn,
        )
        if push_result.get("sent"):
            notified_employee = True

        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE rota_missed_punch_alerts
                SET notified_hr = %s, notified_employee = %s
                WHERE id = %s
                """,
                (notified_hr, notified_employee, alert_id),
            )
        conn.commit()

        created.append(
            {
                "alert_id": alert_id,
                "shift_id": shift["id"],
                "employee_id": shift["employee_id"],
                "employee_name": shift["employee_name"],
                "shift_label": shift_label,
                "notified_hr": notified_hr,
                "notified_employee": notified_employee,
            }
        )

    return created
