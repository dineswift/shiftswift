"""Email staff when a rota week is published."""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from core.notifications import send_email_content
from modules.push.service import app_url_path, send_employee_push

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _looks_like_email(value: str | None) -> bool:
    return bool(value and _EMAIL_RE.match(str(value).strip()))


def _week_label(week_start: date) -> str:
    week_end = week_start + timedelta(days=6)
    start_fmt = week_start.strftime("%d %b")
    end_fmt = week_end.strftime("%d %b %Y")
    return f"{start_fmt} – {end_fmt}"


def _shift_summary_lines(shifts: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for shift in sorted(shifts, key=lambda item: (item.get("shift_date") or "", item.get("start_time") or "")):
        shift_date = date.fromisoformat(str(shift["shift_date"])[:10])
        day = DAY_LABELS[shift_date.weekday()]
        start = str(shift.get("start_time") or "")[:5]
        end = str(shift.get("end_time") or "")[:5]
        role = shift.get("role_label") or "Shift"
        lines.append(f"{day} {shift_date.strftime('%d %b')}: {start}–{end} ({role})")
    return lines


def notify_rota_published(
    *,
    tenant_id: int,
    week_start: date,
    shifts: list[dict[str, Any]],
    conn: Any,
) -> dict[str, int]:
    """Email and push each scheduled employee about their published shifts."""
    from admin_service import get_tenant_profile, tenant_notification_delivery_enabled
    from core.email_templates import rota_published_email
    from modules.employees.notification_branding import employee_notification_from_name

    employee_ids_in_rota = {int(s["employee_id"]) for s in shifts}
    if not employee_ids_in_rota:
        return {"emails_sent": 0, "emails_skipped": 0, "pushes_sent": 0}

    delivery_enabled = tenant_notification_delivery_enabled(
        tenant_id=tenant_id,
        event_id="rota_published",
        conn=conn,
    )
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    if not profile.get("notify_on_rota_publish", True):
        return {
            "emails_sent": 0,
            "emails_skipped": len(employee_ids_in_rota),
            "pushes_sent": 0,
        }

    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    week_label = _week_label(week_start)
    rota_url = app_url_path("employee.html#my-shifts")

    shifts_by_employee: dict[int, list[dict[str, Any]]] = {}
    for shift in shifts:
        shifts_by_employee.setdefault(int(shift["employee_id"]), []).append(shift)

    employee_ids = list(shifts_by_employee.keys())
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, email, email_notifications_enabled
            FROM employees
            WHERE tenant_id = %s AND id = ANY(%s)
            """,
            (tenant_id, employee_ids),
        )
        rows = {row[0]: row for row in cur.fetchall()}

    sent = skipped = pushes_sent = 0
    for employee_id, employee_shifts in shifts_by_employee.items():
        row = rows.get(employee_id)
        if not row:
            skipped += 1
            continue

        employee_name = f"{row[1]} {row[2]}".strip() or "there"
        shift_lines = _shift_summary_lines(employee_shifts)
        shift_count = len(employee_shifts)

        if delivery_enabled and row[4]:
            email = (row[3] or "").strip()
            if _looks_like_email(email):
                content = rota_published_email(
                    employee_name=employee_name,
                    tenant_name=tenant_name,
                    week_label=week_label,
                    shift_lines=shift_lines,
                )
                send_email_content(
                    conn=conn,
                    tenant_id=tenant_id,
                    content=content,
                    purpose="employee",
                    to=email,
                    audience="employee",
                    payload={
                        "type": "rota_published",
                        "employee_id": employee_id,
                        "week_start": week_start.isoformat(),
                    },
                    deliver_now=True,
                    commit=False,
                )
                sent += 1
            else:
                skipped += 1
        else:
            skipped += 1

        if delivery_enabled:
            push_result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=f"rota_published:{week_start.isoformat()}:{employee_id}",
                title="Your rota is ready — ShiftSwift HR",
                body=(
                    f"Your rota for {week_label} is ready — "
                    f"{shift_count} shift{'s' if shift_count != 1 else ''}. Tap to view your shifts."
                ),
                url=rota_url,
                tag=f"rota-{week_start.isoformat()}",
                conn=conn,
            )
            pushes_sent += int(push_result.get("sent") or 0)

    conn.commit()
    return {"emails_sent": sent, "emails_skipped": skipped, "pushes_sent": pushes_sent}
