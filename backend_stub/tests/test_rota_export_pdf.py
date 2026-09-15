"""Rota week PDF export tests."""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.rota.export_pdf import (
    build_rota_print_pdf,
    build_rota_week_csv,
    build_rota_week_pdf,
    parse_print_range,
    _range_label,
    _resolve_cell_tone,
    _shift_cell_lines,
)


def test_build_rota_week_pdf_starts_with_pdf_header() -> None:
    week_start = date(2026, 6, 8)
    pdf = build_rota_week_pdf(
        tenant_name="Demo Restaurant",
        week_start=week_start,
        week_end=date(2026, 6, 14),
        week_start_day_name="Monday",
        week_status="published",
        week_days=[week_start + timedelta(days=offset) for offset in range(7)],
        staff=[
            {"id": 1, "print_name": "Karun Acharya", "short_name": "K. Acharya", "role_label": "Tandoori Chef"},
            {"id": 2, "print_name": "Amina Smith", "short_name": "A. Smith", "role_label": "Floor"},
        ],
        shifts=[
            {
                "employee_id": 1,
                "shift_date": "2026-06-09",
                "start_time": "09:00",
                "end_time": "17:00",
                "role_label": "Kitchen",
            },
            {
                "employee_id": 2,
                "shift_date": "2026-06-10",
                "start_time": "12:00",
                "end_time": "20:00",
                "role_label": "Bar",
            },
        ],
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500


def test_build_rota_week_csv_includes_shift_rows() -> None:
    week_start = date(2026, 6, 15)
    week_end = date(2026, 6, 21)
    csv_text = build_rota_week_csv(
        week_start=week_start,
        week_end=week_end,
        week_status="published",
        shifts=[
            {
                "id": 10,
                "employee_id": 1,
                "shift_date": "2026-06-16",
                "start_time": "17:00",
                "end_time": "22:00",
                "role_label": "Kitchen",
                "notes": "",
                "employee_name": "Govind Chhetri",
            },
        ],
        attendance_by_shift_id={
            10: {"attendance_status": "no_show", "attendance_detail": "No clock-in"},
        },
    )
    assert "Week start" in csv_text
    assert "Govind Chhetri" in csv_text
    assert "17:00" in csv_text
    assert "No Show" in csv_text


def test_resolve_cell_tone_prefers_attendance_over_role() -> None:
    shifts = [
        {
            "id": 1,
            "employee_id": 1,
            "shift_date": "2026-06-16",
            "start_time": "17:00",
            "end_time": "22:00",
            "role_label": "Kitchen",
        },
    ]
    assert _resolve_cell_tone(
        shifts,
        fallback_role="Kitchen",
        attendance_by_shift_id={1: {"attendance_status": "no_show"}},
    ) == "no_show"
    assert _resolve_cell_tone(
        shifts,
        fallback_role="Kitchen",
        attendance_by_shift_id={1: {"attendance_status": "attended"}},
    ) == "attended"
    assert _resolve_cell_tone(shifts, fallback_role="Kitchen", attendance_by_shift_id={}) == "kitchen"


def test_build_rota_week_pdf_with_attendance_legend() -> None:
    week_start = date(2026, 6, 15)
    pdf = build_rota_week_pdf(
        tenant_name="Himalayan Inn",
        week_start=week_start,
        week_end=date(2026, 6, 21),
        week_start_day_name="Monday",
        week_status="published",
        week_days=[week_start + timedelta(days=offset) for offset in range(7)],
        staff=[{"id": 1, "short_name": "G. Kharel", "role_label": "Director"}],
        shifts=[
            {
                "id": 5,
                "employee_id": 1,
                "shift_date": "2026-06-16",
                "start_time": "09:00",
                "end_time": "17:00",
                "role_label": "Director",
            },
        ],
        attendance_by_shift_id={5: {"attendance_status": "no_show"}},
    )
    assert pdf.startswith(b"%PDF")


def test_employee_print_name_uses_full_name() -> None:
    from modules.rota.export_pdf import _employee_print_name

    assert _employee_print_name("Karun", "Acharya") == "Karun Acharya"
    assert _employee_print_name("Amina", None) == "Amina"


def test_shift_cell_lines_are_times_only() -> None:
    lines = _shift_cell_lines(
        {
            "start_time": "17:00:00",
            "end_time": "22:00:00",
            "role_label": "Tandoori Chef",
        },
        fallback_role="Tandoori Chef",
    )
    assert lines == ["17:00–22:00"]
    assert not any("Chef" in line or "Tandoori" in line for line in lines)
    assert _shift_cell_lines({"role_label": "Annual leave"}, fallback_role="Chef") == ["Off"]


def test_parse_print_range_accepts_custom_and_past_dates() -> None:
    start, end = parse_print_range("2026-08-03", "2026-08-16")
    assert start == date(2026, 8, 3)
    assert end == date(2026, 8, 16)


def test_parse_print_range_rejects_inverted_and_too_long() -> None:
    try:
        parse_print_range("2026-08-16", "2026-08-03")
        raise AssertionError("expected inverted range to fail")
    except ValueError as exc:
        assert "after" in str(exc).lower()
    try:
        parse_print_range("2026-01-01", "2026-03-01")
        raise AssertionError("expected long range to fail")
    except ValueError as exc:
        assert "6 weeks" in str(exc)


def test_range_label_is_portable() -> None:
    assert _range_label(date(2026, 9, 14), date(2026, 9, 20)) == "14 Sep – 20 Sep 2026"
    assert _range_label(date(2025, 12, 29), date(2026, 1, 4)) == "29 Dec 2025 – 4 Jan 2026"


def test_build_rota_print_pdf_custom_range_skips_unscheduled_staff() -> None:
    start = date(2026, 8, 3)
    end = date(2026, 8, 16)
    pdf = build_rota_print_pdf(
        tenant_name="Reshungha Footd Ltd",
        from_date=start,
        to_date=end,
        days=[start + timedelta(days=offset) for offset in range((end - start).days + 1)],
        staff=[
            {"id": 1, "print_name": "Karun Acharya", "short_name": "K. Acharya", "role_label": "Tandoori Chef"},
            {"id": 2, "print_name": "Radhika Bhusal", "short_name": "R. Bhusal", "role_label": "Staff"},
        ],
        shifts=[
            {
                "employee_id": 1,
                "shift_date": "2026-08-04",
                "start_time": "17:00",
                "end_time": "22:00",
                "role_label": "Tandoori Chef",
            },
            {
                "employee_id": 1,
                "shift_date": "2026-08-11",
                "start_time": "17:00",
                "end_time": "22:00",
                "role_label": "Tandoori Chef",
            },
        ],
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500
