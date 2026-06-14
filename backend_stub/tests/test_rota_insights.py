from __future__ import annotations

from datetime import date, time

from modules.rota.insights import (
    coverage_gaps_for_week,
    generate_draft_shifts,
    role_matches,
    weekly_hours_warnings,
)


def test_role_matches_job_title_substring() -> None:
    assert role_matches(required_role="floor", job_title="Front of house floor staff") is True
    assert role_matches(required_role="kitchen", job_title="Bar staff") is False


def test_coverage_gaps_detect_deficit() -> None:
    week_start = date(2026, 6, 8)
    requirements = [
        {
            "day_of_week": 1,
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
            "min_staff": 2,
        }
    ]
    shifts = [
        {
            "employee_id": 1,
            "shift_date": "2026-06-08",
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
        }
    ]
    gaps = coverage_gaps_for_week(
        week_start=week_start,
        requirements=requirements,
        shifts=shifts,
        employees_by_id={1: {"job_title": "Floor staff"}},
    )
    assert len(gaps) == 1
    assert gaps[0]["deficit"] == 1
    assert gaps[0]["actual"] == 1
    assert gaps[0]["required"] == 2


def test_weekly_hours_warnings_over_contract() -> None:
    shifts = [
        {
            "employee_id": 5,
            "shift_date": "2026-06-08",
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
        },
        {
            "employee_id": 5,
            "shift_date": "2026-06-09",
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
        },
        {
            "employee_id": 5,
            "shift_date": "2026-06-10",
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
        },
        {
            "employee_id": 5,
            "shift_date": "2026-06-11",
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
        },
        {
            "employee_id": 5,
            "shift_date": "2026-06-12",
            "start_time": "09:00",
            "end_time": "17:00",
            "role_label": "Floor",
        },
        {
            "employee_id": 5,
            "shift_date": "2026-06-13",
            "start_time": "09:00",
            "end_time": "13:00",
            "role_label": "Floor",
        },
    ]
    employees = [
        {
            "id": 5,
            "first_name": "Alex",
            "last_name": "Smith",
            "employment_type": "part_time",
            "contract_hours_weekly": 20.0,
            "status": "active",
        }
    ]
    warnings = weekly_hours_warnings(shifts=shifts, employees=employees)
    assert warnings
    assert warnings[0]["severity"] == "over"
    assert warnings[0]["scheduled_hours"] == 44.0


def test_generate_draft_fills_gap() -> None:
    week_start = date(2026, 6, 8)
    template = {
        "requirements": [
            {
                "day_of_week": 1,
                "start_time": "09:00",
                "end_time": "17:00",
                "role_label": "Floor",
                "min_staff": 2,
            }
        ]
    }
    employees = [
        {"id": 1, "job_title": "Floor", "status": "active"},
        {"id": 2, "job_title": "Floor", "status": "active"},
    ]
    generated = generate_draft_shifts(
        week_start=week_start,
        template=template,
        existing_shifts=[],
        employees=employees,
    )
    assert len(generated) == 2
    assert generated[0]["shift_date"] == "2026-06-08"
    assert generated[0]["start_time"] == "09:00"
