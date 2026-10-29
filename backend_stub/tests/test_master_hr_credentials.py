"""Tests for master admin HR password reset."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from modules.master.hr_credentials import reset_hr_password


def _conn_with_hr_user(*, deleted_at=None, hr_user=("hr@acme.test", 42, "hr")):
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        (42, "Acme Ltd", "hr@acme.test", "active", deleted_at),
        hr_user,
    ]
    cursor.rowcount = 1
    return conn, cursor


def test_reset_hr_password_requires_action() -> None:
    with pytest.raises(ValueError, match="send_email"):
        reset_hr_password(
            conn=MagicMock(),
            tenant_id=42,
            master_tenant_id=999,
            settings=MagicMock(),
            send_email=False,
            set_temporary_password=False,
            ip_address=None,
            user_agent=None,
        )


def test_reset_hr_password_tenant_not_found() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = None

    with pytest.raises(LookupError, match="Tenant not found"):
        reset_hr_password(
            conn=conn,
            tenant_id=42,
            master_tenant_id=999,
            settings=MagicMock(),
            send_email=False,
            set_temporary_password=True,
            ip_address=None,
            user_agent=None,
        )


def test_reset_hr_password_rejects_deleted_tenant() -> None:
    conn, _ = _conn_with_hr_user(deleted_at="2025-01-01")

    with pytest.raises(ValueError, match="deleted"):
        reset_hr_password(
            conn=conn,
            tenant_id=42,
            master_tenant_id=999,
            settings=MagicMock(),
            send_email=False,
            set_temporary_password=True,
            ip_address=None,
            user_agent=None,
        )


def test_reset_hr_password_no_active_hr() -> None:
    conn, cursor = _conn_with_hr_user(hr_user=None)
    cursor.fetchone.side_effect = [
        (42, "Acme Ltd", "hr@acme.test", "active", None),
        None,
    ]

    with pytest.raises(ValueError, match="No active HR login"):
        reset_hr_password(
            conn=conn,
            tenant_id=42,
            master_tenant_id=999,
            settings=MagicMock(),
            send_email=False,
            set_temporary_password=True,
            ip_address=None,
            user_agent=None,
        )


@patch("modules.master.hr_credentials._generate_temporary_password", return_value="Shift-Test-1234")
@patch("modules.master.hr_credentials.hash_password", return_value="hashed")
def test_reset_hr_password_sets_temporary_password(_hash_password, _generate_password) -> None:
    conn, cursor = _conn_with_hr_user()

    result = reset_hr_password(
        conn=conn,
        tenant_id=42,
        master_tenant_id=999,
        settings=MagicMock(),
        send_email=False,
        set_temporary_password=True,
        ip_address="127.0.0.1",
        user_agent="pytest",
    )

    assert result == {
        "tenant_id": 42,
        "hr_username": "hr@acme.test",
        "email_sent": False,
        "temporary_password_set": True,
        "temporary_password": "Shift-Test-1234",
    }
    update_calls = [call[0][0] for call in cursor.execute.call_args_list]
    assert any("UPDATE app_users" in sql for sql in update_calls)
    app_user_update = next(call for call in cursor.execute.call_args_list if "UPDATE app_users" in call[0][0])
    assert app_user_update[0][1][0] == "hashed"


@patch("modules.master.hr_credentials.send_account_setup_email")
@patch("modules.master.hr_credentials.smtp_configured", return_value=True)
def test_reset_hr_password_sends_email(_smtp_configured, send_email) -> None:
    conn, _ = _conn_with_hr_user()
    settings = MagicMock()

    result = reset_hr_password(
        conn=conn,
        tenant_id=42,
        master_tenant_id=999,
        settings=settings,
        send_email=True,
        set_temporary_password=False,
        ip_address="127.0.0.1",
        user_agent="pytest",
    )

    assert result["email_sent"] is True
    assert result["hr_username"] == "hr@acme.test"
    send_email.assert_called_once()
    assert send_email.call_args.kwargs["security_event_type"] == "master_hr_password_reset_email"


@patch("modules.master.hr_credentials.smtp_configured", return_value=False)
def test_reset_hr_password_email_requires_smtp(_smtp_configured) -> None:
    conn, _ = _conn_with_hr_user()

    with pytest.raises(RuntimeError, match="SMTP"):
        reset_hr_password(
            conn=conn,
            tenant_id=42,
            master_tenant_id=999,
            settings=MagicMock(),
            send_email=True,
            set_temporary_password=False,
            ip_address=None,
            user_agent=None,
        )
