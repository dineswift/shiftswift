"""Outbound SMS. Provider is chosen with SMS_PROVIDER (twilio, vonage, messagebird)."""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(12.0)


def preference_includes_sms(value: str | None) -> bool:
    return "sms" in str(value or "").lower()


def sms_provider_name() -> str:
    return os.getenv("SMS_PROVIDER", "").strip().lower()


def sms_configured() -> bool:
    provider = sms_provider_name()
    if provider == "twilio":
        return bool(_twilio_credentials())
    if provider == "vonage":
        return bool(_vonage_credentials())
    if provider == "messagebird":
        return bool(_messagebird_credentials())
    return False


def normalize_phone(raw: str | None) -> str | None:
    """Return E.164, treating a leading 0 as a UK mobile."""
    text = str(raw or "").strip()
    if not text:
        return None
    has_plus = text.startswith("+")
    digits = re.sub(r"\D", "", text)
    if len(digits) < 10 or len(digits) > 15:
        return None
    if has_plus:
        return f"+{digits}"
    if digits.startswith("0"):
        return f"+44{digits[1:]}"
    if digits.startswith("44"):
        return f"+{digits}"
    return f"+{digits}"


def send_sms(*, to: str, body: str) -> dict[str, Any]:
    """Send one text. Never raises; callers record ok / delivery_error."""
    number = normalize_phone(to)
    message = " ".join(str(body or "").split())
    if not number:
        return _result(ok=False, skip_reason="invalid_mobile", delivery_error="No valid mobile number")
    if not message:
        return _result(ok=False, skip_reason="empty_sms", delivery_error="SMS body is empty")
    provider = sms_provider_name()
    if not provider or not sms_configured():
        return _result(
            ok=False,
            skip_reason="sms_not_configured",
            delivery_error="SMS provider is not configured",
            provider=provider,
        )
    try:
        if provider == "twilio":
            message_id = _send_twilio(to=number, body=message)
        elif provider == "vonage":
            message_id = _send_vonage(to=number, body=message)
        elif provider == "messagebird":
            message_id = _send_messagebird(to=number, body=message)
        else:
            return _result(
                ok=False,
                skip_reason="sms_not_configured",
                delivery_error=f"Unknown SMS provider '{provider}'",
                provider=provider,
            )
    except Exception as exc:
        logger.warning("SMS via %s failed for %s: %s", provider, _mask(number), exc)
        return _result(
            ok=False,
            skip_reason="sms_failed",
            delivery_error=str(exc)[:240],
            provider=provider,
        )
    return _result(ok=True, provider=provider, message_id=message_id)


def rota_sms_body(*, tenant_name: str, week_label: str, shift_count: int, change_kind: str) -> str:
    brand = (tenant_name or "Your employer").strip()[:40] or "Your employer"
    if change_kind == "removed":
        return f"{brand}: you are no longer scheduled for {week_label}. Open the Time Clock app."
    noun = "shift" if shift_count == 1 else "shifts"
    if change_kind == "initial":
        return f"{brand}: your rota for {week_label} is ready ({shift_count} {noun}). Open the Time Clock app."
    return f"{brand}: your rota for {week_label} was updated ({shift_count} {noun}). Open the Time Clock app."


def missed_punch_sms_body(*, tenant_name: str, shift_label: str) -> str:
    brand = (tenant_name or "Your employer").strip()[:40] or "Your employer"
    return f"{brand}: you have not clocked in for {shift_label}. Open the Time Clock app."


def _result(
    *,
    ok: bool,
    provider: str = "",
    message_id: str | None = None,
    skip_reason: str = "",
    delivery_error: str | None = None,
) -> dict[str, Any]:
    return {
        "ok": ok,
        "provider": provider,
        "message_id": message_id,
        "skip_reason": skip_reason,
        "delivery_error": delivery_error,
    }


def _mask(number: str) -> str:
    return f"***{number[-4:]}" if len(number) >= 4 else "***"


def _twilio_credentials() -> tuple[str, str, str] | None:
    sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    sender = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    if sid and token and sender:
        return sid, token, sender
    return None


def _vonage_credentials() -> tuple[str, str, str] | None:
    key = os.getenv("VONAGE_API_KEY", "").strip()
    secret = os.getenv("VONAGE_API_SECRET", "").strip()
    sender = os.getenv("VONAGE_FROM", "").strip()
    if key and secret and sender:
        return key, secret, sender
    return None


def _messagebird_credentials() -> tuple[str, str] | None:
    key = os.getenv("MESSAGEBIRD_ACCESS_KEY", "").strip()
    originator = os.getenv("MESSAGEBIRD_ORIGINATOR", "").strip()
    if key and originator:
        return key, originator
    return None


def _send_twilio(*, to: str, body: str) -> str:
    sid, token, sender = _twilio_credentials() or ("", "", "")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    response = httpx.post(
        url,
        auth=(sid, token),
        data={"From": sender, "To": to, "Body": body},
        timeout=_TIMEOUT,
    )
    payload = _json_or_empty(response)
    if response.status_code >= 400:
        raise RuntimeError(_provider_error(payload) or f"Twilio HTTP {response.status_code}")
    return str(payload.get("sid") or "")


def _send_vonage(*, to: str, body: str) -> str:
    key, secret, sender = _vonage_credentials() or ("", "", "")
    response = httpx.post(
        "https://rest.nexmo.com/sms/json",
        data={
            "api_key": key,
            "api_secret": secret,
            "from": sender,
            "to": to.lstrip("+"),
            "text": body,
        },
        timeout=_TIMEOUT,
    )
    payload = _json_or_empty(response)
    if response.status_code >= 400:
        raise RuntimeError(_provider_error(payload) or f"Vonage HTTP {response.status_code}")
    messages = payload.get("messages") if isinstance(payload, dict) else None
    first = messages[0] if isinstance(messages, list) and messages else {}
    status = str(first.get("status") or "")
    if status != "0":
        raise RuntimeError(str(first.get("error-text") or "Vonage rejected the message"))
    return str(first.get("message-id") or "")


def _send_messagebird(*, to: str, body: str) -> str:
    key, originator = _messagebird_credentials() or ("", "")
    response = httpx.post(
        "https://rest.messagebird.com/messages",
        headers={"Authorization": f"AccessKey {key}", "Content-Type": "application/json"},
        json={"originator": originator, "recipients": [to.lstrip("+")], "body": body},
        timeout=_TIMEOUT,
    )
    payload = _json_or_empty(response)
    if response.status_code >= 400:
        raise RuntimeError(_provider_error(payload) or f"MessageBird HTTP {response.status_code}")
    return str(payload.get("id") or "")


def _json_or_empty(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _provider_error(payload: dict[str, Any]) -> str:
    message = payload.get("message") or payload.get("error")
    if isinstance(message, str) and message.strip():
        return message.strip()[:240]
    errors = payload.get("errors")
    if isinstance(errors, list) and errors:
        first = errors[0]
        if isinstance(first, dict):
            return str(first.get("description") or first.get("message") or "")[:240]
    return ""
