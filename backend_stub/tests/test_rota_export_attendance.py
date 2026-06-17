"""Rota shift attendance export tests."""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.rota.export_attendance import _row_values, build_week_attendance_pdf


def test_row_values_formats_attended_shift() -> None:
    row = _row_values(
        {
            "shift_date": "2026-06-16",
            "employee_name": "Shankar Bhandari",
            "start_time": "17:00",
            "end_time": "22:00",
            "role_label": "Restaurant Manager",
            "attendance_status": "attended",
            "clock_in_at": "2026-06-16T16:00:00+00:00",
            "clock_out_at": None,
            "attendance_detail": "Clock-in recorded for shift",
        }
    )
    assert row[1] == "Shankar Bhandari"
    assert row[5] == "Attended"
    assert row[6] == "17:00"


def test_build_week_attendance_pdf_starts_with_pdf_header() -> None:
    week_start = date(2026, 6, 16)
    pdf = build_week_attendance_pdf(
        tenant_name="Demo Restaurant",
        week_start=week_start,
        week_end=week_start + timedelta(days=6),
        week_start_day_name="Tuesday",
        week_status="published",
        items=[
            {
                "shift_date": "2026-06-16",
                "employee_name": "Shankar Bhandari",
                "start_time": "17:00",
                "end_time": "22:00",
                "role_label": "Restaurant Manager",
                "attendance_status": "attended",
                "clock_in_at": "2026-06-16T16:00:00+00:00",
                "clock_out_at": None,
                "attendance_detail": "Clock-in recorded for shift",
            }
        ],
    )
    assert pdf.startswith(b"%PDF")
