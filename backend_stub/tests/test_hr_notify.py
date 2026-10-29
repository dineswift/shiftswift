"""Tests for HR notification helpers."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.push import hr_notify


@patch("modules.push.service.broadcast_admin_push", return_value={"sent": 0})
@patch("modules.push.hr_notify._send_hr_email", return_value={"sent": 1, "to": "hr@example.com"})
def test_notify_hr_leave_request_sends_email_when_pref_email(send_email, _push) -> None:
    conn = MagicMock()
    result = hr_notify.notify_hr_leave_request(
        tenant_id=1,
        employee_name="Alex Smith",
        leave_type="annual_leave",
        start_date="2026-07-01",
        end_date="2026-07-05",
        request_id=42,
        preferences={"leave_request_hr": "email"},
        conn=conn,
        tenant_name="Demo Ltd",
    )
    assert result["sent"] == 1
    send_email.assert_called_once()
    _push.assert_not_called()


@patch("modules.push.service.broadcast_admin_push", return_value={"sent": 2})
@patch("modules.push.hr_notify._send_hr_email")
def test_notify_hr_leave_request_push_only_skips_email(send_email, _push) -> None:
    conn = MagicMock()
    result = hr_notify.notify_hr_leave_request(
        tenant_id=1,
        employee_name="Alex Smith",
        leave_type="annual_leave",
        start_date="2026-07-01",
        end_date="2026-07-05",
        request_id=42,
        preferences={"leave_request_hr": "push"},
        conn=conn,
        tenant_name="Demo Ltd",
    )
    assert result["sent"] == 2
    send_email.assert_not_called()
    _push.assert_called_once()
