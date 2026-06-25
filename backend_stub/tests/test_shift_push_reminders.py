from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from modules.employees.business_schedule import parse_business_schedule
from modules.push.shift_reminders import evaluate_shift_push_reminders


@patch("modules.push.shift_reminders.get_business_schedule")
@patch("modules.push.shift_reminders.send_employee_push")
@patch("modules.push.shift_reminders.load_punches_for_employees", return_value={})
@patch("modules.push.shift_reminders.list_published_shifts_on_date")
@patch("modules.push.shift_reminders.tenant_has_active_punch_sites", return_value=True)
@patch("modules.push.shift_reminders._primary_site_name", return_value="Himalayan Inn — main")
def test_sends_shift_reminder_before_start(
    _site: MagicMock,
    _has_sites: MagicMock,
    list_shifts: MagicMock,
    _punches: MagicMock,
    send_push: MagicMock,
    schedule_mock: MagicMock,
) -> None:
    schedule_mock.return_value = parse_business_schedule({"shift_reminder_minutes_before": 10})
    list_shifts.return_value = [
        {
            "id": 42,
            "employee_id": 7,
            "shift_date": "2026-06-17",
            "start_time": "17:00",
            "end_time": "22:00",
        }
    ]
    send_push.return_value = {"sent": 1}

    now = datetime(2026, 6, 17, 16, 50, tzinfo=timezone.utc)
    with patch("modules.push.shift_reminders.shift_window") as shift_window:
        shift_window.return_value = (
            datetime(2026, 6, 17, 17, 0, tzinfo=timezone.utc),
            datetime(2026, 6, 17, 22, 0, tzinfo=timezone.utc),
        )
        sent = evaluate_shift_push_reminders(tenant_id=1, conn=MagicMock(), now=now)

    assert len(sent) == 1
    assert sent[0]["type"] == "shift_reminder_10"
    send_push.assert_called_once()
    assert send_push.call_args.kwargs["notification_key"] == "shift_reminder_10:42"
    assert "employee.html#my-shifts" in send_push.call_args.kwargs["url"]


@patch("modules.push.shift_reminders.get_business_schedule")
@patch("modules.push.shift_reminders.send_employee_push")
@patch("modules.push.shift_reminders.load_punches_for_employees", return_value={})
@patch("modules.push.shift_reminders.list_published_shifts_on_date")
@patch("modules.push.shift_reminders.tenant_has_active_punch_sites", return_value=False)
def test_sends_shift_reminder_before_end(
    _has_sites: MagicMock,
    list_shifts: MagicMock,
    _punches: MagicMock,
    send_push: MagicMock,
    schedule_mock: MagicMock,
) -> None:
    schedule_mock.return_value = parse_business_schedule({"shift_end_reminder_minutes_before": 10})
    list_shifts.return_value = [
        {
            "id": 55,
            "employee_id": 7,
            "shift_date": "2026-06-17",
            "start_time": "09:00",
            "end_time": "17:00",
        }
    ]
    send_push.return_value = {"sent": 1}

    now = datetime(2026, 6, 17, 16, 50, tzinfo=timezone.utc)
    with patch("modules.push.shift_reminders.shift_window") as shift_window:
        shift_window.return_value = (
            datetime(2026, 6, 17, 9, 0, tzinfo=timezone.utc),
            datetime(2026, 6, 17, 17, 0, tzinfo=timezone.utc),
        )
        sent = evaluate_shift_push_reminders(tenant_id=1, conn=MagicMock(), now=now)

    assert len(sent) == 1
    assert sent[0]["type"] == "shift_end_reminder_10"
    send_push.assert_called_once()
    assert send_push.call_args.kwargs["notification_key"] == "shift_end_reminder_10:55"
    assert "employee.html#my-shifts" in send_push.call_args.kwargs["url"]


@patch("modules.push.shift_reminders.get_business_schedule")
@patch("modules.push.shift_reminders.send_employee_push")
@patch("modules.push.shift_reminders.evaluate_shift_attendance", return_value={"attendance_status": "awaiting"})
@patch("modules.push.shift_reminders.load_punches_for_employees", return_value={7: []})
@patch("modules.push.shift_reminders.list_published_shifts_on_date")
@patch("modules.push.shift_reminders.tenant_has_active_punch_sites", return_value=True)
@patch("modules.push.shift_reminders._primary_site_name", return_value="Himalayan Inn — main")
def test_sends_early_missed_clock_in(
    _site: MagicMock,
    _has_sites: MagicMock,
    list_shifts: MagicMock,
    _punches: MagicMock,
    _attendance: MagicMock,
    send_push: MagicMock,
    schedule_mock: MagicMock,
) -> None:
    schedule_mock.return_value = parse_business_schedule({"missed_clock_in_early_minutes": 10})
    list_shifts.return_value = [
        {
            "id": 99,
            "employee_id": 7,
            "shift_date": "2026-06-17",
            "start_time": "09:00",
            "end_time": "17:00",
        }
    ]
    send_push.return_value = {"sent": 1}

    start = datetime(2026, 6, 17, 9, 0, tzinfo=timezone.utc)
    now = datetime(2026, 6, 17, 9, 10, tzinfo=timezone.utc)
    with patch("modules.push.shift_reminders.shift_window") as shift_window:
        shift_window.return_value = (start, start.replace(hour=17))
        sent = evaluate_shift_push_reminders(tenant_id=1, conn=MagicMock(), now=now)

    assert any(item["type"] == "shift_missed_clock_in_10" for item in sent)
    keys = [call.kwargs["notification_key"] for call in send_push.call_args_list]
    assert "shift_missed_clock_in_10:99" in keys
