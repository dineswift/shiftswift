"""Weekly rota grid PDF export — matches the admin rota builder layout."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from modules.rota.service import (
    get_tenant_rota_week_start_day,
    list_shifts_for_date_range,
    list_shifts_for_week,
    parse_week_start,
    week_dates,
    week_end_date,
)

DAY_OFF_RE = (
    "day off",
    "off day",
    "annual leave",
    "holiday",
    "unpaid leave",
)


def _employee_print_name(first_name: str | None, last_name: str | None) -> str:
    combined = f"{(first_name or '').strip()} {(last_name or '').strip()}".strip()
    return combined or "Staff"


def _employee_short_name(first_name: str | None, last_name: str | None) -> str:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    if first and last:
        return f"{first[0]}. {last.split()[0]}"
    combined = f"{first} {last}".strip()
    return combined or "Staff"


def _employee_role_label(job_title: str | None, department: str | None) -> str:
    title = (job_title or "").strip()
    if title:
        return title
    dept = (department or "").strip()
    return dept or "Staff"


def _is_day_off(shift: dict[str, Any]) -> bool:
    role = (shift.get("role_label") or "").lower()
    return any(token in role for token in DAY_OFF_RE)


def _shift_cell_lines(shift: dict[str, Any], *, fallback_role: str = "") -> list[str]:
    del fallback_role
    if _is_day_off(shift):
        return ["Off"]
    start = str(shift.get("start_time") or "")[:5]
    end = str(shift.get("end_time") or "")[:5]
    if start and end:
        return [f"{start}–{end}"]
    if start:
        return [start]
    if end:
        return [end]
    return []


def _shift_tone(shift: dict[str, Any], *, fallback_role: str) -> str:
    if _is_day_off(shift):
        return "off"
    role = ((shift.get("role_label") or "") or fallback_role).lower()
    if any(token in role for token in ("kitchen", "cook", "chef")):
        return "kitchen"
    if any(token in role for token in ("bar", "floor", "front", "wait", "server")):
        return "floor"
    return "default"


TONE_COLORS = {
    "kitchen": (colors.HexColor("#E1F5EE"), colors.HexColor("#0F6E56")),
    "floor": (colors.HexColor("#E6F1FB"), colors.HexColor("#185FA5")),
    "off": (colors.HexColor("#F2F4F7"), colors.HexColor("#475467")),
    "default": (colors.HexColor("#F4F4F5"), colors.HexColor("#1E293B")),
    "empty": (colors.white, colors.HexColor("#94A3B8")),
    "attended": (colors.HexColor("#D8F3DC"), colors.HexColor("#0B5345")),
    "late": (colors.HexColor("#FFF4E5"), colors.HexColor("#8A4B00")),
    "no_show": (colors.HexColor("#FDECEA"), colors.HexColor("#B42318")),
}

ATTENDANCE_TONE_PRIORITY = ("no_show", "late", "attended")


def _resolve_cell_tone(
    day_shifts: list[dict[str, Any]],
    *,
    fallback_role: str,
    attendance_by_shift_id: dict[int, dict[str, Any]],
) -> str:
    tones: list[str] = []
    for shift in day_shifts:
        shift_id = shift.get("id")
        attendance_status = None
        if shift_id is not None:
            attendance_status = (attendance_by_shift_id.get(int(shift_id)) or {}).get("attendance_status")
        if attendance_status in ATTENDANCE_TONE_PRIORITY:
            tones.append(str(attendance_status))
        else:
            tones.append(_shift_tone(shift, fallback_role=fallback_role))
    for priority in ATTENDANCE_TONE_PRIORITY:
        if priority in tones:
            return priority
    return tones[-1] if tones else "default"


MAX_PRINT_DAYS = 42
PRINT_HEADER_BG = colors.HexColor("#0F6E56")
PRINT_SHIFT_BG = colors.HexColor("#E7F6EF")
PRINT_OFF_BG = colors.HexColor("#F2F4F7")
PRINT_EMPTY_BG = colors.HexColor("#FFFFFF")
PRINT_GRID = colors.HexColor("#D0D5DD")


def parse_print_range(from_date: str, to_date: str) -> tuple[date, date]:
    try:
        start = date.fromisoformat(str(from_date)[:10])
        end = date.fromisoformat(str(to_date)[:10])
    except ValueError as exc:
        raise ValueError("Use dates in YYYY-MM-DD format") from exc
    if end < start:
        raise ValueError("End date must be on or after the start date")
    if (end - start).days + 1 > MAX_PRINT_DAYS:
        raise ValueError("Choose a range of 6 weeks or less")
    return start, end


def _date_span(start: date, end: date) -> list[date]:
    days: list[date] = []
    cursor = start
    while cursor <= end:
        days.append(cursor)
        cursor += timedelta(days=1)
    return days


def _chunks(items: list[date], size: int = 7) -> list[list[date]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _day_header_label(day: date) -> str:
    return f"<b>{day.strftime('%a')}</b><br/>{day.day} {day.strftime('%b')}"


def _format_day_month(day: date, *, include_year: bool = False) -> str:
    label = f"{day.day} {day.strftime('%b')}"
    if include_year:
        return f"{label} {day.year}"
    return label


def _range_label(start: date, end: date) -> str:
    if start == end:
        return _format_day_month(start, include_year=True)
    same_year = start.year == end.year
    return f"{_format_day_month(start, include_year=not same_year)} – {_format_day_month(end, include_year=True)}"


def _week_section_label(days: list[date]) -> str:
    if not days:
        return ""
    return _range_label(days[0], days[-1])


def _load_print_staff(*, tenant_id: int, employee_ids: list[int], conn: Any) -> list[dict[str, Any]]:
    if not employee_ids:
        return []
    placeholders = ",".join(["%s"] * len(employee_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, first_name, last_name, job_title, department
            FROM employees
            WHERE tenant_id = %s AND id IN ({placeholders})
            ORDER BY last_name NULLS LAST, first_name NULLS LAST, id
            """,
            (tenant_id, *employee_ids),
        )
        rows = cur.fetchall()
    return [
        {
            "id": int(row[0]),
            "print_name": _employee_print_name(row[1], row[2]),
            "short_name": _employee_short_name(row[1], row[2]),
            "role_label": _employee_role_label(row[3], row[4]),
        }
        for row in rows
    ]


def _print_cell_tone(day_shifts: list[dict[str, Any]]) -> str:
    if not day_shifts:
        return "empty"
    if all(_is_day_off(shift) for shift in day_shifts):
        return "off"
    return "shift"


def _build_print_table(
    *,
    days: list[date],
    staff: list[dict[str, Any]],
    shifts_by_employee_day: dict[tuple[int, str], list[dict[str, Any]]],
    page_width: float,
    header_style: ParagraphStyle,
    staff_style: ParagraphStyle,
    cell_style: ParagraphStyle,
) -> Table:
    header_row = [
        Paragraph("<b>Staff</b>", header_style),
        *[Paragraph(_day_header_label(day), header_style) for day in days],
    ]
    table_data: list[list[Any]] = [header_row]
    cell_tone_map: dict[tuple[int, int], str] = {}
    for row_idx, employee in enumerate(staff, start=1):
        emp_id = int(employee["id"])
        display_name = employee.get("print_name") or employee.get("short_name") or "Staff"
        role_label = (employee.get("role_label") or "").strip()
        staff_html = f"<b>{display_name}</b>"
        if role_label:
            staff_html += f"<br/><font size='7' color='#667085'>{role_label}</font>"
        row_cells: list[Any] = [Paragraph(staff_html, staff_style)]
        for col_idx, day in enumerate(days):
            day_shifts = shifts_by_employee_day.get((emp_id, day.isoformat()), [])
            tone = _print_cell_tone(day_shifts)
            cell_tone_map[(row_idx, col_idx + 1)] = tone
            if not day_shifts:
                row_cells.append(Paragraph("", cell_style))
                continue
            lines: list[str] = []
            for shift in day_shifts:
                lines.extend(_shift_cell_lines(shift, fallback_role=role_label))
            row_cells.append(Paragraph("<br/>".join(lines), cell_style))
        table_data.append(row_cells)

    staff_col = 46 * mm
    day_col = (page_width - staff_col) / max(len(days), 1)
    table = Table(table_data, colWidths=[staff_col, *[day_col] * len(days)], repeatRows=1)
    table_style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), PRINT_HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (1, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.35, PRINT_GRID),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#F8FAFC")),
        ]
    )
    for (row, col), tone in cell_tone_map.items():
        if tone == "shift":
            bg = PRINT_SHIFT_BG
        elif tone == "off":
            bg = PRINT_OFF_BG
        else:
            bg = PRINT_EMPTY_BG
        table_style.add("BACKGROUND", (col, row), (col, row), bg)
    table.setStyle(table_style)
    return table


def build_rota_print_pdf(
    *,
    tenant_name: str,
    from_date: date,
    to_date: date,
    days: list[date],
    staff: list[dict[str, Any]],
    shifts: list[dict[str, Any]],
) -> bytes:
    buffer = io.BytesIO()
    page_size = landscape(A4)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=8 * mm,
        rightMargin=8 * mm,
        topMargin=8 * mm,
        bottomMargin=8 * mm,
        title=f"Rota — {tenant_name} — {from_date.isoformat()} to {to_date.isoformat()}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "RotaTitle",
        parent=styles["Heading1"],
        textColor=colors.HexColor("#0F6E56"),
        fontSize=16,
        leading=20,
        spaceAfter=2,
    )
    meta_style = ParagraphStyle(
        "RotaMeta",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#475467"),
    )
    caption_style = ParagraphStyle(
        "RotaWeekCaption",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#0F6E56"),
        spaceBefore=2,
        spaceAfter=4,
        fontName="Helvetica-Bold",
    )
    header_style = ParagraphStyle(
        "RotaHeader",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=1,
    )
    staff_style = ParagraphStyle(
        "RotaStaff",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        textColor=colors.HexColor("#0F172A"),
    )
    cell_style = ParagraphStyle(
        "RotaCell",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        alignment=1,
        textColor=colors.HexColor("#0F172A"),
    )
    generated = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    body: list[Any] = [
        Paragraph("Staff rota", title_style),
        Paragraph(
            f"<b>{tenant_name}</b> · {_range_label(from_date, to_date)}<br/>"
            f"Times only · 24-hour clock · Printed {generated}",
            meta_style,
        ),
        Spacer(1, 8),
    ]

    shifts_by_employee_day: dict[tuple[int, str], list[dict[str, Any]]] = {}
    scheduled_ids: set[int] = set()
    for shift in shifts:
        emp_id = int(shift["employee_id"])
        scheduled_ids.add(emp_id)
        key = (emp_id, str(shift["shift_date"])[:10])
        shifts_by_employee_day.setdefault(key, []).append(shift)

    print_staff = [employee for employee in staff if int(employee["id"]) in scheduled_ids]
    if not print_staff:
        body.append(Paragraph("No shifts in this date range.", styles["Italic"]))
        doc.build(body)
        return buffer.getvalue()

    page_width = page_size[0] - doc.leftMargin - doc.rightMargin
    chunks = _chunks(days, 7)
    for index, chunk in enumerate(chunks):
        if index:
            body.append(Spacer(1, 10))
        if len(chunks) > 1:
            body.append(Paragraph(_week_section_label(chunk), caption_style))
        body.append(
            _build_print_table(
                days=chunk,
                staff=print_staff,
                shifts_by_employee_day=shifts_by_employee_day,
                page_width=page_width,
                header_style=header_style,
                staff_style=staff_style,
                cell_style=cell_style,
            )
        )
    doc.build(body)
    return buffer.getvalue()


def build_rota_week_pdf(
    *,
    tenant_name: str,
    week_start: date,
    week_end: date,
    week_start_day_name: str,
    week_status: str | None,
    week_days: list[date],
    staff: list[dict[str, Any]],
    shifts: list[dict[str, Any]],
    attendance_by_shift_id: dict[int, dict[str, Any]] | None = None,
) -> bytes:
    del attendance_by_shift_id, week_status, week_start_day_name
    return build_rota_print_pdf(
        tenant_name=tenant_name,
        from_date=week_start,
        to_date=week_end,
        days=week_days,
        staff=staff,
        shifts=shifts,
    )


def _staff_for_print(*, tenant_id: int, shifts: list[dict[str, Any]], conn: Any) -> list[dict[str, Any]]:
    employee_ids = sorted({int(shift["employee_id"]) for shift in shifts})
    if not employee_ids:
        return []
    return _load_print_staff(tenant_id=tenant_id, employee_ids=employee_ids, conn=conn)


def rota_range_pdf_bytes(*, tenant_id: int, from_date: str, to_date: str, conn: Any) -> bytes:
    from admin_service import get_tenant_profile

    start, end = parse_print_range(from_date, to_date)
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    tenant_name = profile.get("name") or profile.get("business_name") or f"Tenant {tenant_id}"
    shifts = list_shifts_for_date_range(tenant_id=tenant_id, from_date=start, to_date=end, conn=conn)
    staff = _staff_for_print(tenant_id=tenant_id, shifts=shifts, conn=conn)
    return build_rota_print_pdf(
        tenant_name=str(tenant_name),
        from_date=start,
        to_date=end,
        days=_date_span(start, end),
        staff=staff,
        shifts=shifts,
    )


def rota_week_pdf_bytes(*, tenant_id: int, week_start: str, conn: Any) -> bytes:
    from admin_service import get_tenant_profile

    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    parsed = parse_week_start(week_start, week_start_day=week_start_day)
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    tenant_name = profile.get("name") or profile.get("business_name") or f"Tenant {tenant_id}"
    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=parsed, conn=conn)
    staff = _staff_for_print(tenant_id=tenant_id, shifts=shifts, conn=conn)
    return build_rota_print_pdf(
        tenant_name=str(tenant_name),
        from_date=parsed,
        to_date=week_end_date(parsed),
        days=week_dates(parsed),
        staff=staff,
        shifts=shifts,
    )


ROTA_CSV_HEADERS = [
    "Week start",
    "Week end",
    "Rota status",
    "Day",
    "Employee",
    "Start",
    "End",
    "Role",
    "Notes",
    "Attendance",
]


def build_rota_week_csv(
    *,
    week_start: date,
    week_end: date,
    week_status: str | None,
    shifts: list[dict[str, Any]],
    attendance_by_shift_id: dict[int, dict[str, Any]] | None = None,
) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(ROTA_CSV_HEADERS)
    week_start_iso = week_start.isoformat()
    week_end_iso = week_end.isoformat()
    status_label = (week_status or "draft").replace("_", " ").title()
    attendance_by_shift_id = attendance_by_shift_id or {}

    for shift in sorted(
        shifts,
        key=lambda row: (
            str(row.get("shift_date") or ""),
            str(row.get("start_time") or ""),
            str(row.get("employee_name") or "").lower(),
        ),
    ):
        day_label = date.fromisoformat(str(shift["shift_date"])[:10]).strftime("%a %d %b %Y")
        att = attendance_by_shift_id.get(int(shift["id"])) if shift.get("id") is not None else None
        attendance_label = ""
        if att:
            status = att.get("attendance_status") or ""
            attendance_label = status.replace("_", " ").title()
        writer.writerow(
            [
                week_start_iso,
                week_end_iso,
                status_label,
                day_label,
                str(shift.get("employee_name") or "").strip(),
                str(shift.get("start_time") or "")[:5],
                str(shift.get("end_time") or "")[:5],
                str(shift.get("role_label") or "").strip(),
                str(shift.get("notes") or "").strip(),
                attendance_label,
            ]
        )
    return buffer.getvalue()


def rota_week_csv_bytes(*, tenant_id: int, week_start: str, conn: Any) -> bytes:
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    parsed = parse_week_start(week_start, week_start_day=week_start_day)
    week, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=parsed, conn=conn)
    attendance_by_shift_id: dict[int, dict[str, Any]] = {}
    if week and week.get("status") == "published" and shifts:
        from modules.rota.attendance import build_week_attendance

        payload = build_week_attendance(
            tenant_id=tenant_id,
            week_start=parsed,
            shifts=shifts,
            conn=conn,
        )
        for item in payload.get("items") or []:
            shift_id = item.get("shift_id")
            if shift_id is not None:
                attendance_by_shift_id[int(shift_id)] = item

    csv_text = build_rota_week_csv(
        week_start=parsed,
        week_end=week_end_date(parsed),
        week_status=(week or {}).get("status"),
        shifts=shifts,
        attendance_by_shift_id=attendance_by_shift_id,
    )
    return csv_text.encode("utf-8-sig")
