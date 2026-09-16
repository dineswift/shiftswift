"""Tests for platform master tenant ops."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from dev_credentials import DEV_MASTER_PASSWORD, DEV_MASTER_USERNAME
from main import app
from modules.master.platform_ops import update_tenant_workspace

client = TestClient(app)


def _master_headers() -> dict[str, str]:
    login = client.post(
        "/auth/master-login",
        json={"username": DEV_MASTER_USERNAME, "password": DEV_MASTER_PASSWORD},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.skipif(not DEV_MASTER_USERNAME, reason="master credentials not configured")
def test_master_settings_and_audit_endpoints():
    headers = _master_headers()
    settings = client.get("/master/settings", headers=headers)
    assert settings.status_code == 200
    body = settings.json()
    assert "master_require_mfa" in body
    assert "database_configured" in body

    keys = client.get("/master/api-keys", headers=headers)
    assert keys.status_code == 200
    assert "stripe" in keys.json()

    audit = client.get("/master/audit-log?limit=5", headers=headers)
    assert audit.status_code == 200
    assert "items" in audit.json()


@pytest.mark.skipif(not DEV_MASTER_USERNAME, reason="master credentials not configured")
def test_master_account_profile():
    headers = _master_headers()
    res = client.get("/master/account", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == DEV_MASTER_USERNAME


def test_update_tenant_workspace_updates_fields() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    tenant_row = (42, "Old Name", "billing@acme.test", "active", None, None, None)

    with patch("modules.master.platform_ops._get_tenant_row", return_value=tenant_row):
        result = update_tenant_workspace(
            conn=conn,
            tenant_id=42,
            master_tenant_id=1,
            business_name="Acme Hospitality",
            trading_name="Acme Ltd",
            registered_address="10 Market Street, Leeds LS1 1AA",
        )

    assert result == {
        "tenant_id": 42,
        "name": "Acme Hospitality",
        "trading_name": "Acme Ltd",
        "registered_address": "10 Market Street, Leeds LS1 1AA",
    }
    cursor.execute.assert_called_once()


def test_update_tenant_workspace_rejects_deleted_tenant() -> None:
    conn = MagicMock()
    deleted_row = (42, "Old Name", "billing@acme.test", "active", "2025-01-01", None, None)

    with patch("modules.master.platform_ops._get_tenant_row", return_value=deleted_row):
        with pytest.raises(ValueError, match="deleted"):
            update_tenant_workspace(
                conn=conn,
                tenant_id=42,
                master_tenant_id=1,
                business_name="Acme Hospitality",
            )


def test_update_tenant_workspace_not_found() -> None:
    conn = MagicMock()

    with patch("modules.master.platform_ops._get_tenant_row", return_value=None):
        with pytest.raises(LookupError):
            update_tenant_workspace(
                conn=conn,
                tenant_id=99,
                master_tenant_id=1,
                business_name="Missing Co",
            )


def test_email_tenant_contact_raises_on_delivery_failure() -> None:
    from modules.master.platform_ops import email_tenant_contact

    conn = MagicMock()
    tenant_row = (42, "Acme Ltd", "billing@acme.test", "active", None, None, None)

    with patch("modules.master.platform_ops._get_tenant_row", return_value=tenant_row):
        with patch("modules.master.platform_ops.smtp_configured", return_value=True):
            with patch(
                "modules.master.platform_ops.send_email_notification",
                return_value={"delivery_error": "SMTP authentication failed"},
            ):
                with pytest.raises(RuntimeError, match="SMTP authentication failed"):
                    email_tenant_contact(
                        conn=conn,
                        tenant_id=42,
                        master_tenant_id=1,
                        subject="Hello",
                        body="Test message",
                        master_username="admin@shiftswifthr.co.uk",
                    )
