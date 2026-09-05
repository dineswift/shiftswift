from __future__ import annotations

from core.notifications import (
    format_reply_to_header,
    resolve_reply_to,
    resolve_tenant_company_email,
)


def test_resolve_reply_to_platform_uses_support(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    assert resolve_reply_to(audience="platform") == "support@shiftswifthr.co.uk"
    assert resolve_reply_to(purpose="welcome", audience="hr") == "support@shiftswifthr.co.uk"
    assert resolve_reply_to(purpose="password_reset", audience="hr") == "support@shiftswifthr.co.uk"
    assert resolve_reply_to(purpose="login_mfa", audience="employee") == "support@shiftswifthr.co.uk"


def test_resolve_reply_to_employee_uses_company_email(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    contacts = {
        "billing_email": "finance@acme.co.uk",
        "signatory_email": "ceo@acme.co.uk",
        "hr_email": "hr@acme.co.uk",
        "tenant_name": "Acme Ltd",
    }
    assert resolve_reply_to(audience="employee", contacts=contacts) == "finance@acme.co.uk"


def test_resolve_reply_to_employee_falls_back_to_support_without_company(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    assert resolve_reply_to(audience="employee", contacts={}) == "support@shiftswifthr.co.uk"


def test_resolve_reply_to_tenant_business_uses_company_email(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    contacts = {
        "billing_email": "finance@acme.co.uk",
        "signatory_email": "ceo@acme.co.uk",
        "hr_email": "hr@acme.co.uk",
        "tenant_name": "Acme Ltd",
    }
    assert resolve_tenant_company_email(contacts) == "finance@acme.co.uk"
    assert (
        resolve_reply_to(audience="hr", purpose="billing", contacts=contacts)
        == "finance@acme.co.uk"
    )
    assert (
        resolve_reply_to(audience="hr", purpose="compliance", contacts=contacts)
        == "finance@acme.co.uk"
    )


def test_resolve_reply_to_falls_back_to_support_without_tenant(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    assert resolve_reply_to(audience="hr", purpose="billing") == "support@shiftswifthr.co.uk"


def test_format_reply_to_header_support_display_name(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    header = format_reply_to_header("support@shiftswifthr.co.uk")
    assert header == "ShiftSwift HR Support <support@shiftswifthr.co.uk>"


def test_format_reply_to_header_tenant_display_name(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    contacts = {
        "billing_email": "finance@acme.co.uk",
        "tenant_name": "Acme Ltd",
    }
    header = format_reply_to_header("finance@acme.co.uk", contacts=contacts)
    assert header == "Acme Ltd <finance@acme.co.uk>"


def test_format_reply_to_header_employee_alias_display_name(monkeypatch) -> None:
    monkeypatch.setenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    contacts = {
        "billing_email": "finance@acme.co.uk",
        "tenant_name": "Acme Ltd",
    }
    header = format_reply_to_header(
        "finance@acme.co.uk",
        contacts=contacts,
        display_name="Restaurant HR",
    )
    assert header == "Restaurant HR <finance@acme.co.uk>"
