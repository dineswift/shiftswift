"""Clock in / clock out PDF with daily, weekly, monthly, and date-range totals."""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from modules.payroll_export.service import build_hours_report, format_hours_hm

PINE = colors.HexColor("#0F6E56")
PINE_SOFT = colors.HexColor("#E7F4EF")
INK = colors.HexColor("#1C2B27")
MUTED = colors.HexColor("#5C6B66")
LINE = colors.HexColor("#D5DDD9")
WEEK = colors.HexColor("#F6F3EC")
CREAM = colors.HexColor("#FFFDF8")
WARN = colors.HexColor("#8A5A00")


def hours_report_pdf_bytes(
    *,
    tenant_id: int,
    conn: Any,
    from_date: Any = None,
    to_date: Any = None,
    employee_id: int | None = None,
    punch_site_id: int | None = None,
) -> bytes:
    report = build_hours_report(
        tenant_id=tenant_id,
        conn=conn,
        from_date=from_date,
        to_date=to_date,
        employee_id=employee_id,
        punch_site_id=punch_site_id,
    )
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Clock in and clock out — {report['tenant_name']}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ClockTitle",
        parent=styles["Heading1"],
        textColor=PINE,
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=19,
        spaceAfter=2,
    )
    meta_style = ParagraphStyle(
        "ClockMeta",
        parent=styles["Normal"],
        textColor=INK,
        fontSize=9,
        leading=12,
    )
    note_style = ParagraphStyle(
        "ClockNote",
        parent=styles["Normal"],
        textColor=MUTED,
        fontSize=8,
        leading=10,
    )
    section_style = ParagraphStyle(
        "ClockSection",
        parent=styles["Heading2"],
        textColor=PINE,
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        spaceBefore=8,
        spaceAfter=4,
    )
    cell_style = ParagraphStyle("ClockCell", parent=styles["Normal"], fontSize=8, leading=10, textColor=INK)
    cell_right = ParagraphStyle("ClockCellRight", parent=cell_style, alignment=2)
    head_style = ParagraphStyle(
        "ClockHead",
        parent=cell_style,
        fontName="Helvetica-Bold",
        textColor=PINE,
    )

    def hours_paragraph(hours: float | None, *, bold: bool = False) -> Paragraph:
        if hours is None:
            return Paragraph("—", cell_right)
        label = format_hours_hm(hours)
        weight = "Helvetica-Bold" if bold else "Helvetica"
        return Paragraph(
            f'<font name="{weight}">{label}</font><br/><font name="Helvetica" size="7" color="#5C6B66">{hours:.2f}</font>',
            cell_right,
        )

    body: list[Any] = [
        Paragraph("Clock in and clock out", title_style),
        Paragraph(
            f"<b>{report['tenant_name']}</b><br/>"
            f"Dates: {report['period_label']}<br/>"
            f"Basis: {report['basis']} · UK time · Generated {report['generated_at']}",
            meta_style,
        ),
        Spacer(1, 4),
        Paragraph(report["methodology"], note_style),
        Spacer(1, 8),
    ]

    if not report["employees"]:
        body.append(Paragraph("No clock-in or clock-out records between these dates.", styles["Italic"]))
        doc.build(body, onFirstPage=_footer(report), onLaterPages=_footer(report))
        return buffer.getvalue()

    summary = [[
        Paragraph("Employee", head_style),
        Paragraph("Days", head_style),
        Paragraph("Incomplete", head_style),
        Paragraph("Break", head_style),
        Paragraph("Hours", head_style),
    ]]
    for employee in report["employees"]:
        summary.append(
            [
                Paragraph(employee["name"], cell_style),
                Paragraph(str(employee["days_worked"]), cell_right),
                Paragraph(str(employee["incomplete_days"]), cell_right),
                hours_paragraph(employee["break_hours"] or None),
                hours_paragraph(employee["total_hours"], bold=True),
            ]
        )
    summary.append(
        [
            Paragraph("All employees", ParagraphStyle("ClockTotal", parent=cell_style, fontName="Helvetica-Bold")),
            Paragraph(str(report["grand_days"]), cell_right),
            "",
            hours_paragraph(report["grand_break_hours"] or None, bold=True),
            hours_paragraph(report["grand_total_hours"], bold=True),
        ]
    )
    summary_table = Table(summary, repeatRows=1, colWidths=[80 * mm, 28 * mm, 32 * mm, 36 * mm, 40 * mm])
    summary_table.setStyle(_grid_style(len(summary)))
    body.append(Paragraph("Hours for these dates", section_style))
    body.append(summary_table)

    for employee in report["employees"]:
        body.append(Paragraph(employee["name"], section_style))
        detail = [[
            Paragraph("Date", head_style),
            Paragraph("Clock in", head_style),
            Paragraph("Clock out", head_style),
            Paragraph("Break", head_style),
            Paragraph("Hours", head_style),
            Paragraph("Status", head_style),
        ]]
        for line in employee["lines"]:
            if line["kind"] == "day":
                status = "Complete" if line["status"] == "complete" else "Incomplete"
                detail.append(
                    [
                        Paragraph(line["date_label"], cell_style),
                        Paragraph(line["clock_in"] or "—", cell_style),
                        Paragraph(line["clock_out"] or "—", cell_style),
                        hours_paragraph(line["break_hours"] or None),
                        hours_paragraph(line["hours"], bold=True),
                        Paragraph(
                        status if status == "Complete" else f'<font color="#8A5A00">{status}</font>',
                        cell_style,
                    ),
                    ]
                )
            else:
                detail.append(
                    [
                        Paragraph(f"<b>{line['label']}</b>", cell_style),
                        "",
                        "",
                        hours_paragraph(line["break_hours"] or None, bold=True),
                        hours_paragraph(line["hours"], bold=True),
                        Paragraph(f"{line['days']} day{'s' if line['days'] != 1 else ''}", cell_style),
                    ]
                )
        detail_table = Table(
            detail,
            repeatRows=1,
            colWidths=[62 * mm, 28 * mm, 28 * mm, 32 * mm, 40 * mm, 36 * mm],
        )
        detail_table.setStyle(_detail_style(employee["lines"]))
        body.append(detail_table)

    doc.build(body, onFirstPage=_footer(report), onLaterPages=_footer(report))
    return buffer.getvalue()


def _footer(report: dict[str, Any]):
    def draw(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(12 * mm, 7 * mm, f"{report['tenant_name']} · {report['period_label']}")
        canvas.drawRightString(landscape(A4)[0] - 12 * mm, 7 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return draw


def _grid_style(row_count: int) -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), PINE_SOFT),
            ("BACKGROUND", (0, -1), (-1, -1), PINE_SOFT),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.3, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [CREAM, colors.white]),
        ]
    )


def _detail_style(lines: list[dict[str, Any]]) -> TableStyle:
    commands: list[tuple] = [
        ("BACKGROUND", (0, 0), (-1, 0), PINE_SOFT),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for index, line in enumerate(lines, start=1):
        kind = line["kind"]
        if kind == "week":
            commands.append(("BACKGROUND", (0, index), (-1, index), WEEK))
        elif kind == "month":
            commands.append(("BACKGROUND", (0, index), (-1, index), PINE_SOFT))
        elif kind == "period":
            commands.append(("BACKGROUND", (0, index), (-1, index), colors.HexColor("#D7EFE6")))
        elif line.get("status") == "incomplete":
            commands.append(("TEXTCOLOR", (5, index), (5, index), WARN))
    return TableStyle(commands)
