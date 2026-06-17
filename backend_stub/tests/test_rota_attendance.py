"""Rota attendance evaluation tests."""

from __future__ import annotations

import sys
from datetime import date, datetime, time, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.rota.attendance import evaluate_shift_attendance


def test_evaluate_shift_attendance_no_show() -> None:
    shift = {
        "id": 1,
        "employee_id": 1,
        "shift_date": "2026-06-08",
        "start_time": "09:00",
        "end_time": "17:00",
        "employee_name": "Alex",
    }
    now = datetime(2026, 6, 8, 18, 0, tzinfo=timezone.utc)
    result = evaluate_shift_attendance(shift=shift, punches=[], now=now)
    assert result["attendance_status"] == "no_show"


def test_evaluate_shift_attendance_late() -> None:
    shift = {
        "id": 2,
        "employee_id": 1,
        "shift_date": "2026-06-08",
        "start_time": "09:00",
        "end_time": "17:00",
        "employee_name": "Alex",
    }
    # 09:06 UK (BST) = 08:06 UTC — six minutes after 09:00 local start
    punches = [{"punch_type": "in", "punched_at": datetime(2026, 6, 8, 8, 6, tzinfo=timezone.utc)}]
    now = datetime(2026, 6, 8, 9, 0, tzinfo=timezone.utc)
    result = evaluate_shift_attendance(shift=shift, punches=punches, now=now)
    assert result["attendance_status"] == "late"


def test_evaluate_shift_attendance_attended() -> None:
    shift = {
        "id": 3,
        "employee_id": 1,
        "shift_date": "2026-06-08",
        "start_time": "09:00",
        "end_time": "17:00",
        "employee_name": "Alex",
    }
    # 08:55 UK (BST) = 07:55 UTC — on time for 09:00 local start
    punches = [{"punch_type": "in", "punched_at": datetime(2026, 6, 8, 7, 55, tzinfo=timezone.utc)}]
    now = datetime(2026, 6, 8, 11, 0, tzinfo=timezone.utc)
    result = evaluate_shift_attendance(shift=shift, punches=punches, now=now)
    assert result["attendance_status"] == "attended"


def test_evaluate_shift_attendance_matches_bst_punch_to_uk_shift() -> None:
    """Regression: punches stored as UTC must match UK-local rota times (BST)."""
    shift = {
        "id": 4,
        "employee_id": 1,
        "shift_date": "2026-06-16",
        "start_time": "09:00",
        "end_time": "17:00",
        "employee_name": "Alex",
    }
    # Staff clock in at 09:00 UK on 16 Jun 2026 → 08:00 UTC
    punches = [{"punch_type": "in", "punched_at": datetime(2026, 6, 16, 8, 0, tzinfo=timezone.utc)}]
    now = datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc)
    result = evaluate_shift_attendance(shift=shift, punches=punches, now=now)
    assert result["attendance_status"] == "attended"


def test_evaluate_shift_attendance_early_evening_punch_counts() -> None:
    """Managers often clock in well before a 17:00 shift starts."""
    shift = {
        "id": 5,
        "employee_id": 1,
        "shift_date": "2026-06-16",
        "start_time": "17:00",
        "end_time": "22:00",
        "employee_name": "Shankar",
    }
    # 16:30 UK (BST) = 15:30 UTC — earlier than the 15-minute pre-shift window
    punches = [{"punch_type": "in", "punched_at": datetime(2026, 6, 16, 15, 30, tzinfo=timezone.utc)}]
    now = datetime(2026, 6, 16, 20, 0, tzinfo=timezone.utc)
    result = evaluate_shift_attendance(shift=shift, punches=punches, now=now)
    assert result["attendance_status"] == "attended"


def test_evaluate_shift_attendance_ongoing_session_counts_for_later_shift() -> None:
    shift = {
        "id": 6,
        "employee_id": 1,
        "shift_date": "2026-06-16",
        "start_time": "17:00",
        "end_time": "22:00",
        "employee_name": "Shankar",
    }
    punches = [{"punch_type": "in", "punched_at": datetime(2026, 6, 16, 8, 0, tzinfo=timezone.utc)}]
    now = datetime(2026, 6, 16, 20, 0, tzinfo=timezone.utc)
    result = evaluate_shift_attendance(shift=shift, punches=punches, now=now)
    assert result["attendance_status"] == "attended"
