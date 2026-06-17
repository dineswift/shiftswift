"""Weekly shift list export with attendance — CSV and PDF."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from modules.rota.attendance import build_week_attendance
from modules.rota.service import (
    get_tenant_rota_week_start_day,
    get_week_rota,
    list_shifts_for_week,
    parse_week_start,
    week_end_date,
)

UK_TZ = ZoneInfo("Europe/London")

ATTENDANCE_LABELS = {
    "scheduled": "Scheduled",
    "awaiting": "Awaiting",
    "attended": "Attended",
    "late": "Late",
    "no_show": "No show",
    "missing_clock_out": "No clock-out",
}

CSV_HEADERS = [
    "Day",
    "Employee",
    "Start",
    "End",
    "Role",
    "Attendance",
    "Clock in",
    "Clock out",
    "Detail",
]


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _format_uk_day(value: str | date) -> str:
    if isinstance(value, date):
        day = value
    else:
        day = date.fromisoformat(str(value)[:10])
    return day.strftime("%a %d %b %Y")


def _format_uk_time(value: Any) -> str:
    ts = _parse_ts(value)
    if not ts:
        return ""
    return ts.astimezone(UK_TZ).strftime("%H:%M")


def _attendance_label(status: str | None) -> str:
    if not status:
        return ""
    return ATTENDANCE_LABELS.get(status, status.replace("_", " ").title())


def _sort_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(row.get("shift_date") or ""),
        str(row.get("start_time") or ""),
        str(row.get("employee_name") or "").lower(),
    )


def load_week_attendance_rows(*, tenant_id: int, week_start: str, conn: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    parsed = parse_week_start(week_start, week_start_day=week_start_day)
    week_payload = get_week_rota(
        tenant_id=tenant_id,
        week_start=parsed,
        conn=conn,
        week_start_day=week_start_day,
    )
    _, shifts = list_shifts_for_week(tenant_id=tenant_id, week_start=parsed, conn=conn)
    attendance = build_week_attendance(
        tenant_id=tenant_id,
        week_start=parsed,
        shifts=shifts,
        conn=conn,
    )
    meta = {
        "week_start": parsed,
        "week_end": week_end_date(parsed),
        "week_status": (week_payload.get("week") or {}).get("status"),
        "week_start_day_name": week_payload.get("week_start_day_name"),
    }
    items = sorted(attendance.get("items") or [], key=_sort_key)
    return meta, items


def _row_values(item: dict[str, Any]) -> list[str]:
    return [
        _format_uk_day(item.get("shift_date") or ""),
        str(item.get("employee_name") or ""),
        str(item.get("start_time") or "")[:5],
        str(item.get("end_time") or "")[:5],
        str(item.get("role_label") or ""),
        _attendance_label(item.get("attendance_status")),
        _format_uk_time(item.get("clock_in_at")),
        _format_uk_time(item.get("clock_out_at")),
        str(item.get("attendance_detail") or ""),
    ]


def build_week_attendance_csv(*, tenant_id: int, week_start: str, conn: Any) -> str:
    _meta, items = load_week_attendance_rows(tenant_id=tenant_id, week_start=week_start, conn=conn)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADERS)
    for item in items:
        writer.writerow(_row_values(item))
    return buffer.getvalue()


def build_week_attendance_pdf(
    *,
    tenant_name: str,
    week_start: date,
    week_end: date,
    week_start_day_name: str | None,
    week_status: str | None,
    items: list[dict[str, Any]],
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=f"Shift attendance — {tenant_name} — {week_start.isoformat()}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "AttendanceTitle",
        parent=styles["Heading1"],
        textColor=colors.HexColor("#0F6E56"),
        fontSize=14,
        spaceAfter=4,
    )
    meta_style = ParagraphStyle("AttendanceMeta", parent=styles["Normal"], fontSize=9, leading=11)
    cell_style = ParagraphStyle("AttendanceCell", parent=styles["Normal"], fontSize=8, leading=10)

    status_label = (week_status or "draft").replace("_", " ").title()
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    body: list[Any] = [
        Paragraph("ShiftSwift HR — Shifts &amp; attendance", title_style),
        Paragraph(
            f"<b>{tenant_name}</b><br/>"
            f"Week: {week_start.strftime('%d %b %Y')} – {week_end.strftime('%d %b %Y')} "
            f"({week_start_day_name or 'Week'} start) · Status: {status_label}<br/>"
            f"Generated: {generated}",
            meta_style,
        ),
        Spacer(1, 8),
    ]

    if not items:
        body.append(Paragraph("No shifts scheduled for this week.", styles["Italic"]))
        doc.build(body)
        return buffer.getvalue()

    table_data: list[list[Any]] = [
        [Paragraph(f"<b>{escape_html(header)}</b>", cell_style) for header in CSV_HEADERS]
    ]
    for item in items:
        table_data.append([Paragraph(escape_html(value) or "—", cell_style) for value in _row_values(item)])

    col_widths = [22 * mm, 28 * mm, 12 * mm, 12 * mm, 22 * mm, 18 * mm, 12 * mm, 12 * mm, 38 * mm]
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#334155")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    body.append(table)
    doc.build(body)
    return buffer.getvalue()


def escape_html(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def rota_week_attendance_pdf_bytes(*, tenant_id: int, week_start: str, conn: Any) -> bytes:
    from admin_service import get_tenant_profile

    meta, items = load_week_attendance_rows(tenant_id=tenant_id, week_start=week_start, conn=conn)
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    tenant_name = profile.get("name") or profile.get("business_name") or f"Tenant {tenant_id}"
    return build_week_attendance_pdf(
        tenant_name=str(tenant_name),
        week_start=meta["week_start"],
        week_end=meta["week_end"],
        week_start_day_name=meta.get("week_start_day_name"),
        week_status=meta.get("week_status"),
        items=items,
    )
