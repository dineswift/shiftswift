"""Unit tests for BrightPay / Xero CSV payroll export."""

from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.payroll_export.service import (
    EMPLOYEE_CSV_COLUMNS,
    HOURS_CSV_COLUMNS,
    _pair_punch_hours,
    build_employees_csv,
    build_hours_csv,
    build_hours_report,
    payroll_export_info,
)


def test_payroll_export_info_lists_partners() -> None:
    info = payroll_export_info()
    assert "BrightPay" in {p["name"] for p in info["partners"]}
    assert info["exports"]["employees_csv"].endswith("employees.csv")
    assert info["exports"]["hours_pdf"].endswith("hours.pdf")


@patch("modules.payroll_export.service.list_employees")
def test_build_employees_csv_includes_active_staff(mock_list: MagicMock) -> None:
    mock_list.return_value = [
        {
            "id": 1,
            "first_name": "Alex",
            "last_name": "Smith",
            "email": "alex@example.com",
            "phone": "",
            "ni_number": "AB123456C",
            "date_of_birth": "1990-01-01",
            "start_date": "2024-06-01",
            "job_title": "Chef",
            "department": "Kitchen",
            "employment_type": "full_time",
            "salary": 28000,
            "status": "active",
            "home_address": "1 High Street",
            "work_location": "Main site",
        },
        {"id": 2, "first_name": "Left", "last_name": "Staff", "status": "terminated"},
    ]
    conn = MagicMock()
    csv_body = build_employees_csv(tenant_id=1, conn=conn)
    lines = csv_body.strip().splitlines()
    assert lines[0] == ",".join(EMPLOYEE_CSV_COLUMNS)
    assert "Alex,Smith" in lines[1]
    assert all("Left" not in line for line in lines[1:])


def test_pair_punch_hours_computes_duration() -> None:
    punched_at_in = datetime(2026, 6, 10, 9, 0, tzinfo=timezone.utc)
    punched_at_out = datetime(2026, 6, 10, 17, 30, tzinfo=timezone.utc)
    punches = [
        (1, "Alex", "Smith", "in", punched_at_in),
        (1, "Alex", "Smith", "out", punched_at_out),
    ]
    rows = _pair_punch_hours(punches)
    assert len(rows) == 1
    emp_id, first, last, day, clock_in, clock_out, hours = rows[0]
    assert emp_id == 1
    assert first == "Alex"
    assert last == "Smith"
    assert day == date(2026, 6, 10)
    assert hours == 8.5


def test_pair_punch_hours_excludes_lunch_break_gaps() -> None:
    punches = [
        (1, "Alex", "Smith", "in", datetime(2026, 6, 10, 7, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 10, 10, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "in", datetime(2026, 6, 10, 11, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 10, 15, 0, tzinfo=timezone.utc)),
    ]
    rows = _pair_punch_hours(punches)
    assert len(rows) == 1
    assert rows[0][6] == 7.0


def test_pair_punch_segments_emits_one_row_per_shift() -> None:
    from modules.payroll_export.service import _pair_punch_segments

    punches = [
        (1, "Alex", "Smith", "in", datetime(2026, 6, 10, 7, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 10, 10, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "in", datetime(2026, 6, 10, 11, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 10, 15, 0, tzinfo=timezone.utc)),
    ]
    rows = _pair_punch_segments(punches)
    assert len(rows) == 2
    assert rows[0][6] == 3.0
    assert rows[1][6] == 4.0


def test_build_hours_report_totals_employee_hours() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    punched_at_in = datetime(2026, 6, 10, 8, 0, tzinfo=timezone.utc)
    punched_at_out = datetime(2026, 6, 10, 16, 0, tzinfo=timezone.utc)
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "in", punched_at_in),
        (1, "Alex", "Smith", "out", punched_at_out),
    ]

    with patch("admin_service.get_tenant_profile") as mock_profile:
        mock_profile.return_value = {"name": "Acme Ltd", "trading_name": "Acme Trading"}
        report = build_hours_report(
            tenant_id=1,
            conn=conn,
            from_date=date(2026, 6, 1),
            to_date=date(2026, 6, 30),
        )

    assert report["tenant_name"] == "Acme Trading"
    assert report["employee_count"] == 1
    assert report["grand_total_hours"] == 8.0
    assert report["employees"][0]["total_hours"] == 8.0
    assert report["employees"][0]["rows"][0]["status"] == "complete"


def test_build_hours_csv_writes_header_and_row() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    punched_at_in = datetime(2026, 6, 10, 9, 0, tzinfo=timezone.utc)
    punched_at_out = datetime(2026, 6, 10, 17, 0, tzinfo=timezone.utc)
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "in", punched_at_in),
        (1, "Alex", "Smith", "out", punched_at_out),
    ]
    with patch("admin_service.get_tenant_profile") as mock_profile:
        mock_profile.return_value = {"name": "Acme Ltd", "trading_name": "Acme Trading", "rota_week_start_day": 0}
        csv_body = build_hours_csv(
            tenant_id=1,
            conn=conn,
            from_date=date(2026, 6, 1),
            to_date=date(2026, 6, 30),
        )
    lines = [line for line in csv_body.strip().splitlines() if line]
    assert "Dates,1 Jun 2026 to 30 Jun 2026" in lines
    assert ",".join(HOURS_CSV_COLUMNS) in lines
    assert any(line.startswith("Day,Alex Smith,2026-06-10,2026-06-10") and ",8.00,1,Complete" in line for line in lines)
    assert any(line.startswith("Week total,Alex Smith,") and ",8.00,1," in line for line in lines)
    assert any(line.startswith("Month total,Alex Smith,2026-06-01,2026-06-30") for line in lines)
    assert any(line.startswith("Period total,Alex Smith,2026-06-01,2026-06-30") for line in lines)
    assert any(line.startswith("All employees,Acme Trading,2026-06-01,2026-06-30") for line in lines)


def test_build_hours_report_week_month_and_break() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "in", datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "in", datetime(2026, 6, 1, 13, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 1, 17, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "in", datetime(2026, 6, 8, 8, 0, tzinfo=timezone.utc)),
        (1, "Alex", "Smith", "out", datetime(2026, 6, 8, 16, 0, tzinfo=timezone.utc)),
    ]
    with patch("admin_service.get_tenant_profile") as mock_profile:
        mock_profile.return_value = {"name": "Acme Ltd", "rota_week_start_day": 0}
        report = build_hours_report(
            tenant_id=1,
            conn=conn,
            from_date=date(2026, 6, 1),
            to_date=date(2026, 6, 30),
        )
    employee = report["employees"][0]
    kinds = [line["kind"] for line in employee["lines"]]
    assert kinds == ["day", "week", "day", "week", "month", "period"]
    assert employee["rows"][0]["break_hours"] == 1.0
    assert employee["rows"][0]["hours"] == 8.0
    assert employee["total_hours"] == 16.0
    week_totals = [line for line in employee["lines"] if line["kind"] == "week"]
    assert week_totals[0]["hours"] == 8.0
    assert week_totals[1]["hours"] == 8.0
    month = next(line for line in employee["lines"] if line["kind"] == "month")
    assert month["label"] == "June 2026"
    assert month["hours"] == 16.0
    assert report["basis"] == "Monthly"


def test_previous_calendar_month() -> None:
    from modules.payroll_export.monthly_report import _previous_calendar_month

    start, end = _previous_calendar_month(date(2026, 3, 1))
    assert start == date(2026, 2, 1)
    assert end == date(2026, 2, 28)

    start, end = _previous_calendar_month(date(2026, 1, 15))
    assert start == date(2025, 12, 1)
    assert end == date(2025, 12, 31)


def test_process_monthly_reports_skips_when_not_first_of_month() -> None:
    from modules.payroll_export.monthly_report import process_monthly_payroll_hours_reports

    conn = MagicMock()
    summary = process_monthly_payroll_hours_reports(settings=MagicMock(), conn=conn, as_of=date(2026, 6, 10))
    assert summary == {"tenants_checked": 0, "reports_sent": 0, "skipped": 0}
    conn.cursor.assert_not_called()


@patch("modules.payroll_export.monthly_report.send_payroll_hours_report")
def test_process_monthly_reports_sends_on_first(mock_send: MagicMock) -> None:
    from modules.payroll_export.monthly_report import process_monthly_payroll_hours_reports

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.side_effect = [
        [(1, "payroll@example.com", "hr@example.com")],
    ]
    cursor.fetchone.return_value = None

    summary = process_monthly_payroll_hours_reports(settings=MagicMock(), conn=conn, as_of=date(2026, 6, 1))

    assert summary["tenants_checked"] == 1
    assert summary["reports_sent"] == 1
    mock_send.assert_called_once()


def test_send_payroll_hours_report_rejects_invalid_email() -> None:
    from modules.payroll_export.monthly_report import send_payroll_hours_report

    conn = MagicMock()
    try:
        send_payroll_hours_report(
            settings=MagicMock(),
            tenant_id=1,
            recipient_email="not-an-email",
            period_start=date(2026, 5, 1),
            period_end=date(2026, 5, 31),
            conn=conn,
        )
    except ValueError as exc:
        assert "valid accountant" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


@patch("modules.payroll_export.monthly_report.send_email_content")
@patch("modules.payroll_export.monthly_report.hours_report_pdf_bytes", return_value=b"%PDF-test")
@patch("modules.payroll_export.monthly_report.build_hours_report")
@patch("admin_service.get_tenant_profile")
def test_send_payroll_hours_report_emails_pdf(
    mock_profile: MagicMock,
    mock_report: MagicMock,
    mock_pdf: MagicMock,
    mock_send: MagicMock,
) -> None:
    from modules.payroll_export.monthly_report import send_payroll_hours_report

    mock_profile.return_value = {"trading_name": "Acme Ltd", "name": "Acme"}
    mock_report.return_value = {
        "employee_count": 2,
        "grand_total_hours": 120.5,
        "methodology": "First clock-in and last clock-out per day.",
    }
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = None

    result = send_payroll_hours_report(
        settings=MagicMock(),
        tenant_id=1,
        recipient_email="payroll@example.com",
        period_start=date(2026, 5, 1),
        period_end=date(2026, 5, 31),
        conn=conn,
        cc_hr_email="hr@example.com",
    )

    assert result["recipient_email"] == "payroll@example.com"
    mock_send.assert_called_once()
    payload = mock_send.call_args.kwargs["payload"]
    assert payload["cc"] == "hr@example.com"
    assert payload["attachments"][0]["filename"].endswith(".pdf")
    conn.commit.assert_called_once()


def test_payroll_hours_report_email_template() -> None:
    from core.email_templates import payroll_hours_report_email

    content = payroll_hours_report_email(
        tenant_name="Acme Ltd",
        period_start="2026-05-01",
        period_end="2026-05-31",
        employee_count=3,
        total_hours=240.0,
        methodology="First clock-in and last clock-out per day.",
    )
    assert "Acme Ltd" in content.subject
    assert "2026-05-01" in content.text
    assert "does not run payroll" in content.text.lower()


def test_hours_report_pdf_bytes_starts_with_pdf_header() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = []
    with patch("admin_service.get_tenant_profile") as mock_profile:
        mock_profile.return_value = {"name": "Acme Ltd"}
        from modules.payroll_export.hours_pdf import hours_report_pdf_bytes

        pdf = hours_report_pdf_bytes(tenant_id=1, conn=conn, from_date=date(2026, 6, 1), to_date=date(2026, 6, 30))
    assert pdf.startswith(b"%PDF")
