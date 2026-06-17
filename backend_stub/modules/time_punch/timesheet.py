"""Weekly timesheet grid and manager approvals."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from admin_service import list_employees
from modules.rota.service import get_tenant_rota_week_start_day, week_start_on_or_before

UK_TZ = ZoneInfo("Europe/London")
ApprovalStatus = Literal["pending", "approved", "rejected"]
DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _week_dates(week_start: date) -> list[date]:
    return [week_start + timedelta(days=offset) for offset in range(7)]


def summarize_day_events(events: list[tuple[str, datetime]]) -> dict[str, Any]:
    """Compute work hours, break minutes, and segments for one employee-day."""
    ordered = sorted(events, key=lambda item: item[1])
    segments: list[dict[str, Any]] = []
    break_minutes = 0
    work_seconds = 0
    shift_open: datetime | None = None
    break_open: datetime | None = None
    issues: list[str] = []

    for typ, ts in ordered:
        if typ == "in":
            if shift_open is not None:
                issues.append("Duplicate clock-in")
            shift_open = ts
            break_open = None
        elif typ == "break_start":
            if shift_open is None:
                issues.append("Break started without clock-in")
            elif break_open is not None:
                issues.append("Break already open")
            else:
                break_open = ts
        elif typ == "break_end":
            if break_open is None:
                issues.append("Break ended without start")
            else:
                break_minutes += int((ts - break_open).total_seconds() // 60)
                break_open = None
        elif typ == "out":
            if shift_open is None:
                issues.append("Clock-out without clock-in")
            else:
                if break_open is not None:
                    issues.append("Clock-out during break")
                    break_open = None
                seconds = (ts - shift_open).total_seconds()
                hours = round(max(seconds, 0) / 3600, 2)
                segments.append(
                    {
                        "clock_in": shift_open.astimezone(UK_TZ).isoformat(),
                        "clock_out": ts.astimezone(UK_TZ).isoformat(),
                        "hours": hours,
                    }
                )
                work_seconds += max(seconds, 0)
                shift_open = None

    if shift_open is not None:
        issues.append("Open shift (not clocked out)")
    if break_open is not None:
        issues.append("Open break")

    total_hours = round(work_seconds / 3600, 2) if work_seconds else 0.0
    return {
        "segments": segments,
        "break_minutes": break_minutes,
        "total_hours": total_hours,
        "complete": not issues,
        "issues": issues,
    }


def _load_week_punches(
    *,
    tenant_id: int,
    employee_ids: list[int],
    week_start: date,
    conn: Any,
) -> dict[int, dict[date, list[tuple[str, datetime]]]]:
    week_end = week_start + timedelta(days=6)
    start_ts = datetime.combine(week_start, time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    end_ts = datetime.combine(week_end + timedelta(days=1), time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    grouped: dict[int, dict[date, list[tuple[str, datetime]]]] = {eid: {} for eid in employee_ids}
    if not employee_ids:
        return grouped
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
            (tenant_id, employee_ids, start_ts, end_ts),
        )
        rows = cur.fetchall()
    for employee_id, punch_type, punched_at in rows:
        ts = _parse_ts(punched_at)
        day = ts.astimezone(UK_TZ).date()
        bucket = grouped[int(employee_id)].setdefault(day, [])
        bucket.append((str(punch_type), ts))
    return grouped


def _load_approvals(
    *,
    tenant_id: int,
    week_start: date,
    conn: Any,
) -> dict[int, dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_id, status, note, decided_by, decided_at
            FROM timesheet_week_approvals
            WHERE tenant_id = %s AND week_start = %s
            """,
            (tenant_id, week_start),
        )
        rows = cur.fetchall()
    return {
        int(row[0]): {
            "status": row[1],
            "note": row[2],
            "decided_by": row[3],
            "decided_at": row[4].isoformat() if row[4] else None,
        }
        for row in rows
    }


def _load_employee_punch_log(
    *,
    tenant_id: int,
    employee_id: int,
    week_start: date,
    conn: Any,
) -> dict[date, list[dict[str, Any]]]:
    week_end = week_start + timedelta(days=6)
    start_ts = datetime.combine(week_start, time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    end_ts = datetime.combine(week_end + timedelta(days=1), time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    grouped: dict[date, list[dict[str, Any]]] = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT tp.punch_type, tp.punched_at, ps.name, tp.distance_meters, tp.punch_method
            FROM time_punches tp
            JOIN punch_sites ps ON ps.id = tp.punch_site_id AND ps.tenant_id = tp.tenant_id
            WHERE tp.tenant_id = %s
              AND tp.employee_id = %s
              AND tp.punched_at >= %s
              AND tp.punched_at < %s
            ORDER BY tp.punched_at
            """,
            (tenant_id, employee_id, start_ts, end_ts),
        )
        rows = cur.fetchall()
    punch_labels = {
        "in": "Clock in",
        "out": "Clock out",
        "break_start": "Break start",
        "break_end": "Break end",
    }
    for punch_type, punched_at, site_name, distance_meters, punch_method in rows:
        ts = _parse_ts(punched_at).astimezone(UK_TZ)
        day = ts.date()
        grouped.setdefault(day, []).append(
            {
                "punch_type": str(punch_type),
                "label": punch_labels.get(str(punch_type), str(punch_type)),
                "time": ts.strftime("%H:%M"),
                "punched_at": ts.isoformat(),
                "site_name": site_name,
                "distance_meters": round(float(distance_meters), 1) if distance_meters is not None else None,
                "punch_method": punch_method,
            }
        )
    return grouped


def employee_weekly_timesheet(
    *,
    tenant_id: int,
    employee_id: int,
    week_start: date | None,
    conn: Any,
) -> dict[str, Any]:
    """Read-only weekly punch summary for one employee."""
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    start = week_start_on_or_before(week_start or date.today(), week_start_day)
    end = start + timedelta(days=6)
    punches = _load_week_punches(
        tenant_id=tenant_id,
        employee_ids=[employee_id],
        week_start=start,
        conn=conn,
    )
    punch_log = _load_employee_punch_log(
        tenant_id=tenant_id,
        employee_id=employee_id,
        week_start=start,
        conn=conn,
    )
    approvals = _load_approvals(tenant_id=tenant_id, week_start=start, conn=conn)
    days = _week_dates(start)
    day_summaries: list[dict[str, Any]] = []
    week_total = 0.0
    week_break = 0
    has_issues = False

    for day in days:
        summary = summarize_day_events(punches.get(employee_id, {}).get(day, []))
        week_total += float(summary["total_hours"])
        week_break += int(summary["break_minutes"])
        if summary["issues"]:
            has_issues = True
        day_summaries.append(
            {
                "date": day.isoformat(),
                "label": DAY_LABELS[day.weekday()],
                "total_hours": summary["total_hours"],
                "break_minutes": summary["break_minutes"],
                "segments": summary["segments"],
                "punches": punch_log.get(day, []),
                "complete": summary["complete"],
                "issues": summary["issues"],
            }
        )

    approval = approvals.get(employee_id, {"status": "pending"})
    return {
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "week_start_day": week_start_day,
        "week_total_hours": round(week_total, 2),
        "week_break_minutes": week_break,
        "has_issues": has_issues,
        "approval_status": approval.get("status", "pending"),
        "days": day_summaries,
    }


def weekly_timesheet(
    *,
    tenant_id: int,
    week_start: date | None,
    conn: Any,
) -> dict[str, Any]:
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    start = week_start_on_or_before(week_start or date.today(), week_start_day)
    end = start + timedelta(days=6)
    employees = [
        e
        for e in list_employees(tenant_id=tenant_id, conn=conn, limit=5000)
        if e.get("status") in {"active", "onboarding"}
    ]
    employee_ids = [int(e["id"]) for e in employees]
    punches = _load_week_punches(
        tenant_id=tenant_id,
        employee_ids=employee_ids,
        week_start=start,
        conn=conn,
    )
    approvals = _load_approvals(tenant_id=tenant_id, week_start=start, conn=conn)
    days = _week_dates(start)
    rows: list[dict[str, Any]] = []

    for emp in employees:
        emp_id = int(emp["id"])
        day_summaries: list[dict[str, Any]] = []
        week_total = 0.0
        week_break = 0
        has_issues = False
        for day in days:
            summary = summarize_day_events(punches.get(emp_id, {}).get(day, []))
            week_total += float(summary["total_hours"])
            week_break += int(summary["break_minutes"])
            if summary["issues"]:
                has_issues = True
            day_summaries.append(
                {
                    "date": day.isoformat(),
                    "label": DAY_LABELS[day.weekday()],
                    "total_hours": summary["total_hours"],
                    "break_minutes": summary["break_minutes"],
                    "segments": summary["segments"],
                    "complete": summary["complete"],
                    "issues": summary["issues"],
                }
            )
        approval = approvals.get(emp_id, {"status": "pending"})
        rows.append(
            {
                "employee_id": emp_id,
                "employee_name": f"{emp.get('first_name', '')} {emp.get('last_name', '')}".strip(),
                "week_total_hours": round(week_total, 2),
                "week_break_minutes": week_break,
                "has_issues": has_issues,
                "approval_status": approval.get("status", "pending"),
                "approval_note": approval.get("note"),
                "decided_by": approval.get("decided_by"),
                "decided_at": approval.get("decided_at"),
                "days": day_summaries,
            }
        )

    pending = sum(1 for row in rows if row["approval_status"] == "pending")
    approved = sum(1 for row in rows if row["approval_status"] == "approved")
    return {
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "day_labels": DAY_LABELS,
        "employees": rows,
        "summary": {
            "employee_count": len(rows),
            "pending": pending,
            "approved": approved,
            "rejected": len(rows) - pending - approved,
        },
    }


def set_timesheet_approval(
    *,
    tenant_id: int,
    week_start: date,
    employee_id: int,
    status: ApprovalStatus,
    note: str | None,
    decided_by: str,
    conn: Any,
) -> dict[str, Any]:
    if status not in {"approved", "rejected", "pending"}:
        raise ValueError("Invalid approval status")
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    week = week_start_on_or_before(week_start, week_start_day)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM employees WHERE id = %s AND tenant_id = %s",
            (employee_id, tenant_id),
        )
        if not cur.fetchone():
            raise LookupError("Employee not found")
        cur.execute(
            """
            INSERT INTO timesheet_week_approvals (
              tenant_id, week_start, employee_id, status, note, decided_by, decided_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (tenant_id, week_start, employee_id) DO UPDATE SET
              status = EXCLUDED.status,
              note = EXCLUDED.note,
              decided_by = EXCLUDED.decided_by,
              decided_at = NOW()
            RETURNING status, note, decided_by, decided_at
            """,
            (tenant_id, week, employee_id, status, note, decided_by),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "employee_id": employee_id,
        "week_start": week.isoformat(),
        "status": row[0],
        "note": row[1],
        "decided_by": row[2],
        "decided_at": row[3].isoformat() if row[3] else None,
    }


def approve_all_timesheets(
    *,
    tenant_id: int,
    week_start: date,
    status: ApprovalStatus,
    decided_by: str,
    conn: Any,
) -> dict[str, Any]:
    if status not in {"approved", "rejected"}:
        raise ValueError("Bulk approval must be approved or rejected")
    sheet = weekly_timesheet(tenant_id=tenant_id, week_start=week_start, conn=conn)
    count = 0
    for row in sheet["employees"]:
        if row["has_issues"] and status == "approved":
            continue
        set_timesheet_approval(
            tenant_id=tenant_id,
            week_start=week_start,
            employee_id=int(row["employee_id"]),
            status=status,
            note=None,
            decided_by=decided_by,
            conn=conn,
        )
        count += 1
    return {"updated": count, "status": status, "week_start": sheet["week_start"]}
