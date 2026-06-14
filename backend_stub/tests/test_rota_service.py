"""Rota validation and overlap tests."""

from __future__ import annotations

import sys
from datetime import date, time, timedelta
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.rota.service import (
    RotaValidationError,
    assert_week_copy_allowed,
    assert_week_publish_allowed,
    assert_week_save_allowed,
    is_week_fully_past,
    parse_week_start,
    rota_week_policy,
    shift_window,
    shifts_overlap,
    validate_no_overlaps,
    validate_shift_payload,
)


def test_parse_week_start_requires_monday() -> None:
    assert parse_week_start("2026-06-08") == date(2026, 6, 8)
    with pytest.raises(RotaValidationError):
        parse_week_start("2026-06-09")


def test_shift_window_overnight() -> None:
    start, end = shift_window(
        shift_date=date(2026, 6, 8),
        start_time=time(22, 0),
        end_time=time(2, 0),
    )
    assert (end - start).total_seconds() == 4 * 3600


def test_overlapping_shifts_detected() -> None:
    assert shifts_overlap(
        date(2026, 6, 8),
        time(9, 0),
        time(17, 0),
        date(2026, 6, 8),
        time(16, 0),
        time(20, 0),
    )
    assert not shifts_overlap(
        date(2026, 6, 8),
        time(9, 0),
        time(17, 0),
        date(2026, 6, 8),
        time(17, 0),
        time(21, 0),
    )


def test_validate_shift_payload_rejects_out_of_week() -> None:
    week_start = date(2026, 6, 8)
    with pytest.raises(RotaValidationError):
        validate_shift_payload(
            shift={
                "employee_id": 1,
                "shift_date": "2026-06-15",
                "start_time": "09:00",
                "end_time": "17:00",
            },
            week_start=week_start,
            week_end=week_start + timedelta(days=6),
            active_employee_ids={1},
            index=0,
        )


def test_validate_no_overlaps_raises() -> None:
    shifts = [
        {
            "employee_id": 1,
            "shift_date": date(2026, 6, 8),
            "start_time": time(9, 0),
            "end_time": time(17, 0),
        },
        {
            "employee_id": 1,
            "shift_date": date(2026, 6, 8),
            "start_time": time(16, 0),
            "end_time": time(20, 0),
        },
    ]
    with pytest.raises(RotaValidationError):
        validate_no_overlaps(shifts)


def test_validate_no_overlaps_allows_same_slot_different_staff() -> None:
    shifts = [
        {
            "employee_id": 1,
            "shift_date": date(2026, 6, 8),
            "start_time": time(9, 0),
            "end_time": time(17, 0),
        },
        {
            "employee_id": 2,
            "shift_date": date(2026, 6, 8),
            "start_time": time(9, 0),
            "end_time": time(17, 0),
        },
    ]
    validate_no_overlaps(shifts)


def test_past_published_week_is_readonly() -> None:
    week_start = date(2026, 6, 1)
    today = date(2026, 6, 10)
    assert is_week_fully_past(week_start, today=today)
    policy = rota_week_policy(week_start, {"status": "published", "version": 2})
    assert policy["readonly"] is True
    assert policy["copy_blocked"] is True
    with pytest.raises(RotaValidationError):
        assert_week_save_allowed(week_start=week_start, status="published")
    with pytest.raises(RotaValidationError):
        assert_week_copy_allowed(week_start=week_start)
    with pytest.raises(RotaValidationError):
        assert_week_publish_allowed(week_start=week_start)


def test_past_draft_week_allows_save_not_copy() -> None:
    week_start = date(2026, 6, 1)
    today = date(2026, 6, 10)
    policy = rota_week_policy(week_start, {"status": "draft", "version": 1})
    assert policy["readonly"] is False
    assert policy["copy_blocked"] is True
    assert_week_save_allowed(week_start=week_start, status="draft")
    with pytest.raises(RotaValidationError):
        assert_week_copy_allowed(week_start=week_start)


def test_current_week_is_editable() -> None:
    week_start = date(2026, 6, 8)
    today = date(2026, 6, 10)
    assert not is_week_fully_past(week_start, today=today)
    policy = rota_week_policy(week_start, {"status": "published", "version": 3})
    assert policy["readonly"] is False
    assert policy["copy_blocked"] is False
    assert_week_save_allowed(week_start=week_start, status="published")
    assert_week_copy_allowed(week_start=week_start)
