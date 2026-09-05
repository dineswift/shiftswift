"""Email OTP login MFA helpers and delivery routing."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from auth_email_mfa import (
    generate_email_mfa_code,
    looks_like_email,
    mask_email,
    parse_tenant_id,
    resolve_login_otp_recipient,
    verify_email_mfa_code,
)
from core.email_templates import login_email_mfa_code
from core.notifications import format_from_header, require_email_delivered
from tests.test_auth_mfa import _dev_settings


def test_ensure_mfa_email_codes_table_creates_otp_store() -> None:
    from auth_email_mfa import ensure_mfa_email_codes_table

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    ensure_mfa_email_codes_table(conn)
    statements = " ".join(str(call.args[0]) for call in cursor.execute.call_args_list)
    assert "CREATE TABLE IF NOT EXISTS mfa_email_codes" in statements
    assert "mfa_email_codes_challenge_jti_active_uq" in statements


def test_issue_email_mfa_code_ensures_table() -> None:
    from auth_email_mfa import issue_email_mfa_code

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    code = issue_email_mfa_code(conn=conn, username="hr@acme.co.uk", challenge_jti="jti-1")
    assert code.isdigit() and len(code) == 6
    statements = " ".join(str(call.args[0]) for call in cursor.execute.call_args_list)
    assert "CREATE TABLE IF NOT EXISTS mfa_email_codes" in statements
    assert "INSERT INTO mfa_email_codes" in statements


def test_email_mfa_helpers() -> None:
    assert looks_like_email("hr@example.com")
    assert looks_like_email("hr+alerts@company.co.uk")
    assert not looks_like_email("not-an-email")
    assert not looks_like_email("admin")
    assert mask_email("hr@example.com").endswith("@example.com")
    assert "*" in mask_email("hr@example.com")
    assert parse_tenant_id("12") == 12
    assert parse_tenant_id("None") is None
    assert parse_tenant_id(None) is None
    code = generate_email_mfa_code()
    assert code.isdigit() and len(code) == 6


def test_login_email_template_shows_code() -> None:
    content = login_email_mfa_code(code="042917", minutes=10)
    assert "sign-in code" in content.subject
    assert "042917" in content.text
    assert "042917" in content.html
    assert "&lt;strong" not in content.html
    assert "10 minutes" in content.text


def test_format_from_header_login_mfa_ignores_tenant_brand(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = ({"employee_display_name": "Restaurant HR"}, "Acme Ltd")

    header = format_from_header(
        audience="employee",
        purpose="login_mfa",
        tenant_id=7,
        conn=conn,
    )
    assert header == "ShiftSwift HR <noreply@shiftswifthr.co.uk>"
    assert "Restaurant HR" not in header


def test_format_from_header_employee_password_reset_stays_platform(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "noreply@shiftswifthr.co.uk")
    monkeypatch.setenv("SMTP_FROM_NAME", "ShiftSwift HR")
    conn = MagicMock()
    header = format_from_header(
        audience="employee",
        purpose="password_reset",
        tenant_id=7,
        conn=conn,
    )
    assert header == "ShiftSwift HR <noreply@shiftswifthr.co.uk>"


def test_require_email_delivered_raises() -> None:
    require_email_delivered({"to": "a@b.co.uk"})
    try:
        require_email_delivered({"delivery_error": "SMTP auth failed"})
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "SMTP auth failed" in str(exc)


def test_resolve_login_otp_recipient_falls_back_to_billing() -> None:
    conn = MagicMock()
    with (
        patch("auth_email_mfa._employee_email_for_username", return_value=None),
        patch("auth_email_mfa._hr_email_usernames", return_value=[]),
        patch(
            "auth_email_mfa.fetch_tenant_contacts",
            return_value={
                "hr_email": None,
                "billing_email": "billing@acme.co.uk",
                "signatory_email": None,
            },
        ),
    ):
        assert (
            resolve_login_otp_recipient(conn=conn, username="office-admin", tenant_id=4)
            == "billing@acme.co.uk"
        )


def test_resolve_login_otp_recipient_uses_later_hr_email_username() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [("office-admin",), ("hr@acme.co.uk",)]
    cursor.fetchone.return_value = None
    assert (
        resolve_login_otp_recipient(conn=conn, username="office-admin", tenant_id=4)
        == "hr@acme.co.uk"
    )


def test_resolve_login_otp_recipients_includes_billing_as_well_as_username() -> None:
    conn = MagicMock()
    with (
        patch("auth_email_mfa._employee_email_for_username", return_value=None),
        patch("auth_email_mfa._hr_email_usernames", return_value=[]),
        patch(
            "auth_email_mfa.fetch_tenant_contacts",
            return_value={
                "hr_email": None,
                "billing_email": "info@himalayaninn.com",
                "signatory_email": None,
            },
        ),
    ):
        from auth_email_mfa import resolve_login_otp_recipients

        assert resolve_login_otp_recipients(
            conn=conn, username="hr@old-hotel.co.uk", tenant_id=4
        ) == ["hr@old-hotel.co.uk", "info@himalayaninn.com"]


def test_resolve_login_otp_recipient_prefers_username_email() -> None:
    assert (
        resolve_login_otp_recipient(conn=MagicMock(), username="hr@acme.co.uk", tenant_id=4)
        == "hr@acme.co.uk"
    )


def test_verify_email_mfa_code_accepts_matching_hash() -> None:
    from auth_email_mfa import _hash_code

    code = "123456"
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (
        1,
        _hash_code(code),
        0,
        datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    assert verify_email_mfa_code(
        conn=conn,
        username="hr@acme.co.uk",
        challenge_jti="abc",
        code=code,
    )
    assert not verify_email_mfa_code(
        conn=conn,
        username="hr@acme.co.uk",
        challenge_jti="abc",
        code="000000",
    )


def test_auth_policy_email_mfa_default_on() -> None:
    from auth_policy import login_require_email_mfa

    assert login_require_email_mfa(_dev_settings())


def test_send_email_code_route_is_registered() -> None:
    from auth_routes import router

    paths = {getattr(route, "path", None) for route in router.routes}
    assert "/mfa/send-email-code" in paths or "/auth/mfa/send-email-code" in paths


def test_send_login_email_code_uses_platform_purpose() -> None:
    settings = _dev_settings()
    conn = MagicMock()
    captured: dict[str, object] = {}

    def fake_send(**kwargs):
        captured.update(kwargs)
        return {"to": kwargs["to"]}

    with (
        patch("auth_email_mfa.smtp_configured", return_value=True),
        patch("auth_email_mfa.send_email_content", side_effect=fake_send),
        patch("core.notifications.require_email_delivered"),
    ):
        from auth_email_mfa import send_login_email_code

        send_login_email_code(
            settings=settings,
            conn=conn,
            username="hr@acme.co.uk",
            tenant_id="3",
            role="hr",
            code="654321",
            commit=False,
        )
    assert captured["purpose"] == "login_mfa"
    assert captured["audience"] == "platform"
    assert captured["to"] == "hr@acme.co.uk"
    assert captured["tenant_id"] == 3
