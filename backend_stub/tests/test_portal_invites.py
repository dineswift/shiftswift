"""Tests for employee portal invite delivery."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from modules.employees.portal_invites import invite_employee_to_portal


def _employee_conn() -> tuple[MagicMock, MagicMock]:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


@patch("modules.employees.portal_invites.fetch_employee")
@patch("modules.employees.portal_invites.enrich_employees_portal_status")
@patch("modules.employees.portal_invites._ensure_employee_app_user")
@patch("modules.employees.portal_invites.send_account_setup_email")
@patch("modules.employees.portal_invites.log_employee_data_event")
@patch("core.notifications.smtp_configured", return_value=False)
def test_portal_invite_requires_smtp(
    _smtp,
    _audit,
    send_email,
    ensure_user,
    enrich,
    fetch_employee,
) -> None:
    fetch_employee.return_value = {
        "id": 7,
        "first_name": "Alex",
        "last_name": "Smith",
        "email": "alex@acme.test",
        "status": "active",
    }
    enrich.return_value = [{"portal_setup_complete": False}]
    ensure_user.return_value = (
        {"username": "alex@acme.test", "role": "employee", "tenant_id": 42},
        True,
    )
    conn, _cursor = _employee_conn()
    settings = MagicMock()

    with pytest.raises(RuntimeError, match="SMTP is not configured"):
        invite_employee_to_portal(
            tenant_id=42,
            employee_id=7,
            conn=conn,
            settings=settings,
            actor_username="hr@acme.test",
            actor_role="hr",
        )

    send_email.assert_not_called()
    ensure_user.assert_not_called()


@patch("modules.employees.portal_invites.fetch_employee")
@patch("modules.employees.portal_invites.enrich_employees_portal_status")
@patch("modules.employees.portal_invites._ensure_employee_app_user")
@patch("modules.employees.portal_invites.send_account_setup_email", side_effect=RuntimeError("SMTP authentication failed"))
@patch("modules.employees.portal_invites.log_employee_data_event")
@patch("core.notifications.smtp_configured", return_value=True)
def test_portal_invite_surfaces_smtp_delivery_failure(
    _smtp,
    _audit,
    _send_email,
    ensure_user,
    enrich,
    fetch_employee,
) -> None:
    fetch_employee.return_value = {
        "id": 7,
        "first_name": "Alex",
        "last_name": "Smith",
        "email": "alex@acme.test",
        "status": "active",
    }
    enrich.return_value = [{"portal_setup_complete": False}]
    ensure_user.return_value = (
        {"username": "alex@acme.test", "role": "employee", "tenant_id": 42},
        True,
    )
    conn, _cursor = _employee_conn()
    settings = MagicMock()

    with pytest.raises(RuntimeError, match="SMTP authentication failed"):
        invite_employee_to_portal(
            tenant_id=42,
            employee_id=7,
            conn=conn,
            settings=settings,
            actor_username="hr@acme.test",
            actor_role="hr",
        )

    conn.commit.assert_not_called()
