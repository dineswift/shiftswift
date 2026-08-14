"""Tests for targeted rota publish/update notifications."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from core.email_templates import rota_updated_email
from modules.rota.notifications import employees_to_notify, notify_rota_published


def _shift(employee_id: int, day: str, start: str = "09:00", end: str = "17:00") -> dict:
    return {
        "employee_id": employee_id,
        "shift_date": day,
        "start_time": start,
        "end_time": end,
        "role_label": "Floor",
        "notes": "",
    }


def test_first_publish_notifies_everyone_scheduled() -> None:
    current = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10")]
    result = employees_to_notify(previous_shifts=None, current_shifts=current)
    assert result == {1: "initial", 2: "initial"}


def test_republish_skips_unchanged_employee() -> None:
    previous = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10", "09:00", "17:00")]
    current = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10", "10:00", "18:00")]
    result = employees_to_notify(previous_shifts=previous, current_shifts=current)
    assert 1 not in result
    assert result[2] == "updated"


def test_republish_notifies_removed_employee() -> None:
    previous = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10")]
    current = [_shift(1, "2026-06-09")]
    result = employees_to_notify(previous_shifts=previous, current_shifts=current)
    assert 2 in result
    assert result[2] == "removed"


def test_republish_notifies_newly_added_employee() -> None:
    previous = [_shift(1, "2026-06-09")]
    current = [_shift(1, "2026-06-09"), _shift(3, "2026-06-11")]
    result = employees_to_notify(previous_shifts=previous, current_shifts=current)
    assert 1 not in result
    assert result[3] == "added"


def test_rota_updated_email_removed_copy() -> None:
    content = rota_updated_email(
        employee_name="Sam",
        tenant_name="Acme Ltd",
        week_label="9 Jun – 15 Jun 2026",
        shift_lines=[],
        change_kind="removed",
    )
    assert "no longer scheduled" in content.text
    assert "Schedule update" in content.subject


@patch("modules.rota.notifications.send_employee_push")
@patch("modules.rota.notifications.send_email_content", return_value={})
@patch("admin_service.tenant_notification_delivery_enabled", return_value=True)
@patch("admin_service.get_tenant_profile")
def test_republish_only_emails_changed_staff(get_profile, _delivery, send_email, send_push) -> None:
    get_profile.return_value = {"notify_on_rota_publish": True}
    send_push.return_value = {"sent": 1}

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (2, "Alex", "Smith", "alex@example.com", True),
    ]

    previous = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10")]
    current = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10", "11:00", "19:00")]

    result = notify_rota_published(
        tenant_id=1,
        week_start=date(2026, 6, 8),
        shifts=current,
        conn=conn,
        previous_shifts=previous,
    )

    assert result["mode"] == "update"
    assert result["employees_notified"] == 1
    assert result["employees_unchanged"] == 1
    assert result["emails_sent"] == 1
    send_email.assert_called_once()
    assert send_email.call_args.kwargs["payload"]["change_kind"] == "updated"


@patch("modules.rota.notifications.send_employee_push")
@patch("modules.rota.notifications.send_email_content", return_value={})
@patch("admin_service.tenant_notification_delivery_enabled", return_value=True)
@patch("admin_service.get_tenant_profile")
def test_resend_notifies_all_scheduled_staff(get_profile, _delivery, send_email, send_push) -> None:
    get_profile.return_value = {"notify_on_rota_publish": True}
    send_push.return_value = {"sent": 1}

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "alex@example.com", True),
        (2, "Sam", "Patel", "sam@example.com", True),
    ]

    shifts = [
        _shift(1, "2026-06-09"),
        _shift(2, "2026-06-10"),
    ]
    previous = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10")]

    result = notify_rota_published(
        tenant_id=1,
        week_start=date(2026, 6, 8),
        shifts=shifts,
        conn=conn,
        previous_shifts=previous,
        resend=True,
    )

    assert result["mode"] == "resend"
    assert result["employees_notified"] == 2
    assert result["emails_sent"] == 2
    assert send_email.call_count == 2
    assert send_push.call_count == 2
    assert send_push.call_args.kwargs["notification_key"].startswith("rota_resend:")


@patch("modules.rota.notifications.send_employee_push", return_value={"sent": 0, "skipped": "no_subscription"})
@patch(
    "modules.rota.notifications.send_email_content",
    return_value={"delivery_error": "SMTP authentication failed"},
)
@patch("admin_service.tenant_notification_delivery_enabled", return_value=True)
@patch("admin_service.get_tenant_profile")
def test_publish_reports_smtp_failures(get_profile, _delivery, _send_email, _send_push) -> None:
    get_profile.return_value = {"notify_on_rota_publish": True}

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [(1, "Alex", "Smith", "alex@example.com", True)]

    result = notify_rota_published(
        tenant_id=1,
        week_start=date(2026, 6, 8),
        shifts=[_shift(1, "2026-06-09")],
        conn=conn,
        previous_shifts=None,
    )

    assert result["emails_sent"] == 0
    assert result["emails_skipped"] == 1
    assert result["skip_reasons"]["smtp_failed"] == 1
    assert result["email_failures"][0]["error"] == "SMTP authentication failed"


@patch("modules.rota.notifications.send_employee_push", return_value={"sent": 1})
@patch("modules.rota.notifications.send_email_content", return_value={})
@patch("admin_service.tenant_notification_delivery_enabled", return_value=True)
@patch("admin_service.get_tenant_profile")
def test_resend_can_target_selected_staff(get_profile, _delivery, send_email, send_push) -> None:
    get_profile.return_value = {"notify_on_rota_publish": True}

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "alex@example.com", True),
        (2, "Sam", "Patel", "sam@example.com", True),
    ]

    shifts = [_shift(1, "2026-06-09"), _shift(2, "2026-06-10")]

    result = notify_rota_published(
        tenant_id=1,
        week_start=date(2026, 6, 8),
        shifts=shifts,
        conn=conn,
        resend=True,
        employee_ids=[2],
    )

    assert result["employees_notified"] == 1
    assert result["emails_sent"] == 1
    send_email.assert_called_once()
    assert send_email.call_args.kwargs["payload"]["employee_id"] == 2
