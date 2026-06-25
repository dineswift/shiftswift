"""Email staff when a rota week is published or updated."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any, Literal

from core.notifications import send_email_content
from modules.push.service import app_url_path, send_employee_push

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
ChangeKind = Literal["initial", "updated", "added", "removed"]


def _looks_like_email(value: str | None) -> bool:
    return bool(value and _EMAIL_RE.match(str(value).strip()))


def _week_label(week_start: date) -> str:
    week_end = week_start + timedelta(days=6)
    start_fmt = week_start.strftime("%d %b")
    end_fmt = week_end.strftime("%d %b %Y")
    return f"{start_fmt} – {end_fmt}"


def _normalize_shift(shift: dict[str, Any]) -> dict[str, Any]:
    return {
        "employee_id": int(shift["employee_id"]),
        "shift_date": str(shift["shift_date"])[:10],
        "start_time": str(shift.get("start_time") or "")[:5],
        "end_time": str(shift.get("end_time") or "")[:5],
        "role_label": str(shift.get("role_label") or ""),
        "notes": str(shift.get("notes") or ""),
    }


def snapshot_from_shifts(shifts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_normalize_shift(shift) for shift in shifts]


def _shift_set_for_employee(shifts: list[dict[str, Any]], employee_id: int) -> frozenset[tuple[str, ...]]:
    tuples: list[tuple[str, ...]] = []
    for shift in shifts:
        if int(shift["employee_id"]) != employee_id:
            continue
        normalized = _normalize_shift(shift)
        tuples.append(
            (
                normalized["shift_date"],
                normalized["start_time"],
                normalized["end_time"],
                normalized["role_label"],
                normalized["notes"],
            )
        )
    return frozenset(tuples)


def employees_to_notify(
    *,
    previous_shifts: list[dict[str, Any]] | None,
    current_shifts: list[dict[str, Any]],
) -> dict[int, ChangeKind]:
    """Return employees who should be notified and why."""
    if not previous_shifts:
        return {int(shift["employee_id"]): "initial" for shift in current_shifts}

    previous_ids = {int(shift["employee_id"]) for shift in previous_shifts}
    current_ids = {int(shift["employee_id"]) for shift in current_shifts}
    affected: dict[int, ChangeKind] = {}

    for employee_id in previous_ids | current_ids:
        old_set = _shift_set_for_employee(previous_shifts, employee_id)
        new_set = _shift_set_for_employee(current_shifts, employee_id)
        if old_set == new_set:
            continue
        if not new_set:
            affected[employee_id] = "removed"
        elif not old_set:
            affected[employee_id] = "added"
        else:
            affected[employee_id] = "updated"

    return affected


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


def _shifts_for_employee(shifts: list[dict[str, Any]], employee_id: int) -> list[dict[str, Any]]:
    return [shift for shift in shifts if int(shift["employee_id"]) == employee_id]


def notify_rota_published(
    *,
    tenant_id: int,
    week_start: date,
    shifts: list[dict[str, Any]],
    conn: Any,
    previous_shifts: list[dict[str, Any]] | None = None,
) -> dict[str, int | str]:
    """Email and push staff — all on first publish, only affected employees on updates."""
    from admin_service import get_tenant_profile, tenant_notification_delivery_enabled
    from core.email_templates import rota_published_email, rota_updated_email
    from modules.employees.notification_branding import employee_notification_from_name

    notify_map = employees_to_notify(previous_shifts=previous_shifts, current_shifts=shifts)
    is_update = bool(previous_shifts)
    if not notify_map:
        if is_update and previous_shifts:
            all_ids = {int(s["employee_id"]) for s in previous_shifts} | {
                int(s["employee_id"]) for s in shifts
            }
            unchanged = len(all_ids)
        else:
            unchanged = 0
        return {
            "mode": "update" if is_update else "initial",
            "emails_sent": 0,
            "emails_skipped": 0,
            "pushes_sent": 0,
            "employees_notified": 0,
            "employees_unchanged": unchanged,
        }

    delivery_enabled = tenant_notification_delivery_enabled(
        tenant_id=tenant_id,
        event_id="rota_published",
        conn=conn,
    )
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    if not profile.get("notify_on_rota_publish", True):
        return {
            "mode": "update" if is_update else "initial",
            "emails_sent": 0,
            "emails_skipped": len(notify_map),
            "pushes_sent": 0,
            "employees_notified": 0,
            "employees_unchanged": len({int(s["employee_id"]) for s in shifts}) - len(notify_map),
        }

    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    week_label = _week_label(week_start)
    rota_url = app_url_path("employee.html#my-shifts")

    employee_ids = list(notify_map.keys())
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
    for employee_id, change_kind in notify_map.items():
        row = rows.get(employee_id)
        if not row:
            skipped += 1
            continue

        employee_name = f"{row[1]} {row[2]}".strip() or "there"
        employee_shifts = _shifts_for_employee(shifts, employee_id)
        shift_lines = _shift_summary_lines(employee_shifts)
        shift_count = len(employee_shifts)

        if delivery_enabled and row[4]:
            email = (row[3] or "").strip()
            if _looks_like_email(email):
                if change_kind == "initial":
                    content = rota_published_email(
                        employee_name=employee_name,
                        tenant_name=tenant_name,
                        week_label=week_label,
                        shift_lines=shift_lines,
                    )
                    payload_type = "rota_published"
                else:
                    content = rota_updated_email(
                        employee_name=employee_name,
                        tenant_name=tenant_name,
                        week_label=week_label,
                        shift_lines=shift_lines,
                        change_kind=change_kind,
                    )
                    payload_type = "rota_updated"
                send_email_content(
                    conn=conn,
                    tenant_id=tenant_id,
                    content=content,
                    purpose="employee",
                    to=email,
                    audience="employee",
                    payload={
                        "type": payload_type,
                        "employee_id": employee_id,
                        "week_start": week_start.isoformat(),
                        "change_kind": change_kind,
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
            if change_kind == "initial":
                push_key = f"rota_published:{week_start.isoformat()}:{employee_id}"
                push_title = "Your rota is ready — ShiftSwift HR"
                push_body = (
                    f"Your rota for {week_label} is ready — "
                    f"{shift_count} shift{'s' if shift_count != 1 else ''}. Tap to view your shifts."
                )
                push_tag = f"rota-{week_start.isoformat()}"
            elif change_kind == "removed":
                push_key = f"rota_updated:{week_start.isoformat()}:{employee_id}:removed"
                push_title = "Schedule update — ShiftSwift HR"
                push_body = f"Your schedule for {week_label} changed — you're no longer on the rota this week."
                push_tag = f"rota-update-{week_start.isoformat()}"
            else:
                push_key = f"rota_updated:{week_start.isoformat()}:{employee_id}"
                push_title = "Schedule update — ShiftSwift HR"
                shift_suffix = (
                    f" — {shift_count} shift{'s' if shift_count != 1 else ''}" if shift_count else ""
                )
                push_body = f"Your shifts for {week_label} were updated{shift_suffix}. Tap to view."
                push_tag = f"rota-update-{week_start.isoformat()}"

            push_result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=push_key,
                title=push_title,
                body=push_body,
                url=rota_url,
                tag=push_tag,
                conn=conn,
            )
            pushes_sent += int(push_result.get("sent") or 0)

    all_scheduled = {int(s["employee_id"]) for s in shifts}
    unchanged_count = 0
    if is_update and previous_shifts:
        all_ids = {int(s["employee_id"]) for s in previous_shifts} | all_scheduled
        unchanged_count = sum(1 for employee_id in all_ids if employee_id not in notify_map)

    conn.commit()
    return {
        "mode": "update" if is_update else "initial",
        "emails_sent": sent,
        "emails_skipped": skipped,
        "pushes_sent": pushes_sent,
        "employees_notified": len(notify_map),
        "employees_unchanged": unchanged_count,
    }


def save_published_snapshot(
    *,
    conn: Any,
    week_id: int,
    shifts: list[dict[str, Any]],
) -> None:
    payload = json.dumps(snapshot_from_shifts(shifts))
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE rota_weeks
            SET published_shift_snapshot = %s::jsonb
            WHERE id = %s
            """,
            (payload, week_id),
        )
    conn.commit()
