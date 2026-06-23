from __future__ import annotations

from unittest.mock import MagicMock

from core.notifications import format_from_header, resolve_from_display_name


def test_format_from_header_uses_platform_name_for_billing(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    header = format_from_header(audience="hr", purpose="billing")
    assert header == "ShiftSwift HR <noreply@shiftswifthr.co.uk>"


def test_format_from_header_uses_platform_name_without_tenant(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    header = format_from_header(audience="employee", purpose="employee")
    assert header == "ShiftSwift HR <noreply@shiftswifthr.co.uk>"


def test_resolve_from_display_name_uses_employee_alias(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = ({"employee_display_name": "Restaurant HR"}, "Acme Ltd")

    display = resolve_from_display_name(
        audience="employee",
        purpose="employee",
        tenant_id=7,
        conn=conn,
    )
    assert display == "Restaurant HR"


def test_format_from_header_masks_employee_mail_with_business_name(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = ({"employee_display_name": "Restaurant HR"}, "Acme Ltd")

    header = format_from_header(
        audience="employee",
        purpose="employee",
        tenant_id=7,
        conn=conn,
    )
    assert header == "Restaurant HR <noreply@shiftswifthr.co.uk>"
    assert "ShiftSwift HR" not in header


def test_format_from_header_hr_tenant_alert_uses_business_name(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        ("billing@acme.test", None, "Acme Hospitality"),
        ("hr@acme.test",),
    ]

    header = format_from_header(
        audience="hr",
        purpose="general",
        tenant_id=3,
        conn=conn,
    )
    assert header == "Acme Hospitality <noreply@shiftswifthr.co.uk>"


def test_format_from_header_hr_password_reset_stays_platform(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        ("billing@acme.test", None, "Acme Hospitality"),
        ("hr@acme.test",),
    ]

    header = format_from_header(
        audience="hr",
        purpose="password_reset",
        tenant_id=3,
        conn=conn,
    )
    assert header == "ShiftSwift HR <noreply@shiftswifthr.co.uk>"
