"""Deliver queued notifications via SMTP, webhook HTTP, or log fallback."""

from __future__ import annotations

import json
import logging
import os
import re
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any, Literal

import httpx

EmailPurpose = Literal[
    "billing",
    "contract",
    "compliance",
    "general",
    "welcome",
    "password_reset",
    "employee",
]
EmailAudience = Literal["hr", "employee", "platform"]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_FROM")
        and os.getenv("SMTP_USER")
        and os.getenv("SMTP_PASSWORD")
    )


def email_delivered(payload: dict[str, Any] | None) -> bool:
    """True when send_email_notification / send_email_content completed without delivery_error."""
    return not (payload or {}).get("delivery_error")


def require_email_delivered(payload: dict[str, Any] | None) -> None:
    """Raise RuntimeError when SMTP delivery failed or was not configured."""
    err = (payload or {}).get("delivery_error")
    if err:
        raise RuntimeError(str(err))


def smtp_config_summary() -> dict[str, str | bool]:
    """Non-secret SMTP config snapshot for diagnostics."""
    password = os.getenv("SMTP_PASSWORD", "")
    return {
        "configured": smtp_configured(),
        "host": os.getenv("SMTP_HOST", ""),
        "port": os.getenv("SMTP_PORT", "587"),
        "from": os.getenv("SMTP_FROM", ""),
        "user": os.getenv("SMTP_USER", ""),
        "password_set": bool(password),
        "password_length": len(password),
    }


def _support_email() -> str:
    from brand import EMAIL_SUPPORT

    return EMAIL_SUPPORT


def resolve_tenant_company_email(contacts: dict[str, str | None] | None) -> str | None:
    """Best tenant contact for business Reply-To (billing → signatory → HR login)."""
    if not contacts:
        return None
    for key in ("billing_email", "signatory_email", "hr_email"):
        value = contacts.get(key)
        if value and _looks_like_email(str(value)):
            return str(value).strip()
    return None


def resolve_reply_to(
    *,
    audience: EmailAudience | str = "hr",
    purpose: EmailPurpose | str = "general",
    contacts: dict[str, str | None] | None = None,
    explicit: str | None = None,
) -> str:
    """
    Reply-To routing:
    - Platform mail, welcome, password reset → support@shiftswifthr.co.uk
    - Employee / HR tenant mail → tenant company email when available, else support
    """
    if explicit and _looks_like_email(explicit):
        return explicit.strip()
    if audience == "platform":
        return _support_email()
    if purpose in {"welcome", "password_reset"}:
        return _support_email()
    company = resolve_tenant_company_email(contacts)
    if company and audience in {"employee", "hr"}:
        return company
    if audience == "employee":
        return _support_email()
    if company:
        return company
    return _support_email()


def format_reply_to_header(
    reply_to: str,
    *,
    contacts: dict[str, str | None] | None = None,
    display_name: str | None = None,
) -> str:
    """Format Reply-To with a readable display name where appropriate."""
    address = reply_to.strip()
    if not _looks_like_email(address):
        return address
    if address.lower() == _support_email().lower():
        label = os.getenv("SMTP_REPLY_NAME", f"{_platform_from_name()} Support")
        return formataddr((label, address))
    company = resolve_tenant_company_email(contacts)
    tenant_name = display_name or (contacts or {}).get("tenant_name")
    if company and address.lower() == company.lower() and tenant_name:
        return formataddr((str(tenant_name).strip(), address))
    return address


def _platform_from_name() -> str:
    return os.getenv("SMTP_FROM_NAME", os.getenv("APP_NAME", "ShiftSwift HR"))


def _parse_from_email() -> str:
    raw = os.getenv("SMTP_FROM", "").strip()
    if not raw:
        return raw
    if "<" in raw and ">" in raw:
        return raw.split("<", 1)[1].split(">", 1)[0].strip()
    return raw


_PLATFORM_FROM_PURPOSES = frozenset({"billing", "welcome"})


def _sanitize_from_display_name(name: str) -> str:
    cleaned = "".join(ch for ch in str(name) if ch >= " " or ch == "\t").strip()
    return cleaned[:120] or _platform_from_name()


def resolve_from_display_name(
    *,
    audience: EmailAudience | str = "hr",
    purpose: EmailPurpose | str = "general",
    tenant_id: int | None = None,
    conn: Any | None = None,
) -> str:
    """Readable From name — tenant business/alias for staff mail; platform name otherwise."""
    if audience == "platform" or purpose in _PLATFORM_FROM_PURPOSES:
        return _platform_from_name()
    if tenant_id and conn:
        if audience == "employee":
            from modules.employees.notification_branding import employee_notification_from_name

            return _sanitize_from_display_name(
                employee_notification_from_name(tenant_id=tenant_id, conn=conn)
            )
        if audience == "hr" and purpose != "password_reset":
            contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
            tenant_name = str(contacts.get("tenant_name") or "").strip()
            if tenant_name:
                return _sanitize_from_display_name(tenant_name)
    return _platform_from_name()


def format_from_header(
    *,
    audience: EmailAudience | str = "hr",
    purpose: EmailPurpose | str = "general",
    tenant_id: int | None = None,
    conn: Any | None = None,
) -> str:
    """Format SMTP From with a display name so the raw noreply address is hidden in clients."""
    from_email = _parse_from_email()
    display = resolve_from_display_name(
        audience=audience,
        purpose=purpose,
        tenant_id=tenant_id,
        conn=conn,
    )
    if not from_email:
        return display
    return formataddr((display, from_email))


def _looks_like_email(value: str | None) -> bool:
    if not value:
        return False
    cleaned = str(value).strip()
    return bool(_EMAIL_RE.match(cleaned))


def fetch_tenant_contacts(*, tenant_id: int, conn: Any) -> dict[str, str | None]:
    """Load tenant addresses used for outbound notification routing."""
    billing_email = signatory_email = tenant_name = hr_username = None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT billing_email, signatory_email, name
            FROM tenants
            WHERE id = %s
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if row:
            billing_email, signatory_email, tenant_name = row[0], row[1], row[2]
        cur.execute(
            """
            SELECT username
            FROM app_users
            WHERE tenant_id = %s
              AND role = 'hr'
              AND is_active = TRUE
              AND COALESCE(login_portal, 'business') = 'business'
            ORDER BY id ASC
            LIMIT 1
            """,
            (tenant_id,),
        )
        hr_row = cur.fetchone()
        if hr_row:
            hr_username = hr_row[0]
    hr_email = str(hr_username).strip() if hr_username and _looks_like_email(hr_username) else None
    return {
        "billing_email": (billing_email or "").strip() or None,
        "signatory_email": (signatory_email or "").strip() or None,
        "tenant_name": tenant_name,
        "hr_email": hr_email,
    }


def resolve_email_recipient(
    *,
    purpose: EmailPurpose | str,
    contacts: dict[str, str | None],
    explicit: str | None = None,
) -> str | None:
    """Pick the best tenant recipient for a notification purpose."""
    if explicit and _looks_like_email(explicit):
        return explicit.strip()
    if purpose == "billing":
        return contacts.get("billing_email")
    if purpose == "contract":
        return contacts.get("signatory_email") or contacts.get("billing_email")
    if purpose in {"compliance", "hr", "general"}:
        return (
            contacts.get("billing_email")
            or contacts.get("hr_email")
            or contacts.get("signatory_email")
        )
    return contacts.get("billing_email") or contacts.get("signatory_email")


def build_email_payload(
    *,
    tenant_id: int,
    conn: Any,
    purpose: EmailPurpose | str = "general",
    payload: dict[str, Any] | None = None,
    to: str | None = None,
) -> dict[str, Any]:
    contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
    merged: dict[str, Any] = dict(payload or {})
    merged["purpose"] = purpose
    recipient = resolve_email_recipient(purpose=purpose, contacts=contacts, explicit=to or merged.get("to"))
    if recipient:
        merged["to"] = recipient
    if "audience" not in merged:
        merged["audience"] = "employee" if purpose == "employee" else "hr"
    merged["reply_to"] = resolve_reply_to(
        audience=str(merged.get("audience") or "hr"),
        purpose=purpose,
        contacts=contacts,
        explicit=merged.get("reply_to"),
    )
    return merged


def queue_email_notification(
    *,
    conn: Any,
    tenant_id: int,
    subject: str,
    body: str,
    purpose: EmailPurpose | str = "general",
    payload: dict[str, Any] | None = None,
    to: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Queue an email notification with tenant-aware recipient routing."""
    payload_out = build_email_payload(
        tenant_id=tenant_id,
        conn=conn,
        purpose=purpose,
        payload=payload,
        to=to,
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (tenant_id, channel, subject, body, payload, status)
            VALUES (%s, 'email', %s, %s, %s::jsonb, 'queued')
            """,
            (tenant_id, subject, body, json.dumps(payload_out)),
        )
    if commit:
        conn.commit()
    return payload_out


def send_email_content(
    *,
    conn: Any,
    tenant_id: int | None,
    content: Any,
    purpose: EmailPurpose | str = "general",
    to: str,
    audience: EmailAudience | str = "hr",
    reply_to: str | None = None,
    payload: dict[str, Any] | None = None,
    deliver_now: bool = True,
    commit: bool = True,
) -> dict[str, Any]:
    """Send a structured EmailContent object (subject + text + html)."""
    from core.email_templates import EmailContent

    if not isinstance(content, EmailContent):
        raise TypeError("content must be EmailContent")
    return send_email_notification(
        conn=conn,
        tenant_id=tenant_id,
        subject=content.subject,
        body=content.text,
        html_body=content.html,
        purpose=purpose,
        to=to,
        audience=audience,
        reply_to=reply_to,
        payload=payload,
        deliver_now=deliver_now,
        commit=commit,
    )


def send_email_notification(
    *,
    conn: Any,
    tenant_id: int | None,
    subject: str,
    body: str,
    html_body: str | None = None,
    purpose: EmailPurpose | str = "general",
    to: str,
    audience: EmailAudience | str = "hr",
    reply_to: str | None = None,
    payload: dict[str, Any] | None = None,
    deliver_now: bool = True,
    commit: bool = True,
) -> dict[str, Any]:
    """Queue an email and optionally deliver immediately via SMTP."""
    contacts = None
    if tenant_id:
        contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
    resolved_reply = resolve_reply_to(
        audience=audience,
        purpose=purpose,
        contacts=contacts,
        explicit=reply_to,
    )
    payload_out = dict(payload or {})
    payload_out.update(
        {
            "purpose": purpose,
            "to": to.strip(),
            "audience": audience,
            "reply_to": resolved_reply,
        }
    )
    if html_body:
        payload_out["html_body"] = html_body
    status = "queued"
    delivery_error = None
    if deliver_now and smtp_configured():
        try:
            _send_email(conn=conn, tenant_id=tenant_id, subject=subject, body=body, payload=payload_out)
            status = "sent"
        except Exception as exc:
            delivery_error = str(exc)[:500]
            status = "failed"
            logger.error(
                "Email delivery failed to %s (%s): %s",
                payload_out.get("to"),
                purpose,
                delivery_error,
            )
    elif deliver_now and not smtp_configured():
        delivery_error = (
            "SMTP not configured — set SMTP_HOST, SMTP_FROM, SMTP_USER, SMTP_PASSWORD in backend_stub/.env"
        )
        status = "failed"
        logger.error("Email not sent (%s): %s", purpose, delivery_error)
        _log_channel("email", subject, body, payload_out)

    if delivery_error:
        payload_out["delivery_error"] = delivery_error

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (tenant_id, channel, subject, body, payload, status)
            VALUES (%s, 'email', %s, %s, %s::jsonb, %s)
            """,
            (tenant_id, subject, body, json.dumps(payload_out), status),
        )
    if commit:
        conn.commit()
    return payload_out


def queue_notification(
    *,
    conn: Any,
    tenant_id: int,
    channel: str,
    subject: str,
    body: str,
    payload: dict[str, Any] | None = None,
    purpose: EmailPurpose | str = "general",
    to: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Queue any notification; email channels get tenant recipient routing."""
    payload_out = dict(payload or {})
    if channel == "email":
        payload_out = build_email_payload(
            tenant_id=tenant_id,
            conn=conn,
            purpose=purpose,
            payload=payload_out,
            to=to,
        )
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (tenant_id, channel, subject, body, payload, status)
            VALUES (%s, %s, %s, %s, %s::jsonb, 'queued')
            """,
            (tenant_id, channel, subject, body, json.dumps(payload_out)),
        )
    if commit:
        conn.commit()
    return payload_out


def process_queued_notifications(*, conn: Any, limit: int = 50) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, tenant_id, channel, subject, body, payload
            FROM notifications
            WHERE status = 'queued'
            ORDER BY created_at
            LIMIT %s
            FOR UPDATE SKIP LOCKED
            """,
            (limit,),
        )
        rows = cur.fetchall()

    sent = failed = 0
    for row in rows:
        if deliver_notification(conn=conn, row=row):
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "processed": sent + failed}


def deliver_notification(*, conn: Any, row: tuple[Any, ...]) -> bool:
    notif_id, tenant_id, channel, subject, body, payload_raw = row[:6]
    payload = payload_raw if isinstance(payload_raw, dict) else json.loads(payload_raw or "{}")

    try:
        if channel == "email":
            _send_email(conn=conn, tenant_id=tenant_id, subject=subject, body=body, payload=payload)
        elif channel == "webhook":
            _send_webhook(conn=conn, payload=payload)
        elif channel == "sms":
            _log_channel("sms", subject, body, payload)
        else:
            _send_email(conn=conn, tenant_id=tenant_id, subject=subject, body=body, payload=payload)
        _mark_sent(conn, notif_id)
        return True
    except Exception as exc:
        _mark_failed(conn, notif_id, str(exc))
        return False


def _resolve_delivery_recipient(
    *,
    conn: Any,
    tenant_id: int | None,
    payload: dict[str, Any],
) -> str | None:
    explicit = payload.get("to")
    if explicit and _looks_like_email(str(explicit)):
        return str(explicit).strip()
    if tenant_id:
        contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn)
        purpose = payload.get("purpose", "general")
        resolved = resolve_email_recipient(purpose=purpose, contacts=contacts, explicit=None)
        if resolved:
            return resolved
    return os.getenv("COMPLIANCE_ALERT_EMAIL") or os.getenv("SMTP_TO")


def _resolve_html_and_text(*, subject: str, body: str, payload: dict[str, Any]) -> tuple[str, str]:
    html_body = payload.get("html_body")
    if html_body:
        return body, str(html_body)
    from core.email_templates import generic_notification_email

    wrapped = generic_notification_email(subject=subject, message=body)
    return wrapped.text, wrapped.html


def _send_email(
    *,
    conn: Any,
    tenant_id: int | None,
    subject: str,
    body: str,
    payload: dict[str, Any],
) -> None:
    to_addr = _resolve_delivery_recipient(conn=conn, tenant_id=tenant_id, payload=payload)
    if not smtp_configured():
        raise RuntimeError(
            "SMTP not configured — set SMTP_HOST, SMTP_FROM, SMTP_USER, SMTP_PASSWORD in backend_stub/.env"
        )
    if not to_addr:
        raise RuntimeError(
            "No recipient — set tenant billing/signatory email or COMPLIANCE_ALERT_EMAIL / SMTP_TO"
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    audience = str(payload.get("audience") or "hr")
    purpose = str(payload.get("purpose") or "general")
    msg["From"] = format_from_header(
        audience=audience,
        purpose=purpose,
        tenant_id=tenant_id,
        conn=conn,
    )
    msg["To"] = to_addr
    contacts = fetch_tenant_contacts(tenant_id=tenant_id, conn=conn) if tenant_id else None
    reply_to = resolve_reply_to(
        audience=str(payload.get("audience") or "hr"),
        purpose=str(payload.get("purpose") or "general"),
        contacts=contacts,
        explicit=payload.get("reply_to"),
    )
    if reply_to and _looks_like_email(str(reply_to)):
        reply_display_name = None
        if audience == "employee" and tenant_id and conn:
            from modules.employees.notification_branding import employee_notification_from_name

            reply_display_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
        msg["Reply-To"] = format_reply_to_header(
            str(reply_to).strip(),
            contacts=contacts,
            display_name=reply_display_name,
        )
    cc_addr = payload.get("cc")
    if cc_addr and _looks_like_email(str(cc_addr)):
        msg["Cc"] = str(cc_addr).strip()
    text_body, html_body = _resolve_html_and_text(subject=subject, body=body, payload=payload)
    msg.set_content(text_body, charset="utf-8")
    msg.add_alternative(html_body, subtype="html", charset="utf-8")

    import base64

    for attachment in payload.get("attachments") or []:
        if not isinstance(attachment, dict):
            continue
        filename = str(attachment.get("filename") or "attachment.bin")
        content_type = str(attachment.get("content_type") or "application/octet-stream")
        raw = attachment.get("content_base64")
        if not raw:
            continue
        maintype, _, subtype = content_type.partition("/")
        if not subtype:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(
            base64.b64decode(str(raw)),
            maintype=maintype,
            subtype=subtype,
            filename=filename,
        )

    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    use_tls = os.getenv("SMTP_USE_TLS", "1").strip().lower() in {"1", "true", "yes"}

    with smtplib.SMTP(host, port, timeout=30) as server:
        if use_tls:
            server.starttls()
        if user and password:
            server.login(user, password)
        server.send_message(msg)


def _send_webhook(*, conn: Any, payload: dict[str, Any]) -> None:
    subscription_id = payload.get("subscription_id")
    url = payload.get("target_url")
    secret = payload.get("secret")
    if not url and subscription_id:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT target_url, secret FROM webhook_subscriptions WHERE id = %s",
                (subscription_id,),
            )
            row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Webhook subscription {subscription_id} not found")
        url, secret = row[0], row[1]
    if not url:
        raise RuntimeError("Webhook URL missing")

    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-ShiftSwift-Signature"] = secret
    httpx.post(
        url,
        json={"event_type": payload.get("event_type"), "payload": payload.get("payload", {})},
        headers=headers,
        timeout=15.0,
    ).raise_for_status()


def _log_channel(channel: str, subject: str, body: str, payload: dict[str, Any]) -> None:
    print(
        json.dumps(
            {
                "channel": channel,
                "status": "logged",
                "subject": subject,
                "body_preview": body[:160],
                "payload": payload,
            }
        )
    )


def _mark_sent(conn: Any, notif_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE notifications SET status = 'sent' WHERE id = %s", (notif_id,))
    conn.commit()


def _mark_failed(conn: Any, notif_id: int, error: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE notifications
            SET status = 'failed',
                payload = COALESCE(payload, '{}'::jsonb) || %s::jsonb
            WHERE id = %s
            """,
            (json.dumps({"delivery_error": error[:500]}), notif_id),
        )
    conn.commit()


def _notification_label(*, subject: str, payload: dict[str, Any]) -> str:
    event_type = str(payload.get("type") or payload.get("purpose") or "").strip()
    labels = {
        "employee_document_shared": "Document shared",
        "document_signing": "Signature request",
        "rota_published": "Rota published",
        "rota_updated": "Rota updated",
        "employee_portal_invite_sent": "Portal invite",
    }
    if event_type in labels:
        return labels[event_type]
    return (subject or "Email")[:120]


def list_tenant_delivery_failures(
    *,
    tenant_id: int,
    conn: Any,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """List queued or failed outbound email notifications for HR resend."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM notifications
            WHERE tenant_id = %s
              AND channel = 'email'
              AND status IN ('queued', 'failed')
            """,
            (tenant_id,),
        )
        total = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT id, subject, status, created_at, payload
            FROM notifications
            WHERE tenant_id = %s
              AND channel = 'email'
              AND status IN ('queued', 'failed')
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (tenant_id, limit, offset),
        )
        rows = cur.fetchall()

    items: list[dict[str, Any]] = []
    for row in rows:
        payload = row[4] if isinstance(row[4], dict) else json.loads(row[4] or "{}")
        items.append(
            {
                "id": row[0],
                "subject": row[1],
                "status": row[2],
                "created_at": row[3].isoformat() if hasattr(row[3], "isoformat") else row[3],
                "label": _notification_label(subject=str(row[1] or ""), payload=payload),
                "to": payload.get("to"),
                "event_type": payload.get("type") or payload.get("purpose"),
                "employee_id": payload.get("employee_id"),
                "document_id": payload.get("document_id"),
                "delivery_error": payload.get("delivery_error"),
                "can_resend": True,
            }
        )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def resend_tenant_notification(
    *,
    tenant_id: int,
    notification_id: int,
    conn: Any,
) -> dict[str, Any]:
    """Retry a queued or failed email notification."""
    if not smtp_configured():
        raise RuntimeError("SMTP is not configured on the server — set SMTP_* in environment")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, tenant_id, channel, subject, body, payload, status
            FROM notifications
            WHERE id = %s AND tenant_id = %s
            """,
            (notification_id, tenant_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Notification not found")
    if row[2] != "email":
        raise ValueError("Only email notifications can be resent from here")
    if row[6] == "sent":
        raise ValueError("This notification was already delivered")

    success = deliver_notification(conn=conn, row=row[:6])
    if not success:
        with conn.cursor() as cur:
            cur.execute("SELECT payload FROM notifications WHERE id = %s", (notification_id,))
            payload_row = cur.fetchone()
        payload = (
            payload_row[0]
            if payload_row and isinstance(payload_row[0], dict)
            else json.loads((payload_row or [None])[0] or "{}")
        )
        error = payload.get("delivery_error") or "Email delivery failed"
        raise RuntimeError(str(error))

    return {
        "id": notification_id,
        "status": "sent",
        "message": "Notification resent successfully.",
    }
