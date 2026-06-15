"""CRM outbound email — send to prospects and log as activity."""

from __future__ import annotations

import html
import re
from typing import Any

from fastapi import HTTPException

from core.notifications import send_email_notification, smtp_configured
from modules.crm import repository

_TAG_RE = re.compile(r"<[^>]+>")


def html_to_plain(text: str) -> str:
    plain = _TAG_RE.sub("", text)
    plain = html.unescape(plain.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n"))
    return re.sub(r"\n{3,}", "\n\n", plain).strip()


def build_email_context(
    *,
    deal: dict[str, Any],
    business_name: str,
    sender_name: str,
    custom_message: str = "",
) -> dict[str, str]:
    return {
        "contact_name": deal.get("contact_name") or "there",
        "company_name": deal.get("account_name") or business_name,
        "deal_title": deal.get("title") or "your enquiry",
        "sender_name": sender_name,
        "business_name": business_name,
        "custom_message": custom_message.strip(),
    }


def send_deal_email(
    *,
    tenant_id: int,
    deal_id: int,
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str | None,
    sender_name: str,
    created_by: str,
    conn: Any,
) -> dict[str, Any]:
    if not smtp_configured():
        raise HTTPException(
            status_code=503,
            detail="Email is not configured on this server (SMTP_HOST, SMTP_FROM, SMTP_USER, SMTP_PASSWORD).",
        )

    deal = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    plain = (body_text or html_to_plain(body_html)).strip()
    delivery = send_email_notification(
        conn=conn,
        tenant_id=tenant_id,
        subject=subject.strip(),
        body=plain,
        html_body=body_html.strip(),
        purpose="general",
        to=to_email.strip(),
        audience="hr",
        payload={"crm_deal_id": deal_id, "source": "crm"},
        deliver_now=True,
        commit=False,
    )
    if delivery.get("delivery_error"):
        raise HTTPException(status_code=502, detail=str(delivery["delivery_error"]))

    activity = repository.create_activity(
        tenant_id=tenant_id,
        deal_id=deal_id,
        activity_type="email",
        subject=subject.strip(),
        body=f"Sent to {to_email.strip()}\n\n{plain[:2000]}",
        created_by=created_by,
        account_id=deal.get("account_id"),
        contact_id=deal.get("contact_id"),
        conn=conn,
    )

    return {
        "sent": not delivery.get("delivery_error"),
        "delivery": delivery,
        "activity": activity,
        "sender_name": sender_name,
    }
