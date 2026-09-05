from __future__ import annotations

from unittest.mock import MagicMock, patch

from signup_routes import _send_signup_ops_notify_email


def test_signup_notify_default_is_datasoft_ops_inbox() -> None:
    from pathlib import Path

    brand_src = (Path(__file__).resolve().parents[1] / "brand.py").read_text()
    assert 'os.getenv("EMAIL_SIGNUP_NOTIFY", "info@datasoftanalytics.com")' in brand_src


def test_send_signup_ops_notify_email_uses_platform_inbox(monkeypatch) -> None:
    monkeypatch.setattr("signup_routes.EMAIL_SIGNUP_NOTIFY", "info@datasoftanalytics.com")
    captured: dict[str, object] = {}

    def fake_send(**kwargs):
        captured.update(kwargs)
        return {"to": kwargs["to"]}

    fake_conn = MagicMock()
    with (
        patch("signup_routes._db_conn", return_value=fake_conn),
        patch("core.notifications.send_email_content", side_effect=fake_send),
    ):
        _send_signup_ops_notify_email(
            tenant_id=7,
            business_name="Himalayan Inn",
            billing_email="info@himalayaninn.com",
            plan_name="Compliance",
            trial_days=14,
            source="self-serve signup",
        )

    assert captured["to"] == "info@datasoftanalytics.com"
    assert captured["audience"] == "platform"
    assert captured["purpose"] == "welcome"
    assert captured["tenant_id"] == 7
    assert captured["deliver_now"] is True
    assert "Himalayan Inn" in captured["content"].subject
    assert "info@himalayaninn.com" in captured["content"].text
    fake_conn.close.assert_called_once()


def test_send_signup_ops_notify_email_skips_when_inbox_blank(monkeypatch) -> None:
    monkeypatch.setattr("signup_routes.EMAIL_SIGNUP_NOTIFY", "  ")
    with patch("core.notifications.send_email_content") as send:
        _send_signup_ops_notify_email(
            tenant_id=7,
            business_name="Himalayan Inn",
            billing_email="info@himalayaninn.com",
            plan_name="Compliance",
        )
    send.assert_not_called()
