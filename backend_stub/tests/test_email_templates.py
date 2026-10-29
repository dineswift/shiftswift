from __future__ import annotations

from core.email_templates import (
    EmailContent,
    login_email_mfa_code,
    password_reset_email,
    render_email,
    signup_platform_guide_email,
    welcome_trial_email,
)


def test_welcome_trial_email_has_html_and_text() -> None:
    content = welcome_trial_email(
        business_name="Acme Ltd",
        billing_email="hr@acme.co.uk",
        plan_name="Starter",
        trial_days=14,
    )
    assert isinstance(content, EmailContent)
    assert "14-day trial" in content.subject
    assert "hr@acme.co.uk" in content.text
    assert "Open HR dashboard" in content.html
    assert "Acme Ltd" in content.html
    assert "<html" in content.html


def test_signup_platform_guide_email_covers_disclaimer_and_support() -> None:
    content = signup_platform_guide_email(
        business_name="Acme Ltd",
        billing_email="hr@acme.co.uk",
    )
    assert "not an outsourced HR" in content.text
    assert "hr@acme.co.uk" in content.text
    assert "punch.html" in content.text
    assert "support@" in content.text
    assert "Getting started" in content.html


def test_password_reset_escapes_html_in_url() -> None:
    content = password_reset_email(
        role_label='HR admin"><script>',
        reset_url="https://app.example.com/reset?token=abc",
        reset_hours=2,
    )
    assert "<script>" not in content.html
    assert "Choose a new password" in content.html


def test_login_email_mfa_code_renders_digits_not_escaped_tags() -> None:
    content = login_email_mfa_code(code="729325", minutes=10)
    assert "729325" in content.text
    assert "729325" in content.html
    assert "&lt;strong" not in content.html
    assert 'font-size:28px' in content.html
    assert "expires in 10 minutes" in content.html


def test_render_email_includes_brand_header() -> None:
    html = render_email(
        preheader="Test",
        title="Hello",
        intro="Welcome",
        cta_url="https://app.shiftswifthr.co.uk",
        cta_label="Sign in",
    )
    assert "#0f6e56" in html
    assert "Sign in" in html
    assert "display:none" in html
