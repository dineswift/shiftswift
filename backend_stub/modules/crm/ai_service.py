"""CRM AI assistant — deal summaries and follow-up email drafts."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from modules.ai.client import AiConfigurationError, AiProviderError, generate_crm_text
from modules.crm.constants import DEAL_CATEGORY_LABELS
from modules.crm import repository


def _ensure_ai_allowed(*, tenant_id: int, conn: Any) -> None:
    from modules.ai.client import ai_globally_enabled, configured_provider
    from modules.hr_templates.service import tenant_ai_enabled

    if not ai_globally_enabled():
        raise HTTPException(status_code=503, detail="AI assistant is disabled on this server (AI_ENABLED=0)")
    if not configured_provider():
        raise HTTPException(
            status_code=503,
            detail="AI provider not configured. Set GEMINI_API_KEY (recommended) or OPENAI_API_KEY.",
        )
    if not tenant_ai_enabled(tenant_id=tenant_id, conn=conn):
        raise HTTPException(status_code=403, detail="AI assistant is not enabled for this business")


def build_deal_context(*, tenant_id: int, deal_id: int, conn: Any) -> str:
    deal = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    activities = repository.list_activities(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
    category_label = DEAL_CATEGORY_LABELS.get(deal.get("deal_category") or "general", "General")
    lines = [
        f"Deal: {deal.get('title')}",
        f"Category: {category_label}",
        f"Stage: {deal.get('stage_label') or deal.get('stage_id')}",
        f"Company: {deal.get('account_name') or '—'}",
        f"Contact: {deal.get('contact_name') or '—'}",
        f"Value: £{deal.get('value_gbp')}" if deal.get("value_gbp") is not None else "Value: —",
        f"Expected close: {deal.get('expected_close_date') or '—'}",
        f"Notes: {deal.get('notes') or '—'}",
        "",
        "Recent activity:",
    ]
    if not activities:
        lines.append("(none)")
    else:
        for item in activities[:12]:
            lines.append(
                f"- {item.get('activity_type')}: {item.get('subject') or ''} {item.get('body') or ''}".strip()
            )
    return "\n".join(lines)


def summarize_deal(*, tenant_id: int, deal_id: int, conn: Any) -> dict[str, str]:
    _ensure_ai_allowed(tenant_id=tenant_id, conn=conn)
    context = build_deal_context(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
    prompt = (
        "Summarise this sales opportunity in 3–5 short bullet points for an internal manager "
        "(IT services, HR software, consulting, or general B2B). "
        "Highlight status, next steps, and any risks. Do not invent details."
    )
    try:
        result = generate_crm_text(user_prompt=prompt, context=context)
    except AiConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AiProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return result


def draft_follow_up_email(
    *,
    tenant_id: int,
    deal_id: int,
    conn: Any,
    custom_message: str | None = None,
) -> dict[str, str]:
    _ensure_ai_allowed(tenant_id=tenant_id, conn=conn)
    context = build_deal_context(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
    extra = f"\n\nSuggested personal message to weave in:\n{custom_message.strip()}" if custom_message else ""
    prompt = (
        "Draft a short follow-up email to the contact for this deal. "
        "Return exactly two sections:\n"
        "SUBJECT: (one line)\n"
        "BODY: (plain text, 2–4 short paragraphs, UK English, professional but warm)\n"
        "Do not invent facts not in the context."
        f"{extra}"
    )
    try:
        result = generate_crm_text(user_prompt=prompt, context=context)
    except AiConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AiProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    content = result.get("content", "")
    subject = ""
    body = content
    if "SUBJECT:" in content.upper():
        parts = content.split("BODY:", 1) if "BODY:" in content else content.split("Body:", 1)
        if len(parts) == 2:
            subject = parts[0].replace("SUBJECT:", "").replace("Subject:", "").strip()
            body = parts[1].strip()
        else:
            subject = content.splitlines()[0].replace("SUBJECT:", "").strip()
            body = "\n".join(content.splitlines()[1:]).strip()

    return {
        **result,
        "subject": subject or "Following up",
        "body_text": body,
    }
