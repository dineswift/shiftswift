"""Tests for 14-day trial and upgrade reminders."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from trial_service import (  # noqa: E402
    DEFAULT_TRIAL_DAYS,
    _pick_reminder_key,
    days_until_trial_end,
    is_offline_billing,
    process_trial_reminders,
    trial_snapshot,
)


def test_default_trial_is_14_days() -> None:
    assert DEFAULT_TRIAL_DAYS == 14


def test_is_offline_billing() -> None:
    assert is_offline_billing("offline")
    assert not is_offline_billing("stripe")
    assert not is_offline_billing(None)


def test_trial_snapshot_offline_active_skips_trial_pressure() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    end = datetime(2026, 6, 1, tzinfo=timezone.utc)
    cursor.fetchone.return_value = (
        1,
        "Cafe Ltd",
        "billing@cafe.test",
        "site_medium_monthly",
        "active",
        end,
        None,
        None,
        None,
        False,
        25,
        "offline",
    )

    snap = trial_snapshot(tenant_id=1, conn=conn)

    assert snap["offline_billing"] is True
    assert snap["access_allowed"] is True
    assert snap["upgrade_required"] is False
    assert snap["is_trialing"] is False
    assert snap["days_remaining"] is None
    assert snap["trial_ends_at"] is None


def test_process_trial_reminders_skips_offline_tenants() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = []

    summary = process_trial_reminders(conn=conn)

    assert summary["checked"] == 0
    query = cursor.execute.call_args[0][0]
    assert "billing_mode IS DISTINCT FROM 'offline'" in query


def test_days_until_trial_end() -> None:
    now = datetime(2026, 6, 8, 12, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    assert days_until_trial_end(trial_ends_at=end, as_of=now) == 7


def test_pick_reminder_thresholds() -> None:
    assert _pick_reminder_key(10) is None
    assert _pick_reminder_key(7) == "7_day"
    assert _pick_reminder_key(3) == "3_day"
    assert _pick_reminder_key(1) == "1_day"
    assert _pick_reminder_key(0) == "expired"
    assert _pick_reminder_key(-1) == "expired"


def test_days_until_none_when_no_end() -> None:
    assert days_until_trial_end(trial_ends_at=None) is None
