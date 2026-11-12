"""SMS provider selection and rota text delivery."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from core.sms import normalize_phone, preference_includes_sms, send_sms
from modules.rota.notifications import notify_rota_published


def test_uk_mobile_gains_country_code() -> None:
    assert normalize_phone("07123 456789") == "+447123456789"
    assert normalize_phone("+447123456789") == "+447123456789"
    assert normalize_phone("not-a-number") is None


def test_preference_includes_sms() -> None:
    assert preference_includes_sms("email_sms") is True
    assert preference_includes_sms("email") is False
    assert preference_includes_sms("off") is False


def test_send_sms_skips_when_provider_blank(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SMS_PROVIDER", raising=False)
    result = send_sms(to="07123456789", body="Hello")
    assert result["ok"] is False
    assert result["skip_reason"] == "sms_not_configured"


def test_twilio_posts_e164(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACtest")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+441234567890")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {"sid": "SM123"}
    with patch("core.sms.httpx.post", return_value=response) as post:
        result = send_sms(to="07123456789", body="Rota ready")
    assert result["ok"] is True
    assert result["message_id"] == "SM123"
    assert post.call_args.kwargs["data"]["To"] == "+447123456789"
    assert "ACtest" in post.call_args.args[0]


@patch("modules.rota.notifications.send_employee_push", return_value={"sent": 0})
@patch("modules.rota.notifications.send_email_content", return_value={})
@patch("admin_service.tenant_notification_delivery_enabled", return_value=True)
@patch("admin_service.get_tenant_profile", return_value={"notify_on_rota_publish": True})
@patch("admin_service.get_notification_preferences")
@patch("core.sms.send_sms", return_value={"ok": True, "message_id": "SM1"})
def test_rota_publish_texts_when_email_sms(
    send_sms_mock,
    get_prefs,
    _profile,
    _delivery,
    _email,
    _push,
) -> None:
    get_prefs.return_value = {"preferences": {"rota_published": "email_sms"}}
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "alex@example.com", True, "07123456789"),
    ]
    result = notify_rota_published(
        tenant_id=1,
        week_start=date(2026, 6, 8),
        shifts=[
            {
                "employee_id": 1,
                "shift_date": "2026-06-09",
                "start_time": "09:00",
                "end_time": "17:00",
                "role_label": "Floor",
                "notes": "",
            }
        ],
        conn=conn,
    )
    assert result["sms_sent"] == 1
    assert send_sms_mock.call_args.kwargs["to"] == "07123456789"
    assert "ready" in send_sms_mock.call_args.kwargs["body"]
