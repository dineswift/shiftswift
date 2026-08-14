from __future__ import annotations

from core.email_templates import employee_portal_invite_email


from employee_portal_consent import validate_employee_gdpr_acceptance


def test_validate_employee_gdpr_acceptance_requires_checkbox() -> None:
    try:
        validate_employee_gdpr_acceptance(accept_employee_gdpr=False)
    except ValueError as exc:
        assert "employer manages your personal data" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_employee_portal_invite_email_mentions_employer_gdpr() -> None:
    content = employee_portal_invite_email(
        employee_name="Alex",
        notification_from_name="HR Team",
        employer_legal_name="Himalayan Inn Ltd",
        setup_url="https://app.shiftswifthr.co.uk/reset-password.html?token=abc",
        login_url="https://app.shiftswifthr.co.uk/business-login.html",
        reset_hours=24,
    )
    assert "Himalayan Inn Ltd" in content.text
    assert "HR Team has invited you" in content.text
    assert "responsible for managing your personal data" in content.text
    assert "privacy notice" in content.text.lower()
    assert "privacy-policy.html" in content.text
    assert "responsible for managing your personal data" in content.html
    assert "install-employee.html" in content.text
    assert "Add to Home Screen" in content.text
    assert "privacy-policy.html" in content.html
    assert '<a href="https://app.shiftswifthr.co.uk/privacy-policy.html"' in content.html
    assert "&lt;a href" not in content.html
