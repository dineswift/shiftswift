"""Employee-facing notification copy — custom alias or generic fallback."""

from __future__ import annotations

from typing import Any

from modules.documents.errors import _rollback_quietly

EMPLOYEE_NOTIFICATION_DEFAULT = "Your employer"
_EMPLOYEE_DISPLAY_NAME_KEY = "employee_display_name"


def _stored_notification_json(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


def employee_notification_from_name(*, tenant_id: int, conn: Any) -> str:
    """Name shown to employees in emails/push copy (Settings → Notifications)."""
    tenant_name = EMPLOYEE_NOTIFICATION_DEFAULT
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT notification_preferences, name
                FROM tenants
                WHERE id = %s
                """,
                (tenant_id,),
            )
            row = cur.fetchone()
        stored = _stored_notification_json(row[0] if row else None)
        custom = str(stored.get(_EMPLOYEE_DISPLAY_NAME_KEY) or "").strip()
        legal_name = str(row[1] or "").strip() if row else ""
        tenant_name = custom or legal_name or EMPLOYEE_NOTIFICATION_DEFAULT
    except Exception:
        _rollback_quietly(conn)
    return tenant_name


def employer_legal_name(*, tenant_id: int, conn: Any) -> str:
    """Legal employer name for GDPR / data-controller disclosures."""
    from admin_service import get_tenant_profile

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    return str(profile.get("trading_name") or profile.get("name") or EMPLOYEE_NOTIFICATION_DEFAULT)


def parse_employee_display_name_from_stored(stored: Any) -> str:
    return str(_stored_notification_json(stored).get(_EMPLOYEE_DISPLAY_NAME_KEY) or "").strip()


def merge_notification_preferences_json(
    *,
    stored: Any,
    preferences: dict[str, str] | None = None,
    employee_display_name: str | None = None,
    signin_reminder_interval_days: int | None = None,
    signin_reminder_hour_uk: int | None = None,
    business_timezone: str | None = None,
    opening_hours: dict[str, Any] | None = None,
    shift_reminder_minutes_before: int | None = None,
    shift_end_reminder_minutes_before: int | None = None,
    missed_clock_in_early_minutes: int | None = None,
    missed_clock_in_late_minutes: int | None = None,
    missed_punch_alert_minutes: int | None = None,
    signin_reminder_timing: str | None = None,
    signin_reminder_minutes_before_open: int | None = None,
) -> dict[str, Any]:
    """Build JSONB payload for tenants.notification_preferences."""
    from admin_service import (
        NOTIFICATION_PREF_DEFAULTS,
        SIGNIN_REMINDER_DEFAULT_HOUR_UK,
        SIGNIN_REMINDER_DEFAULT_INTERVAL_DAYS,
        VALID_NOTIFICATION_DELIVERY,
        VALID_SIGNIN_REMINDER_DELIVERY,
    )

    raw = _stored_notification_json(stored)
    merged = dict(NOTIFICATION_PREF_DEFAULTS)
    for key, value in raw.items():
        if key in NOTIFICATION_PREF_DEFAULTS and value in VALID_NOTIFICATION_DELIVERY:
            merged[key] = value
        if key == "employee_signin_reminder" and value in VALID_SIGNIN_REMINDER_DELIVERY:
            merged[key] = value
    if preferences:
        for key, value in preferences.items():
            if key == "employee_signin_reminder":
                if value not in VALID_SIGNIN_REMINDER_DELIVERY:
                    raise ValueError(f"Invalid delivery mode for {key}")
                merged[key] = value
                continue
            if key not in NOTIFICATION_PREF_DEFAULTS:
                continue
            if value not in VALID_NOTIFICATION_DELIVERY:
                raise ValueError(f"Invalid delivery mode for {key}")
            merged[key] = value

    display_name = parse_employee_display_name_from_stored(raw)
    if employee_display_name is not None:
        display_name = employee_display_name.strip()[:120]

    out: dict[str, Any] = dict(merged)
    if display_name:
        out[_EMPLOYEE_DISPLAY_NAME_KEY] = display_name

    interval = raw.get("signin_reminder_interval_days", SIGNIN_REMINDER_DEFAULT_INTERVAL_DAYS)
    hour = raw.get("signin_reminder_hour_uk", SIGNIN_REMINDER_DEFAULT_HOUR_UK)
    if signin_reminder_interval_days is not None:
        interval = max(7, min(365, int(signin_reminder_interval_days)))
    if signin_reminder_hour_uk is not None:
        hour = max(0, min(23, int(signin_reminder_hour_uk)))
    out["signin_reminder_interval_days"] = interval
    out["signin_reminder_hour_uk"] = hour

    from modules.employees.business_schedule import merge_business_schedule_fields

    return merge_business_schedule_fields(
        out,
        raw,
        business_timezone=business_timezone,
        opening_hours=opening_hours,
        shift_reminder_minutes_before=shift_reminder_minutes_before,
        shift_end_reminder_minutes_before=shift_end_reminder_minutes_before,
        missed_clock_in_early_minutes=missed_clock_in_early_minutes,
        missed_clock_in_late_minutes=missed_clock_in_late_minutes,
        missed_punch_alert_minutes=missed_punch_alert_minutes,
        signin_reminder_timing=signin_reminder_timing,
        signin_reminder_minutes_before_open=signin_reminder_minutes_before_open,
    )
