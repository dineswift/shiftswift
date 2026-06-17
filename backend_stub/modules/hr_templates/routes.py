"""HR process template routes — list, edit, download, reset, version updates."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from config import load_settings
from deps import AuthUser, get_hr_user, resolve_tenant_id
from modules.hr_templates.export_document import build_template_pdf_bytes, build_template_word_bytes
from modules.hr_templates.service import (
    apply_platform_update,
    build_template_download,
    get_template_content,
    get_updates_summary,
    list_templates_for_tenant,
    reset_tenant_template,
    save_tenant_template,
)
from modules.hr_templates.sync import list_template_revisions, sync_all_templates

router = APIRouter(prefix="/hr-templates", tags=["HR Process Templates"])
settings = load_settings()


class TemplateSaveRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content_markdown: str = Field(min_length=1, max_length=100000)


def _db_conn() -> Any:
    import os

    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


@router.get("")
def list_templates(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        items = list_templates_for_tenant(tenant_id=tenant_id, conn=conn)
        updates = get_updates_summary(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return {
        "items": items,
        "count": len(items),
        "updates_pending": updates["pending_count"],
        "platform_publisher": "ShiftSwift HR · shiftswifthr.co.uk",
    }


@router.get("/updates")
def template_updates(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return get_updates_summary(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()


@router.post("/sync-platform")
def sync_platform_templates(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
) -> dict[str, object]:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Master admin only")
    conn = _db_conn()
    try:
        return sync_all_templates(conn=conn)
    finally:
        conn.close()


@router.get("/{template_id}")
def read_template(
    template_id: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return get_template_content(tenant_id=tenant_id, template_id=template_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/{template_id}/revisions")
def template_revisions(
    template_id: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        items = list_template_revisions(template_id=template_id, conn=conn)
    finally:
        conn.close()
    return {"template_id": template_id, "items": items, "count": len(items)}


@router.put("/{template_id}")
def update_template(
    template_id: str,
    payload: TemplateSaveRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return save_tenant_template(
            tenant_id=tenant_id,
            template_id=template_id,
            title=payload.title,
            content_markdown=payload.content_markdown,
            updated_by=current_user.username,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/{template_id}/apply-platform-update")
def accept_platform_update(
    template_id: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return apply_platform_update(
            tenant_id=tenant_id,
            template_id=template_id,
            updated_by=current_user.username,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/{template_id}/reset")
def reset_template(
    template_id: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return reset_tenant_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/{template_id}/download")
def download_template(
    template_id: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    variant: Literal["platform", "effective"] = Query(default="effective"),
    format: Literal["md", "pdf", "doc", "docx"] = Query(default="md"),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        filename, body = build_template_download(
            tenant_id=tenant_id,
            template_id=template_id,
            variant=variant,
            conn=conn,
            ext="docx" if format in {"doc", "docx"} else format,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()

    if format == "pdf":
        title = template_id.replace("_", " ").title()
        content = build_template_pdf_bytes(body, title=title)
        media_type = "application/pdf"
    elif format in {"doc", "docx"}:
        title = template_id.replace("_", " ").title()
        content = build_template_word_bytes(body, title=title)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        content = body.encode("utf-8")
        media_type = "text/markdown; charset=utf-8"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
