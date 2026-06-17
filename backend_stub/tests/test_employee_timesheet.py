from __future__ import annotations

from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

from modules.time_punch.timesheet import employee_weekly_timesheet, summarize_day_events


def test_summarize_day_events_pairs_in_out() -> None:
    start = datetime(2026, 6, 17, 16, 30, tzinfo=timezone.utc)
    end = datetime(2026, 6, 17, 22, 0, tzinfo=timezone.utc)
    summary = summarize_day_events([("in", start), ("out", end)])
    assert summary["total_hours"] == 5.5
    assert len(summary["segments"]) == 1
    assert summary["complete"] is True


def test_employee_weekly_timesheet_for_one_employee() -> None:
    conn = MagicMock()
    week_start = date(2026, 6, 16)
    with (
        patch("modules.time_punch.timesheet.get_tenant_rota_week_start_day", return_value=0),
        patch(
            "modules.time_punch.timesheet._load_week_punches",
            return_value={
                7: {
                    date(2026, 6, 17): [
                        ("in", datetime(2026, 6, 17, 16, 30, tzinfo=timezone.utc)),
                        ("out", datetime(2026, 6, 17, 22, 0, tzinfo=timezone.utc)),
                    ]
                }
            },
        ),
        patch(
            "modules.time_punch.timesheet._load_employee_punch_log",
            return_value={
                date(2026, 6, 17): [
                    {
                        "punch_type": "in",
                        "label": "Clock in",
                        "time": "17:30",
                        "site_name": "Himalayan Inn — main",
                    }
                ]
            },
        ),
        patch("modules.time_punch.timesheet._load_approvals", return_value={7: {"status": "pending"}}),
    ):
        result = employee_weekly_timesheet(
            tenant_id=1,
            employee_id=7,
            week_start=week_start,
            conn=conn,
        )

    assert result["week_total_hours"] == 5.5
    assert result["approval_status"] == "pending"
    tuesday = next(day for day in result["days"] if day["date"] == "2026-06-17")
    assert tuesday["total_hours"] == 5.5
    assert tuesday["punches"][0]["site_name"] == "Himalayan Inn — main"
