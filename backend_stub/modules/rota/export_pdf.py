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
    BILLABLE_EMPLOYEE_STATUSES,
    WEEKDAY_NAMES,
    get_tenant_rota_week_start_day,
    get_week_rota,
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


def _employee_initials(first_name: str | None, last_name: str | None) -> str:
    first = (first_name or "").strip()[:1]
    last = (last_name or "").strip()[:1]
    return (first + last).upper() or "?"


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


def _shift_cell_lines(shift: dict[str, Any], *, fallback_role: str) -> list[str]:
    if _is_day_off(shift):
        return ["Day off"]
    start = str(shift.get("start_time") or "")[:5]
    end = str(shift.get("end_time") or "")[:5]
    role = (shift.get("role_label") or "").strip() or fallback_role
    return [f"{start}–{end}", role]


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


def _load_rota_staff(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    statuses = tuple(BILLABLE_EMPLOYEE_STATUSES)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, first_name, last_name, job_title, department
            FROM employees
            WHERE tenant_id = %s AND status IN ({",".join(["%s"] * len(statuses))})
            ORDER BY last_name NULLS LAST, first_name NULLS LAST, id
            """,
            (tenant_id, *statuses),
        )
        rows = cur.fetchall()
    staff: list[dict[str, Any]] = []
    for row in rows:
        staff.append(
            {
                "id": int(row[0]),
                "initials": _employee_initials(row[1], row[2]),
                "short_name": _employee_short_name(row[1], row[2]),
                "role_label": _employee_role_label(row[3], row[4]),
            }
        )
    return staff


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
    buffer = io.BytesIO()
    page_size = landscape(A4)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"Rota — {tenant_name} — {week_start.isoformat()}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "RotaTitle",
        parent=styles["Heading1"],
        textColor=colors.HexColor("#0F6E56"),
        fontSize=15,
        spaceAfter=4,
    )
    meta_style = ParagraphStyle("RotaMeta", parent=styles["Normal"], fontSize=9, leading=11)
    header_style = ParagraphStyle(
        "RotaHeader",
        parent=styles["Normal"],
        fontSize=8,
        leading=9,
        textColor=colors.HexColor("#334155"),
        alignment=1,
    )
    staff_style = ParagraphStyle(
        "RotaStaff",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#0F172A"),
    )
    staff_role_style = ParagraphStyle(
        "RotaStaffRole",
        parent=styles["Normal"],
        fontSize=7,
        leading=8,
        textColor=colors.HexColor("#64748B"),
    )
    cell_style = ParagraphStyle(
        "RotaCell",
        parent=styles["Normal"],
        fontSize=7,
        leading=8,
        alignment=1,
    )

    status_label = (week_status or "draft").replace("_", " ").title()
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    body: list[Any] = [
        Paragraph("ShiftSwift HR — Weekly Rota", title_style),
        Paragraph(
            f"<b>{tenant_name}</b><br/>"
            f"Week: {week_start.strftime('%d %b %Y')} – {week_end.strftime('%d %b %Y')} "
            f"({week_start_day_name} start) · Status: {status_label}<br/>"
            f"Generated: {generated}",
            meta_style,
        ),
        Spacer(1, 6),
    ]

    if not staff:
        body.append(Paragraph("No active employees on this account — add staff before exporting a rota.", styles["Italic"]))
        doc.build(body)
        return buffer.getvalue()

    attendance_by_shift_id = attendance_by_shift_id or {}
    show_attendance_legend = (week_status or "") == "published" and bool(attendance_by_shift_id)

    shifts_by_employee_day: dict[tuple[int, str], list[dict[str, Any]]] = {}
    for shift in shifts:
        key = (int(shift["employee_id"]), str(shift["shift_date"])[:10])
        shifts_by_employee_day.setdefault(key, []).append(shift)

    shifts_per_day: dict[str, int] = {day.isoformat(): 0 for day in week_days}
    for shift in shifts:
        day_iso = str(shift.get("shift_date") or "")[:10]
        if day_iso in shifts_per_day:
            shifts_per_day[day_iso] += 1

    header_cells: list[Any] = [Paragraph("<b>Staff</b>", header_style)]
    for day in week_days:
        count = shifts_per_day.get(day.isoformat(), 0)
        count_label = f"{count} shift{'s' if count != 1 else ''}"
        header_cells.append(
            Paragraph(
                f"<b>{day.strftime('%a %d')}</b><br/><font size='6' color='#64748B'>{count_label}</font>",
                header_style,
            )
        )
    table_data: list[list[Any]] = [header_cells]

    cell_tone_map: dict[tuple[int, int], str] = {}
    for row_idx, employee in enumerate(staff, start=1):
        emp_id = int(employee["id"])
        role_label = employee["role_label"]
        staff_cell = Paragraph(
            f"<b>{employee['initials']}</b> {employee['short_name']}<br/>"
            f"<font size='6' color='#64748B'>{role_label}</font>",
            staff_style,
        )
        row_cells: list[Any] = [staff_cell]
        for col_idx, day in enumerate(week_days):
            day_iso = day.isoformat()
            day_shifts = sorted(
                shifts_by_employee_day.get((emp_id, day_iso), []),
                key=lambda row: str(row.get("start_time") or ""),
            )
            if not day_shifts:
                row_cells.append(Paragraph("—", cell_style))
                cell_tone_map[(row_idx, col_idx + 1)] = "empty"
                continue
            lines: list[str] = []
            for index, shift in enumerate(day_shifts):
                if index:
                    lines.append("")
                cell_lines = _shift_cell_lines(shift, fallback_role=role_label)
                if _is_day_off(shift):
                    lines.append(f"<b>{cell_lines[0]}</b>")
                else:
                    lines.append(f"<b>{cell_lines[0]}</b>")
                    if len(cell_lines) > 1:
                        lines.append(f"<font size='6' color='#475467'>{cell_lines[1]}</font>")
            tone = _resolve_cell_tone(
                day_shifts,
                fallback_role=role_label,
                attendance_by_shift_id=attendance_by_shift_id,
            )
            row_cells.append(Paragraph("<br/>".join(lines), cell_style))
            cell_tone_map[(row_idx, col_idx + 1)] = tone
        table_data.append(row_cells)

    page_width = page_size[0] - doc.leftMargin - doc.rightMargin
    staff_col = 34 * mm
    day_col = (page_width - staff_col) / 7
    col_widths = [staff_col, *[day_col] * 7]

    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table_style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#334155")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 1), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ]
    )
    for (row, col), tone in cell_tone_map.items():
        bg, accent = TONE_COLORS.get(tone, TONE_COLORS["default"])
        table_style.add("BACKGROUND", (col, row), (col, row), bg)
        if tone != "empty":
            table_style.add("LINEBEFORE", (col, row), (col, row), 2.5, accent)
    table.setStyle(table_style)
    body.append(table)
    if show_attendance_legend:
        legend_style = ParagraphStyle(
            "RotaLegend",
            parent=meta_style,
            fontSize=8,
            leading=10,
            spaceBefore=6,
            textColor=colors.HexColor("#64748B"),
        )
        body.append(
            Paragraph(
                "<b>Attendance colours</b> (published week): "
                "light green = scheduled · dark green = attended · amber = late · red = no show",
                legend_style,
            )
        )
    doc.build(body)
    return buffer.getvalue()


def rota_week_pdf_bytes(*, tenant_id: int, week_start: str, conn: Any) -> bytes:
    from admin_service import get_tenant_profile

    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    parsed = parse_week_start(week_start, week_start_day=week_start_day)
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    tenant_name = profile.get("name") or profile.get("business_name") or f"Tenant {tenant_id}"

    week_payload = get_week_rota(
        tenant_id=tenant_id,
        week_start=parsed,
        conn=conn,
        week_start_day=week_start_day,
    )
    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=parsed, conn=conn)
    staff = _load_rota_staff(tenant_id=tenant_id, conn=conn)
    days = week_dates(parsed)
    week = week_payload.get("week") or {}
    attendance_by_shift_id: dict[int, dict[str, Any]] = {}
    if week.get("status") == "published" and shifts:
        from modules.rota.attendance import build_week_attendance

        attendance_payload = build_week_attendance(
            tenant_id=tenant_id,
            week_start=parsed,
            shifts=shifts,
            conn=conn,
        )
        for item in attendance_payload.get("items") or []:
            shift_id = item.get("shift_id")
            if shift_id is not None:
                attendance_by_shift_id[int(shift_id)] = item

    return build_rota_week_pdf(
        tenant_name=str(tenant_name),
        week_start=parsed,
        week_end=week_end_date(parsed),
        week_start_day_name=str(week_payload.get("week_start_day_name") or WEEKDAY_NAMES[week_start_day]),
        week_status=week.get("status"),
        week_days=days,
        staff=staff,
        shifts=shifts,
        attendance_by_shift_id=attendance_by_shift_id,
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
