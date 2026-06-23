"""Per-tenant business timezone, opening hours, and notification timing."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from modules.documents.errors import _rollback_quietly

DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_LABELS = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}

DEFAULT_TIMEZONE = "Europe/London"
DEFAULT_OPEN = "09:00"
DEFAULT_CLOSE = "22:00"
DEFAULT_SHIFT_REMINDER_MINUTES_BEFORE = 10
DEFAULT_MISSED_CLOCK_IN_EARLY_MINUTES = 10
DEFAULT_MISSED_CLOCK_IN_LATE_MINUTES = 30
DEFAULT_MISSED_PUNCH_ALERT_MINUTES = 15
DEFAULT_SIGNIN_MINUTES_BEFORE_OPEN = 60
SIGNIN_REMINDER_TRIGGER_WINDOW_MINUTES = 20

SIGNIN_TIMING_FIXED = "fixed_hour"
SIGNIN_TIMING_BEFORE_OPENING = "before_opening"
VALID_SIGNIN_TIMING = frozenset({SIGNIN_TIMING_FIXED, SIGNIN_TIMING_BEFORE_OPENING})

SUPPORTED_TIMEZONES: tuple[dict[str, str], ...] = (
    {"value": "Europe/London", "label": "UK — London (GMT/BST)"},
    {"value": "Europe/Belfast", "label": "UK — Belfast"},
    {"value": "Europe/Guernsey", "label": "Channel Islands — Guernsey"},
    {"value": "Europe/Jersey", "label": "Channel Islands — Jersey"},
    {"value": "Europe/Isle_of_Man", "label": "Isle of Man"},
    {"value": "UTC", "label": "UTC"},
)
_SUPPORTED_TIMEZONE_VALUES = frozenset(item["value"] for item in SUPPORTED_TIMEZONES)


def _stored_notification_json(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


def _parse_hhmm(value: Any, *, fallback: str) -> str:
    text = str(value or fallback).strip()[:5]
    parts = text.split(":")
    if len(parts) != 2:
        return fallback
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except (TypeError, ValueError):
        return fallback
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        return fallback
    return f"{hour:02d}:{minute:02d}"


def _time_from_hhmm(value: str) -> time:
    hour, minute = (int(part) for part in value.split(":", 1))
    return time(hour=hour, minute=minute)


def default_opening_hours() -> dict[str, dict[str, Any]]:
    return {
        day: {"closed": day == "sun", "open": DEFAULT_OPEN, "close": DEFAULT_CLOSE}
        for day in DAY_KEYS
    }


def parse_opening_hours(raw: Any) -> dict[str, dict[str, Any]]:
    defaults = default_opening_hours()
    if not isinstance(raw, dict):
        return defaults
    merged: dict[str, dict[str, Any]] = {}
    for day in DAY_KEYS:
        entry = raw.get(day) if isinstance(raw.get(day), dict) else {}
        merged[day] = {
            "closed": bool(entry.get("closed", defaults[day]["closed"])),
            "open": _parse_hhmm(entry.get("open"), fallback=defaults[day]["open"]),
            "close": _parse_hhmm(entry.get("close"), fallback=defaults[day]["close"]),
        }
    return merged


def _clamp_minutes(value: Any, *, default: int, min_v: int = 1, max_v: int = 180) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_v, min(max_v, number))


@dataclass(frozen=True)
class BusinessSchedule:
    timezone_name: str
    tz: ZoneInfo
    opening_hours: dict[str, dict[str, Any]]
    shift_reminder_minutes_before: int
    missed_clock_in_early_minutes: int
    missed_clock_in_late_minutes: int
    missed_punch_alert_minutes: int
    signin_reminder_timing: str
    signin_reminder_minutes_before_open: int

    def day_key_for(self, local_dt: datetime) -> str:
        return DAY_KEYS[local_dt.weekday()]

    def is_open_on_date(self, local_date: datetime) -> bool:
        day = self.opening_hours.get(self.day_key_for(local_date), {})
        return not bool(day.get("closed"))

    def opening_time_on(self, local_dt: datetime) -> time | None:
        day = self.opening_hours.get(self.day_key_for(local_dt), {})
        if day.get("closed"):
            return None
        return _time_from_hhmm(str(day.get("open") or DEFAULT_OPEN))

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "timezone": self.timezone_name,
            "timezone_options": list(SUPPORTED_TIMEZONES),
            "opening_hours": self.opening_hours,
            "day_labels": dict(DAY_LABELS),
            "shift_reminder_minutes_before": self.shift_reminder_minutes_before,
            "missed_clock_in_early_minutes": self.missed_clock_in_early_minutes,
            "missed_clock_in_late_minutes": self.missed_clock_in_late_minutes,
            "missed_punch_alert_minutes": self.missed_punch_alert_minutes,
            "signin_reminder_timing": self.signin_reminder_timing,
            "signin_reminder_minutes_before_open": self.signin_reminder_minutes_before_open,
        }


def parse_business_schedule(stored: Any) -> BusinessSchedule:
    raw = _stored_notification_json(stored)
    timezone_name = str(raw.get("business_timezone") or DEFAULT_TIMEZONE).strip()
    if timezone_name not in _SUPPORTED_TIMEZONE_VALUES:
        timezone_name = DEFAULT_TIMEZONE
    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone_name = DEFAULT_TIMEZONE
        tz = ZoneInfo(DEFAULT_TIMEZONE)

    timing = str(raw.get("signin_reminder_timing") or SIGNIN_TIMING_FIXED).strip().lower()
    if timing not in VALID_SIGNIN_TIMING:
        timing = SIGNIN_TIMING_FIXED

    return BusinessSchedule(
        timezone_name=timezone_name,
        tz=tz,
        opening_hours=parse_opening_hours(raw.get("opening_hours")),
        shift_reminder_minutes_before=_clamp_minutes(
            raw.get("shift_reminder_minutes_before"),
            default=DEFAULT_SHIFT_REMINDER_MINUTES_BEFORE,
            min_v=5,
            max_v=120,
        ),
        missed_clock_in_early_minutes=_clamp_minutes(
            raw.get("missed_clock_in_early_minutes"),
            default=DEFAULT_MISSED_CLOCK_IN_EARLY_MINUTES,
            min_v=5,
            max_v=120,
        ),
        missed_clock_in_late_minutes=_clamp_minutes(
            raw.get("missed_clock_in_late_minutes"),
            default=DEFAULT_MISSED_CLOCK_IN_LATE_MINUTES,
            min_v=10,
            max_v=180,
        ),
        missed_punch_alert_minutes=_clamp_minutes(
            raw.get("missed_punch_alert_minutes"),
            default=DEFAULT_MISSED_PUNCH_ALERT_MINUTES,
            min_v=5,
            max_v=180,
        ),
        signin_reminder_timing=timing,
        signin_reminder_minutes_before_open=_clamp_minutes(
            raw.get("signin_reminder_minutes_before_open"),
            default=DEFAULT_SIGNIN_MINUTES_BEFORE_OPEN,
            min_v=15,
            max_v=240,
        ),
    )


def get_business_schedule(*, tenant_id: int, conn: Any) -> BusinessSchedule:
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT notification_preferences
                FROM tenants
                WHERE id = %s
                """,
                (tenant_id,),
            )
            row = cur.fetchone()
        return parse_business_schedule(row[0] if row else None)
    except Exception:
        _rollback_quietly(conn)
        return parse_business_schedule({})


def local_now(*, now: datetime, schedule: BusinessSchedule) -> datetime:
    parsed = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return parsed.astimezone(schedule.tz)


def within_fixed_hour_window(*, now: datetime, hour_local: int, schedule: BusinessSchedule) -> bool:
    local = local_now(now=now, schedule=schedule)
    if not schedule.is_open_on_date(local):
        return False
    target = local.replace(hour=hour_local, minute=0, second=0, microsecond=0)
    delta_minutes = abs((local - target).total_seconds()) / 60.0
    return delta_minutes <= SIGNIN_REMINDER_TRIGGER_WINDOW_MINUTES


def within_before_opening_window(*, now: datetime, schedule: BusinessSchedule) -> bool:
    local = local_now(now=now, schedule=schedule)
    opening = schedule.opening_time_on(local)
    if opening is None:
        return False
    open_dt = local.replace(
        hour=opening.hour,
        minute=opening.minute,
        second=0,
        microsecond=0,
    )
    target = open_dt - timedelta(minutes=schedule.signin_reminder_minutes_before_open)
    delta_minutes = abs((local - target).total_seconds()) / 60.0
    return delta_minutes <= SIGNIN_REMINDER_TRIGGER_WINDOW_MINUTES


def should_send_signin_reminder_now(
    *,
    now: datetime,
    hour_local: int,
    schedule: BusinessSchedule,
) -> bool:
    if schedule.signin_reminder_timing == SIGNIN_TIMING_BEFORE_OPENING:
        return within_before_opening_window(now=now, schedule=schedule)
    return within_fixed_hour_window(now=now, hour_local=hour_local, schedule=schedule)


def merge_business_schedule_fields(
    out: dict[str, Any],
    raw: dict[str, Any],
    *,
    business_timezone: str | None = None,
    opening_hours: dict[str, Any] | None = None,
    shift_reminder_minutes_before: int | None = None,
    missed_clock_in_early_minutes: int | None = None,
    missed_clock_in_late_minutes: int | None = None,
    missed_punch_alert_minutes: int | None = None,
    signin_reminder_timing: str | None = None,
    signin_reminder_minutes_before_open: int | None = None,
) -> dict[str, Any]:
    schedule = parse_business_schedule({**raw, **out})

    timezone_name = schedule.timezone_name
    if business_timezone is not None:
        candidate = str(business_timezone).strip()
        if candidate in _SUPPORTED_TIMEZONE_VALUES:
            timezone_name = candidate
    out["business_timezone"] = timezone_name

    hours = parse_opening_hours(raw.get("opening_hours"))
    if opening_hours is not None:
        hours = parse_opening_hours({**hours, **opening_hours})
    out["opening_hours"] = hours

    if shift_reminder_minutes_before is not None:
        out["shift_reminder_minutes_before"] = _clamp_minutes(
            shift_reminder_minutes_before,
            default=schedule.shift_reminder_minutes_before,
            min_v=5,
            max_v=120,
        )
    else:
        out["shift_reminder_minutes_before"] = schedule.shift_reminder_minutes_before

    if missed_clock_in_early_minutes is not None:
        out["missed_clock_in_early_minutes"] = _clamp_minutes(
            missed_clock_in_early_minutes,
            default=schedule.missed_clock_in_early_minutes,
            min_v=5,
            max_v=120,
        )
    else:
        out["missed_clock_in_early_minutes"] = schedule.missed_clock_in_early_minutes

    if missed_clock_in_late_minutes is not None:
        out["missed_clock_in_late_minutes"] = _clamp_minutes(
            missed_clock_in_late_minutes,
            default=schedule.missed_clock_in_late_minutes,
            min_v=10,
            max_v=180,
        )
    else:
        out["missed_clock_in_late_minutes"] = schedule.missed_clock_in_late_minutes

    if missed_punch_alert_minutes is not None:
        out["missed_punch_alert_minutes"] = _clamp_minutes(
            missed_punch_alert_minutes,
            default=schedule.missed_punch_alert_minutes,
            min_v=5,
            max_v=180,
        )
    else:
        out["missed_punch_alert_minutes"] = schedule.missed_punch_alert_minutes

    timing = schedule.signin_reminder_timing
    if signin_reminder_timing is not None:
        candidate = str(signin_reminder_timing).strip().lower()
        if candidate in VALID_SIGNIN_TIMING:
            timing = candidate
    out["signin_reminder_timing"] = timing

    if signin_reminder_minutes_before_open is not None:
        out["signin_reminder_minutes_before_open"] = _clamp_minutes(
            signin_reminder_minutes_before_open,
            default=schedule.signin_reminder_minutes_before_open,
            min_v=15,
            max_v=240,
        )
    else:
        out["signin_reminder_minutes_before_open"] = schedule.signin_reminder_minutes_before_open

    return out
