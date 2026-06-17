"""Tests for missed clock-in alerts."""

from __future__ import annotations

import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.rota.missed_punch import evaluate_missed_punch_alerts, tenant_has_active_punch_sites


def test_tenant_has_active_punch_sites_true() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (1,)
    assert tenant_has_active_punch_sites(tenant_id=1, conn=conn) is True


def test_evaluate_skips_before_grace_period() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (1,)

    shift = {
        "id": 10,
        "employee_id": 5,
        "shift_date": "2026-06-10",
        "start_time": "09:00",
        "end_time": "17:00",
        "role_label": "Front desk",
        "notes": "",
        "employee_name": "Alex Smith",
        "employee_email": "alex@example.com",
        "email_notifications_enabled": True,
    }
    # 09:10 UK (BST) = 08:10 UTC — before 15-minute post-start alert window (08:15 UTC)
    now = datetime(2026, 6, 10, 8, 10, tzinfo=timezone.utc)

    with patch(
        "modules.rota.missed_punch.list_published_shifts_on_date",
        return_value=[shift],
    ), patch(
        "modules.rota.missed_punch.load_punches_for_employees",
        return_value={5: []},
    ), patch(
        "admin_service.get_notification_preferences",
        return_value={
            "preferences": {"missed_punch_hr": "email", "missed_punch_employee": "off"},
            "notify_on_rota_publish": True,
            "events": [],
        },
    ), patch(
        "admin_service.get_tenant_profile",
        return_value={"name": "Demo Ltd", "trading_name": "Demo Ltd"},
    ):
        result = evaluate_missed_punch_alerts(tenant_id=1, conn=conn, now=now)

    assert result == []


def test_evaluate_creates_alert_after_grace_without_punch() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        (1,),
        (99,),
    ]

    shift = {
        "id": 10,
        "employee_id": 5,
        "shift_date": "2026-06-10",
        "start_time": "09:00",
        "end_time": "17:00",
        "role_label": "",
        "notes": "",
        "employee_name": "Alex Smith",
        "employee_email": "alex@example.com",
        "email_notifications_enabled": True,
    }
    # 09:20 UK (BST) = 08:20 UTC — after alert window, no punch
    now = datetime(2026, 6, 10, 8, 20, tzinfo=timezone.utc)

    with patch(
        "modules.rota.missed_punch.list_published_shifts_on_date",
        return_value=[shift],
    ), patch(
        "modules.rota.missed_punch.load_punches_for_employees",
        return_value={5: []},
    ), patch(
        "admin_service.get_notification_preferences",
        return_value={
            "preferences": {"missed_punch_hr": "email", "missed_punch_employee": "off"},
            "notify_on_rota_publish": True,
            "events": [],
        },
    ), patch(
        "admin_service.get_tenant_profile",
        return_value={"name": "Demo Ltd", "trading_name": "Demo Ltd"},
    ), patch(
        "modules.employees.notification_branding.employer_legal_name",
        return_value="Demo Ltd",
    ), patch(
        "modules.employees.notification_branding.employee_notification_from_name",
        return_value="Demo Ltd",
    ), patch("core.notifications.queue_notification") as queue_mock:
        result = evaluate_missed_punch_alerts(tenant_id=1, conn=conn, now=now)

    assert len(result) == 1
    assert result[0]["employee_name"] == "Alex Smith"
    assert queue_mock.called
    conn.commit.assert_called()
