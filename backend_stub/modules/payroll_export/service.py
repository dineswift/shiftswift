"""CSV exports compatible with BrightPay / Xero employee import workflows."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from admin_service import list_employees

UK_TZ = ZoneInfo("Europe/London")

EMPLOYEE_CSV_COLUMNS = (
    "ShiftSwift Employee ID",
    "Forename",
    "Surname",
    "Email",
    "Phone",
    "NI Number",
    "Date of Birth",
    "Start Date",
    "Job Title",
    "Department",
    "Employment Type",
    "Annual Salary",
    "Status",
    "Home Address",
    "Work Location",
)

HOURS_CSV_COLUMNS = (
    "Section",
    "Employee",
    "From",
    "To",
    "Clock in",
    "Clock out",
    "Break",
    "Hours",
    "Hours decimal",
    "Days",
    "Status",
)


def _employee_row(emp: dict[str, Any]) -> list[str]:
    return [
        str(emp.get("id") or ""),
        str(emp.get("first_name") or ""),
        str(emp.get("last_name") or ""),
        str(emp.get("email") or ""),
        str(emp.get("phone") or ""),
        str(emp.get("ni_number") or ""),
        str(emp.get("date_of_birth") or ""),
        str(emp.get("start_date") or ""),
        str(emp.get("job_title") or ""),
        str(emp.get("department") or ""),
        str(emp.get("employment_type") or ""),
        "" if emp.get("salary") is None else f"{float(emp['salary']):.2f}",
        str(emp.get("status") or ""),
        str(emp.get("home_address") or ""),
        str(emp.get("work_location") or ""),
    ]


def build_employees_csv(*, tenant_id: int, conn: Any) -> str:
    employees = list_employees(tenant_id=tenant_id, conn=conn, limit=5000)
    active = [e for e in employees if e.get("status") in {"active", "onboarding", "suspended"}]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EMPLOYEE_CSV_COLUMNS)
    for emp in active:
        writer.writerow(_employee_row(emp))
    return buffer.getvalue()


def _day_hours_from_events(
    events: list[tuple[str, datetime]],
) -> tuple[float | None, datetime | None, datetime | None, bool, list[tuple[datetime, datetime, float]]]:
    """Sum sequential in/out pairs for one employee-day; break gaps are excluded."""
    ordered = sorted(events, key=lambda item: item[1])
    segments: list[tuple[datetime, datetime, float]] = []
    pending_in: datetime | None = None
    orphans = 0
    for typ, ts in ordered:
        if typ == "in":
            if pending_in is not None:
                orphans += 1
            pending_in = ts
        elif typ == "out":
            if pending_in is not None and ts > pending_in:
                hours = round((ts - pending_in).total_seconds() / 3600, 2)
                segments.append((pending_in, ts, hours))
                pending_in = None
            else:
                orphans += 1
    if pending_in is not None:
        orphans += 1

    if not segments:
        clock_in = next((ts for typ, ts in ordered if typ == "in"), None)
        clock_out = next((ts for typ, ts in reversed(ordered) if typ == "out"), None)
        return None, clock_in, clock_out, False, segments

    total = round(sum(segment[2] for segment in segments), 2)
    complete = orphans == 0
    return total, segments[0][0], segments[-1][1], complete, segments


def _pair_punch_hours(
    punches: list[tuple[Any, ...]],
) -> list[tuple[int, str, str, date, datetime | None, datetime | None, float | None]]:
    """One row per employee per day with hours summed across split shifts."""
    by_emp_day: dict[tuple[int, date], list[tuple[str, datetime]]] = {}
    names: dict[int, tuple[str, str]] = {}
    for emp_id, first, last, punch_type, punched_at in punches:
        names[int(emp_id)] = (str(first or ""), str(last or ""))
        if not isinstance(punched_at, datetime):
            continue
        if punched_at.tzinfo is None:
            punched_at = punched_at.replace(tzinfo=timezone.utc)
        day = punched_at.astimezone(UK_TZ).date()
        by_emp_day.setdefault((int(emp_id), day), []).append((punch_type, punched_at))

    rows: list[tuple[int, str, str, date, datetime | None, datetime | None, float | None]] = []
    for (emp_id, day), events in sorted(by_emp_day.items()):
        first_name, last_name = names.get(emp_id, ("", ""))
        total, clock_in, clock_out, complete, _segments = _day_hours_from_events(events)
        hours = total if complete else None
        rows.append((emp_id, first_name, last_name, day, clock_in, clock_out, hours))
    return rows


def _pair_punch_segments(
    punches: list[tuple[Any, ...]],
) -> list[tuple[int, str, str, date, datetime, datetime, float]]:
    """One row per complete in/out segment (multiple rows per day when staff clock out for breaks)."""
    by_emp_day: dict[tuple[int, date], list[tuple[str, datetime]]] = {}
    names: dict[int, tuple[str, str]] = {}
    for emp_id, first, last, punch_type, punched_at in punches:
        names[int(emp_id)] = (str(first or ""), str(last or ""))
        if not isinstance(punched_at, datetime):
            continue
        if punched_at.tzinfo is None:
            punched_at = punched_at.replace(tzinfo=timezone.utc)
        day = punched_at.astimezone(UK_TZ).date()
        by_emp_day.setdefault((int(emp_id), day), []).append((punch_type, punched_at))

    rows: list[tuple[int, str, str, date, datetime, datetime, float]] = []
    for (emp_id, day), events in sorted(by_emp_day.items()):
        first_name, last_name = names.get(emp_id, ("", ""))
        _total, _clock_in, _clock_out, _complete, segments = _day_hours_from_events(events)
        for seg_in, seg_out, hours in segments:
            rows.append((emp_id, first_name, last_name, day, seg_in, seg_out, hours))
    return rows


def _normalize_period(
    *,
    from_date: date | None,
    to_date: date | None,
) -> tuple[date, date]:
    today = datetime.now(timezone.utc).date()
    start = from_date or today.replace(day=1)
    end = to_date or today
    if end < start:
        start, end = end, start
    return start, end


def _fetch_punch_rows(
    *,
    tenant_id: int,
    conn: Any,
    from_date: date,
    to_date: date,
    employee_id: int | None = None,
    punch_site_id: int | None = None,
) -> list[tuple[Any, ...]]:
    clauses = [
        "tp.tenant_id = %s",
        "tp.punched_at >= %s",
        "tp.punched_at < %s",
    ]
    params: list[Any] = [
        tenant_id,
        datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc),
        datetime.combine(to_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
    ]
    if employee_id:
        clauses.append("tp.employee_id = %s")
        params.append(employee_id)
    if punch_site_id:
        clauses.append("tp.punch_site_id = %s")
        params.append(punch_site_id)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT tp.employee_id, e.first_name, e.last_name, tp.punch_type, tp.punched_at
            FROM time_punches tp
            JOIN employees e ON e.id = tp.employee_id AND e.tenant_id = tp.tenant_id
            WHERE {" AND ".join(clauses)}
            ORDER BY tp.employee_id, tp.punched_at
            """,
            params,
        )
        return cur.fetchall()


def format_hours_hm(hours: float | None) -> str:
    if hours is None:
        return ""
    minutes = int(round(float(hours) * 60))
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    hours_part, mins = divmod(minutes, 60)
    return f"{sign}{hours_part}h {mins:02d}m"


def _uk_date(value: date) -> str:
    return f"{value.day} {value.strftime('%b %Y')}"


def _week_commencing(day: date, week_start: int) -> date:
    delta = (day.weekday() - int(week_start)) % 7
    return day - timedelta(days=delta)


def _clip_date(value: date, start: date, end: date) -> date:
    if value < start:
        return start
    if value > end:
        return end
    return value


def _month_end(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1) - timedelta(days=1)
    return date(value.year, value.month + 1, 1) - timedelta(days=1)


def _range_basis(start: date, end: date, week_start: int) -> str:
    if start == end:
        return "Daily"
    same_week = _week_commencing(start, week_start) == _week_commencing(end, week_start)
    if same_week and (end - start).days <= 6:
        return "Weekly"
    if start.day == 1 and end == _month_end(start):
        return "Monthly"
    return "Custom dates"


def _break_hours(segments: list[tuple[datetime, datetime, float]]) -> float:
    gap = 0.0
    for index in range(1, len(segments)):
        gap += max(0.0, (segments[index][0] - segments[index - 1][1]).total_seconds() / 3600)
    return round(gap, 2)


def _timesheet_lines(
    day_rows: list[dict[str, Any]],
    *,
    period_start: date,
    period_end: date,
    week_start: int,
) -> list[dict[str, Any]]:
    """Daily rows with a total after each week, each month, and the whole date range."""
    lines: list[dict[str, Any]] = []
    if not day_rows:
        return lines

    by_month: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for row in day_rows:
        by_month.setdefault((row["date"].year, row["date"].month), []).append(row)

    period_hours = 0.0
    period_days = 0
    period_break = 0.0
    for year, month in sorted(by_month):
        month_rows = by_month[(year, month)]
        month_hours = 0.0
        month_days = 0
        month_break = 0.0
        by_week: dict[date, list[dict[str, Any]]] = {}
        for row in month_rows:
            by_week.setdefault(row["week_start"], []).append(row)
        for commencing in sorted(by_week):
            week_rows = by_week[commencing]
            week_hours = 0.0
            week_days = 0
            week_break = 0.0
            for row in week_rows:
                lines.append({"kind": "day", **row})
                if row["hours"] is not None:
                    week_hours += float(row["hours"])
                    week_days += 1
                    week_break += float(row.get("break_hours") or 0)
            week_hours = round(week_hours, 2)
            week_break = round(week_break, 2)
            week_from = _clip_date(commencing, period_start, period_end)
            week_to = _clip_date(commencing + timedelta(days=6), period_start, period_end)
            month_bound_start = date(year, month, 1)
            month_bound_end = _month_end(month_bound_start)
            week_from = max(week_from, month_bound_start)
            week_to = min(week_to, month_bound_end)
            lines.append(
                {
                    "kind": "week",
                    "label": f"Week of {_uk_date(commencing)}",
                    "from_date": week_from,
                    "to_date": week_to,
                    "hours": week_hours,
                    "break_hours": week_break,
                    "days": week_days,
                }
            )
            month_hours += week_hours
            month_days += week_days
            month_break += week_break
        month_hours = round(month_hours, 2)
        month_break = round(month_break, 2)
        month_from = _clip_date(date(year, month, 1), period_start, period_end)
        month_to = _clip_date(_month_end(date(year, month, 1)), period_start, period_end)
        lines.append(
            {
                "kind": "month",
                "label": date(year, month, 1).strftime("%B %Y"),
                "from_date": month_from,
                "to_date": month_to,
                "hours": month_hours,
                "break_hours": month_break,
                "days": month_days,
            }
        )
        period_hours += month_hours
        period_days += month_days
        period_break += month_break

    lines.append(
        {
            "kind": "period",
            "label": f"{_uk_date(period_start)} to {_uk_date(period_end)}",
            "from_date": period_start,
            "to_date": period_end,
            "hours": round(period_hours, 2),
            "break_hours": round(period_break, 2),
            "days": period_days,
        }
    )
    return lines


def _format_clock_time(value: datetime | None) -> str:
    if not value:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(UK_TZ).strftime("%H:%M")


def _sheet_day_rows(
    punches: list[tuple[Any, ...]],
    *,
    week_start: int,
) -> dict[int, dict[str, Any]]:
    by_emp_day: dict[tuple[int, date], list[tuple[str, datetime]]] = {}
    names: dict[int, tuple[str, str]] = {}
    for emp_id, first, last, punch_type, punched_at in punches:
        names[int(emp_id)] = (str(first or ""), str(last or ""))
        if punch_type not in {"in", "out"} or not isinstance(punched_at, datetime):
            continue
        if punched_at.tzinfo is None:
            punched_at = punched_at.replace(tzinfo=timezone.utc)
        day = punched_at.astimezone(UK_TZ).date()
        by_emp_day.setdefault((int(emp_id), day), []).append((str(punch_type), punched_at))

    sheets: dict[int, dict[str, Any]] = {}
    for (emp_id, day), events in sorted(by_emp_day.items()):
        first_name, last_name = names.get(emp_id, ("", ""))
        total, clock_in, clock_out, complete, segments = _day_hours_from_events(events)
        hours = total if complete else None
        break_hours = _break_hours(segments) if complete else 0.0
        sheet = sheets.setdefault(
            emp_id,
            {
                "employee_id": emp_id,
                "first_name": first_name,
                "last_name": last_name,
                "name": f"{first_name} {last_name}".strip() or f"Employee {emp_id}",
                "days": [],
            },
        )
        sheet["days"].append(
            {
                "date": day,
                "date_label": day.strftime("%a ") + _uk_date(day),
                "week_start": _week_commencing(day, week_start),
                "clock_in": _format_clock_time(clock_in),
                "clock_out": _format_clock_time(clock_out),
                "break_hours": break_hours,
                "hours": hours,
                "status": "complete" if complete else "incomplete",
            }
        )
    return sheets


def build_hours_report(
    *,
    tenant_id: int,
    conn: Any,
    from_date: date | None = None,
    to_date: date | None = None,
    employee_id: int | None = None,
    punch_site_id: int | None = None,
) -> dict[str, Any]:
    from admin_service import get_tenant_profile

    start, end = _normalize_period(from_date=from_date, to_date=to_date)
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    tenant_name = str(profile.get("trading_name") or profile.get("name") or f"Tenant {tenant_id}")
    week_start = int(profile.get("rota_week_start_day") or 0)
    punches = _fetch_punch_rows(
        tenant_id=tenant_id,
        conn=conn,
        from_date=start,
        to_date=end,
        employee_id=employee_id,
        punch_site_id=punch_site_id,
    )
    sheets = _sheet_day_rows(punches, week_start=week_start)

    employees: list[dict[str, Any]] = []
    grand_total_hours = 0.0
    grand_days = 0
    grand_break = 0.0
    for emp_id in sorted(sheets, key=lambda key: (sheets[key]["name"].lower(), key)):
        sheet = sheets[emp_id]
        lines = _timesheet_lines(
            sheet["days"],
            period_start=start,
            period_end=end,
            week_start=week_start,
        )
        detail_rows = []
        total_hours = 0.0
        days_worked = 0
        incomplete_days = 0
        break_hours = 0.0
        for row in sheet["days"]:
            complete = row["hours"] is not None
            if complete:
                total_hours += float(row["hours"])
                days_worked += 1
                break_hours += float(row["break_hours"] or 0)
            else:
                incomplete_days += 1
            detail_rows.append(
                {
                    "date": row["date"].isoformat(),
                    "date_label": row["date_label"],
                    "clock_in": row["clock_in"],
                    "clock_out": row["clock_out"],
                    "break_hours": row["break_hours"],
                    "hours": row["hours"],
                    "status": row["status"],
                }
            )
        total_hours = round(total_hours, 2)
        break_hours = round(break_hours, 2)
        grand_total_hours += total_hours
        grand_days += days_worked
        grand_break += break_hours
        employees.append(
            {
                "employee_id": emp_id,
                "first_name": sheet["first_name"],
                "last_name": sheet["last_name"],
                "name": sheet["name"],
                "total_hours": total_hours,
                "break_hours": break_hours,
                "days_worked": days_worked,
                "incomplete_days": incomplete_days,
                "rows": detail_rows,
                "lines": lines,
            }
        )

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "from_date": start.isoformat(),
        "to_date": end.isoformat(),
        "period_label": f"{_uk_date(start)} to {_uk_date(end)}",
        "basis": _range_basis(start, end, week_start),
        "generated_at": datetime.now(timezone.utc).astimezone(UK_TZ).strftime("%d %b %Y %H:%M %Z"),
        "timezone": "Europe/London",
        "methodology": (
            "Each day adds up clock-in and clock-out pairs in UK time. "
            "A clock-out and later clock-in on the same day is a break and is not counted as worked time. "
            "Week, month, and date-range totals include complete days only. "
            "A day with a missing clock-in or clock-out is marked incomplete and left out of the totals."
        ),
        "employees": employees,
        "grand_total_hours": round(grand_total_hours, 2),
        "grand_days": grand_days,
        "grand_break_hours": round(grand_break, 2),
        "employee_count": len(employees),
    }


def _csv_hours(hours: float | None) -> tuple[str, str]:
    if hours is None:
        return "", ""
    return format_hours_hm(hours), f"{float(hours):.2f}"


def build_hours_csv(
    *,
    tenant_id: int,
    conn: Any,
    from_date: date | None = None,
    to_date: date | None = None,
    employee_id: int | None = None,
    punch_site_id: int | None = None,
) -> str:
    report = build_hours_report(
        tenant_id=tenant_id,
        conn=conn,
        from_date=from_date,
        to_date=to_date,
        employee_id=employee_id,
        punch_site_id=punch_site_id,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["ShiftSwift HR", "Clock in and clock out"])
    writer.writerow(["Business", report["tenant_name"]])
    writer.writerow(["Dates", report["period_label"]])
    writer.writerow(["From", report["from_date"]])
    writer.writerow(["To", report["to_date"]])
    writer.writerow(["Basis", report["basis"]])
    writer.writerow(["Generated", report["generated_at"]])
    writer.writerow(["Notes", report["methodology"]])
    writer.writerow([])
    writer.writerow(HOURS_CSV_COLUMNS)

    section_names = {
        "day": "Day",
        "week": "Week total",
        "month": "Month total",
        "period": "Period total",
    }
    for employee in report["employees"]:
        for line in employee["lines"]:
            kind = line["kind"]
            if kind == "day":
                hours_label, hours_decimal = _csv_hours(line["hours"])
                break_label = format_hours_hm(line["break_hours"]) if line.get("break_hours") else ""
                writer.writerow(
                    [
                        "Day",
                        employee["name"],
                        line["date"].isoformat(),
                        line["date"].isoformat(),
                        line["clock_in"],
                        line["clock_out"],
                        break_label,
                        hours_label,
                        hours_decimal,
                        "1" if line["hours"] is not None else "0",
                        "Complete" if line["status"] == "complete" else "Incomplete",
                    ]
                )
                continue
            hours_label, hours_decimal = _csv_hours(line["hours"])
            break_label = format_hours_hm(line["break_hours"]) if line.get("break_hours") else ""
            writer.writerow(
                [
                    section_names[kind],
                    employee["name"],
                    line["from_date"].isoformat(),
                    line["to_date"].isoformat(),
                    "",
                    "",
                    break_label,
                    hours_label,
                    hours_decimal,
                    str(line["days"]),
                    line["label"],
                ]
            )
    grand_label, grand_decimal = _csv_hours(report["grand_total_hours"])
    grand_break = format_hours_hm(report["grand_break_hours"]) if report["grand_break_hours"] else ""
    writer.writerow(
        [
            "All employees",
            report["tenant_name"],
            report["from_date"],
            report["to_date"],
            "",
            "",
            grand_break,
            grand_label,
            grand_decimal,
            str(report["grand_days"]),
            report["period_label"],
        ]
    )
    return buffer.getvalue()


def payroll_export_info() -> dict[str, object]:
    return {
        "message": "Download CSV files from ShiftSwift HR and import into BrightPay, Xero, or your accountant's tools.",
        "partners": [
            {
                "id": "brightpay",
                "name": "BrightPay",
                "url": "https://www.brightpay.co.uk/",
                "notes": "Import employees via CSV from Employer > Import/Export.",
            },
            {
                "id": "xero",
                "name": "Xero Payroll",
                "url": "https://www.xero.com/uk/payroll/",
                "notes": "Add employees manually or via CSV depending on your Xero setup.",
            },
        ],
        "exports": {
            "employees_csv": "/admin/payroll-export/employees.csv",
            "hours_csv": "/admin/payroll-export/hours.csv",
            "hours_pdf": "/admin/payroll-export/hours.pdf",
        },
        "employee_fields": list(EMPLOYEE_CSV_COLUMNS),
    }
