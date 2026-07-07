"""Tests for rota and document push notification wiring."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.documents.notifications import notify_employee_document_shared
from modules.rota.notifications import notify_rota_published


@patch("modules.rota.notifications.send_employee_push")
@patch("modules.rota.notifications.send_email_content", return_value={})
@patch("admin_service.tenant_notification_delivery_enabled", return_value=True)
@patch("admin_service.get_tenant_profile")
def test_rota_published_sends_push(
    get_profile,
    _delivery_enabled,
    send_email,
    send_push,
) -> None:
    get_profile.return_value = {
        "trading_name": "Himalayan Inn",
        "name": "Himalayan Inn",
        "notify_on_rota_publish": True,
    }
    send_push.return_value = {"sent": 1}

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "alex@example.com", True),
    ]

    result = notify_rota_published(
        tenant_id=1,
        week_start=date(2026, 6, 8),
        shifts=[
            {
                "employee_id": 1,
                "shift_date": "2026-06-10",
                "start_time": "09:00",
                "end_time": "17:00",
                "role_label": "Waiter",
            }
        ],
        conn=conn,
    )

    assert result["emails_sent"] == 1
    assert result["pushes_sent"] == 1
    send_push.assert_called_once()
    assert send_push.call_args.kwargs["notification_key"] == "rota_published:2026-06-08:1"


@patch("modules.push.service.send_employee_push")
@patch("modules.documents.notifications.send_email_content")
@patch("admin_service.get_tenant_profile")
def test_payslip_share_sends_push(get_profile, send_email, send_push) -> None:
    get_profile.return_value = {"trading_name": "Himalayan Inn", "name": "Himalayan Inn"}
    send_push.return_value = {"sent": 1}

    conn = MagicMock()
    sent = notify_employee_document_shared(
        tenant_id=1,
        employee={
            "id": 2,
            "first_name": "Sam",
            "last_name": "Patel",
            "email": "sam@example.com",
            "email_notifications_enabled": True,
        },
        document_id=99,
        document_title="June 2026 payslip",
        category="payslip",
        category_label="Payslip",
        pay_period="June 2026",
        conn=conn,
        commit=False,
    )

    assert sent is True
    send_email.assert_called_once()
    send_push.assert_called_once()
    assert send_push.call_args.kwargs["notification_key"] == "document_shared:employee:99"
    assert "June 2026" in send_push.call_args.kwargs["body"]
    assert "payslips" in send_push.call_args.kwargs["url"]
