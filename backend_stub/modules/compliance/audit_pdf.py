"""Generate Home Office audit pack as PDF."""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from modules.compliance.audit_export import build_audit_export


def _row_values(row: dict[str, Any], keys: list[str]) -> list[str]:
    return [str(row.get(key) or "—")[:48] for key in keys]


def audit_export_pdf_bytes(
    *,
    tenant_id: int,
    employee_id: int | None,
    conn: Any,
    pack: dict[str, Any] | None = None,
) -> bytes:
    pack = pack or build_audit_export(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"ShiftSwift HR Audit Pack — Tenant {tenant_id}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "AuditTitle",
        parent=styles["Heading1"],
        textColor=colors.HexColor("#0F6E56"),
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "AuditSection",
        parent=styles["Heading2"],
        textColor=colors.HexColor("#0F6E56"),
        spaceBefore=14,
        spaceAfter=8,
    )
    summary = pack.get("summary") or {}
    body = [
        Paragraph("ShiftSwift HR — Sponsor Licence Audit Pack", title_style),
        Paragraph(
            f"Tenant {pack['tenant_id']} · Generated {pack['generated_on']}"
            + (f" · Employee #{pack['employee_id']}" if pack.get("employee_id") else " · All employees"),
            styles["Normal"],
        ),
        Spacer(1, 8),
        Paragraph(
            f"Summary: {summary.get('sponsored_workers', 0)} sponsored workers, "
            f"{summary.get('rtw_checks', 0)} RTW checks, "
            f"{summary.get('identity_documents', 0)} ID/visa/RTW documents, "
            f"{summary.get('sms_changes', 0)} SMS changes, "
            f"{summary.get('absence_alerts', 0)} absence alerts, "
            f"{summary.get('reporting_triggers', 0)} reporting triggers.",
            styles["Normal"],
        ),
    ]

    sections = [
        (
            "Sponsored workers",
            pack["sections"].get("sponsored_workers", []),
            ["employee_name", "visa_type", "visa_expiry_date", "rtw_check_expiry_date", "rtw_status"],
        ),
        (
            "Right to Work checks",
            pack["sections"].get("right_to_work_checks", []),
            ["employee_name", "check_date", "outcome", "expiry_date", "check_method"],
        ),
        (
            "ID, visa and right to work documents",
            pack["sections"].get("identity_documents", []),
            ["employee_name", "title", "category", "expires_at", "has_file"],
        ),
        (
            "SMS change log",
            pack["sections"].get("sms_change_log", []),
            ["employee_name", "field_name", "changed_at", "sms_reporting_deadline", "alert_status"],
        ),
        (
            "Absence alerts",
            pack["sections"].get("absence_alerts", []),
            ["employee_name", "consecutive_working_days", "alert_status", "home_office_report_required_by"],
        ),
        (
            "Recruitment adverts",
            pack["sections"].get("advertisement_records", []),
            ["job_title", "platform", "posted_date", "job_reference"],
        ),
        (
            "Reporting triggers",
            pack["sections"].get("reporting_triggers", []),
            ["employee_name", "trigger_type", "deadline_date", "status"],
        ),
    ]

    for title, rows, keys in sections:
        body.append(Paragraph(title, section_style))
        if not rows:
            body.append(Paragraph("No records.", styles["Italic"]))
            continue
        table_data = [keys] + [_row_values(row, keys) for row in rows[:40]]
        table = Table(table_data, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8F5F0")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F6E56")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        body.append(table)
        if len(rows) > 40:
            body.append(Paragraph(f"… and {len(rows) - 40} more rows (see JSON or ZIP export).", styles["Italic"]))

    doc.build(body)
    return buffer.getvalue()
