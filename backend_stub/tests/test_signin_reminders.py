"""Tests for employee sign-in reminders."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.employees.business_schedule import parse_business_schedule
from modules.employees.signin_reminders import (  # noqa: E402
    _parse_signin_config,
    evaluate_signin_reminders,
)


def test_parse_signin_config_defaults() -> None:
    config = _parse_signin_config({})
    assert config["delivery"] == "email_push"
    assert config["interval_days"] == 30
    assert config["hour_uk"] == 9


def test_parse_signin_config_custom() -> None:
    config = _parse_signin_config(
        {
            "employee_signin_reminder": "email",
            "signin_reminder_interval_days": 14,
            "signin_reminder_hour_uk": 8,
        }
    )
    assert config["delivery"] == "email"
    assert config["interval_days"] == 14
    assert config["hour_uk"] == 8


@patch("core.notifications.send_email_content")
@patch("modules.employees.signin_reminders.get_signin_reminder_config")
@patch("modules.employees.signin_reminders.get_business_schedule")
@patch("modules.employees.signin_reminders._list_reminder_candidates")
@patch("modules.employees.signin_reminders._last_login_at")
@patch("modules.employees.signin_reminders._recent_reminder_sent", return_value=False)
def test_evaluate_signin_reminders_sends_email(
    _recent,
    last_login,
    candidates,
    schedule,
    config,
    send_email,
) -> None:
    uk = ZoneInfo("Europe/London")
    now = datetime(2026, 6, 10, 9, 0, tzinfo=uk).astimezone(timezone.utc)
    last_login.return_value = now - timedelta(days=31)
    config.return_value = {"delivery": "email", "interval_days": 30, "hour_uk": 9}
    schedule.return_value = parse_business_schedule({})
    candidates.return_value = [
        {"id": 5, "first_name": "Sam", "last_name": "Lee", "email": "sam@example.com"},
    ]

    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor

    with patch(
        "modules.employees.signin_reminders.employee_notification_from_name",
        return_value="Acme Ltd",
    ):
        sent = evaluate_signin_reminders(tenant_id=1, conn=conn, now=now)

    assert len(sent) == 1
    assert sent[0]["employee_id"] == 5
    send_email.assert_called_once()
