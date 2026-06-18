"""Rota week PDF export tests."""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.rota.export_pdf import build_rota_week_csv, build_rota_week_pdf


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
            {"id": 1, "short_name": "K. Acharya", "role_label": "Tandoori Chef"},
            {"id": 2, "short_name": "A. Smith", "role_label": "Floor"},
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
