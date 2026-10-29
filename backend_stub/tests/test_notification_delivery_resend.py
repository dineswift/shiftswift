"""Tests for HR delivery failure listing and resend."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.notifications import (
    humanize_delivery_error,
    list_tenant_delivery_failures,
    resend_tenant_notification,
)


def test_humanize_delivery_error_unauthorized_ip() -> None:
    raw = "SMTP failed on server; (525, b'5.7.1 Unauthorized IP address')"
    message = humanize_delivery_error(raw)
    assert "525" in message or "IP" in message
    assert "Brevo" in message or "whitelist" in message


def test_list_tenant_delivery_failures_maps_payload() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (1,)
    cursor.fetchall.return_value = [
        (
            9,
            "New document available",
            "failed",
            MagicMock(isoformat=lambda: "2026-07-07T12:00:00+00:00"),
            {
                "to": "alex@acme.test",
                "type": "employee_document_shared",
                "employee_id": 3,
                "delivery_error": "SMTP authentication failed",
            },
        )
    ]

    result = list_tenant_delivery_failures(tenant_id=42, conn=conn)

    assert result["total"] == 1
    assert result["items"][0]["id"] == 9
    assert result["items"][0]["label"] == "Document shared"
    assert result["items"][0]["delivery_error"] == "SMTP authentication failed"


@patch("core.notifications.deliver_notification", return_value=True)
@patch("core.notifications.smtp_configured", return_value=True)
def test_resend_tenant_notification_success(_smtp, deliver) -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (
        9,
        42,
        "email",
        "Subject",
        "Body",
        {"to": "alex@acme.test"},
        "failed",
    )

    result = resend_tenant_notification(tenant_id=42, notification_id=9, conn=conn)

    assert result["status"] == "sent"
    deliver.assert_called_once()


@patch("core.notifications.smtp_configured", return_value=False)
def test_resend_tenant_notification_requires_smtp(_smtp) -> None:
    with pytest.raises(RuntimeError, match="SMTP is not configured"):
        resend_tenant_notification(tenant_id=42, notification_id=9, conn=MagicMock())
