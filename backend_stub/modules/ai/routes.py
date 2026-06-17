"""AI assistant API routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from config import load_settings
from deps import AuthUser, get_hr_user, resolve_tenant_id
from modules.ai.client import (
    AiConfigurationError,
    AiProviderError,
    ai_globally_enabled,
    configured_provider,
    generate_hr_document,
)
from modules.hr_templates.service import log_ai_usage, tenant_ai_document_addon_enabled, tenant_ai_enabled

router = APIRouter(prefix="/ai", tags=["AI Assistant"])
settings = load_settings()


class AiDraftRequest(BaseModel):
    prompt: str = Field(min_length=8, max_length=8000)
    template_id: str | None = Field(default=None, max_length=64)
    business_context: str | None = Field(default=None, max_length=4000)
    existing_draft: str | None = Field(default=None, max_length=50000)


class AiSettingsUpdate(BaseModel):
    enabled: bool


def _db_conn() -> Any:
    import os

    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


def _ensure_ai_allowed(tenant_id: int, conn: Any) -> None:
    if not ai_globally_enabled():
        raise HTTPException(status_code=503, detail="AI assistant is disabled on this server (AI_ENABLED=0)")
    if not configured_provider():
        raise HTTPException(
            status_code=503,
            detail="AI provider not configured. Set GEMINI_API_KEY (recommended) or OPENAI_API_KEY.",
        )
    if not tenant_ai_document_addon_enabled(tenant_id=tenant_id, conn=conn):
        raise HTTPException(
            status_code=403,
            detail="AI document assistant is a paid add-on (£10/month ex VAT). Add it under Settings → Billing & plan.",
        )


@router.get("/status")
def ai_status(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        addon_on = tenant_ai_document_addon_enabled(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    provider = configured_provider()
    server_ready = ai_globally_enabled() and provider is not None
    return {
        "globally_enabled": ai_globally_enabled(),
        "provider_configured": provider is not None,
        "provider": provider,
        "recommended_provider": "gemini",
        "recommended_model": "gemini-2.0-flash",
        "addon_enabled": addon_on,
        "tenant_enabled": addon_on,
        "available": server_ready and addon_on,
        "monthly_price_gbp_ex_vat": 10.0,
        "note": "AI document assistant is a subscription add-on. Contact support or view Billing & plan to add it (£10/month ex VAT).",
    }


@router.get("/settings")
def read_ai_settings(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        enabled = tenant_ai_document_addon_enabled(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return {"enabled": enabled}


@router.patch("/settings")
def update_ai_settings(
    payload: AiSettingsUpdate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        if payload.enabled and not tenant_ai_document_addon_enabled(tenant_id=tenant_id, conn=conn):
            raise HTTPException(
                status_code=403,
                detail="AI document assistant is a paid add-on. Add it under Settings → Billing & plan.",
            )
        from modules.hr_templates.service import set_tenant_ai_enabled

        enabled = set_tenant_ai_enabled(tenant_id=tenant_id, enabled=payload.enabled, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"enabled": enabled}


@router.post("/draft-document")
def draft_document(
    payload: AiDraftRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _ensure_ai_allowed(tenant_id, conn)
        if payload.template_id:
            from modules.hr_templates.service import get_template_content

            try:
                template = get_template_content(
                    tenant_id=tenant_id, template_id=payload.template_id, conn=conn
                )
            except LookupError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            context = payload.business_context or ""
            context += f"\n\nBase template ({template['title']}):\n{template['content_markdown'][:6000]}"
            prompt = payload.prompt
            existing = payload.existing_draft
        else:
            context = payload.business_context
            prompt = payload.prompt
            existing = payload.existing_draft

        try:
            result = generate_hr_document(
                user_prompt=prompt,
                context=context,
                existing_draft=existing,
            )
        except AiConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except AiProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        log_ai_usage(
            tenant_id=tenant_id,
            username=current_user.username,
            action="draft_document",
            template_id=payload.template_id,
            prompt_excerpt=payload.prompt,
            provider=result["provider"],
            model=result["model"],
            conn=conn,
        )
    finally:
        conn.close()
    return result
