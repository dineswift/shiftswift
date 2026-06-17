"""Weekly rota grid PDF export — matches the admin rota builder layout."""

from __future__ import annotations

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
}


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

    shifts_by_employee_day: dict[tuple[int, str], list[dict[str, Any]]] = {}
    for shift in shifts:
        key = (int(shift["employee_id"]), str(shift["shift_date"])[:10])
        shifts_by_employee_day.setdefault(key, []).append(shift)

    day_labels = []
    for day in week_days:
        day_labels.append(day.strftime("%a %d"))

    table_data: list[list[Any]] = [[Paragraph("<b>Staff</b>", header_style), *[Paragraph(f"<b>{label}</b>", header_style) for label in day_labels]]]

    cell_tone_map: dict[tuple[int, int], str] = {}
    for row_idx, employee in enumerate(staff, start=1):
        emp_id = int(employee["id"])
        role_label = employee["role_label"]
        staff_cell = Paragraph(
            f"<b>{employee['short_name']}</b><br/><font size='6' color='#64748B'>{role_label}</font>",
            staff_style,
        )
        row_cells: list[Any] = [staff_cell]
        for col_idx, day in enumerate(week_days):
            day_iso = day.isoformat()
            day_shifts = shifts_by_employee_day.get((emp_id, day_iso), [])
            if not day_shifts:
                row_cells.append(Paragraph("—", cell_style))
                cell_tone_map[(row_idx, col_idx + 1)] = "empty"
                continue
            lines: list[str] = []
            tone = "default"
            for index, shift in enumerate(day_shifts):
                if index:
                    lines.append("")
                shift_lines = _shift_cell_lines(shift, fallback_role=role_label)
                lines.extend(shift_lines)
                tone = _shift_tone(shift, fallback_role=role_label)
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
        bg, _ = TONE_COLORS.get(tone, TONE_COLORS["default"])
        table_style.add("BACKGROUND", (col, row), (col, row), bg)
    table.setStyle(table_style)
    body.append(table)
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

    return build_rota_week_pdf(
        tenant_name=str(tenant_name),
        week_start=parsed,
        week_end=week_end_date(parsed),
        week_start_day_name=str(week_payload.get("week_start_day_name") or WEEKDAY_NAMES[week_start_day]),
        week_status=(week_payload.get("week") or {}).get("status"),
        week_days=days,
        staff=staff,
        shifts=shifts,
    )
