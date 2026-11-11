"""Timesheet hour calculations."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.timesheet import summarize_day_events


def test_summarize_day_with_break() -> None:
    base = datetime(2026, 6, 9, 9, 0, tzinfo=timezone.utc)
    events = [
        ("in", base),
        ("break_start", base.replace(hour=12)),
        ("break_end", base.replace(hour=12, minute=30)),
        ("out", base.replace(hour=17)),
    ]
    summary = summarize_day_events(events)
    assert summary["total_hours"] == 8.0
    assert summary["break_minutes"] == 30
    assert summary["complete"] is True


def test_summarize_open_shift_not_complete() -> None:
    base = datetime(2026, 6, 9, 9, 0, tzinfo=timezone.utc)
    summary = summarize_day_events([("in", base)])
    assert summary["complete"] is False
    assert "Open shift" in summary["issues"][0]
