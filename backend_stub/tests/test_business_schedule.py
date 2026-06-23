"""Business schedule parsing and sign-in send windows."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from modules.employees.business_schedule import (
    default_opening_hours,
    parse_business_schedule,
    parse_opening_hours,
    should_send_signin_reminder_now,
    within_before_opening_window,
    within_fixed_hour_window,
)


def test_default_opening_hours_sunday_closed() -> None:
    hours = default_opening_hours()
    assert hours["mon"]["closed"] is False
    assert hours["sun"]["closed"] is True


def test_parse_opening_hours_merges_partial() -> None:
    hours = parse_opening_hours({"mon": {"open": "08:00", "close": "23:00", "closed": False}})
    assert hours["mon"]["open"] == "08:00"
    assert hours["tue"]["open"] == "09:00"


def test_fixed_hour_skips_closed_day() -> None:
    schedule = parse_business_schedule(
        {
            "opening_hours": {
                "mon": {"closed": True, "open": "09:00", "close": "17:00"},
                "tue": {"closed": False, "open": "09:00", "close": "17:00"},
                "wed": {"closed": False, "open": "09:00", "close": "17:00"},
                "thu": {"closed": False, "open": "09:00", "close": "17:00"},
                "fri": {"closed": False, "open": "09:00", "close": "17:00"},
                "sat": {"closed": False, "open": "09:00", "close": "17:00"},
                "sun": {"closed": False, "open": "09:00", "close": "17:00"},
            }
        }
    )
    tz = ZoneInfo("Europe/London")
    monday = datetime(2026, 6, 8, 9, 5, tzinfo=tz).astimezone(timezone.utc)
    assert within_fixed_hour_window(now=monday, hour_local=9, schedule=schedule) is False


def test_before_opening_window_matches_offset() -> None:
    schedule = parse_business_schedule(
        {
            "signin_reminder_timing": "before_opening",
            "signin_reminder_minutes_before_open": 60,
            "opening_hours": {
                day: {"closed": False, "open": "11:00", "close": "22:00"}
                for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
            },
        }
    )
    tz = ZoneInfo("Europe/London")
    now = datetime(2026, 6, 10, 10, 5, tzinfo=tz).astimezone(timezone.utc)
    assert within_before_opening_window(now=now, schedule=schedule) is True
    assert should_send_signin_reminder_now(now=now, hour_local=9, schedule=schedule) is True
