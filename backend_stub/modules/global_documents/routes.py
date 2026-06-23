"""Platform global documents — downloadable Word and Excel templates for all tenants."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response

from config import load_settings
from deps import AuthUser, get_hr_user, resolve_tenant_id
from modules.global_documents.catalog import GLOBAL_DOCUMENT_CATEGORIES
from modules.global_documents.service import build_global_document_download, list_global_documents

router = APIRouter(prefix="/global-documents", tags=["Global Documents"])
settings = load_settings()


@router.get("")
def list_documents(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    category: str | None = Query(default=None),
) -> dict[str, object]:
    resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    items = list_global_documents(category=category)
    return {
        "items": items,
        "count": len(items),
        "categories": [
            {"id": key, "label": label} for key, label in GLOBAL_DOCUMENT_CATEGORIES.items()
        ],
        "publisher": "ShiftSwift HR · shiftswifthr.co.uk",
    }


@router.get("/{doc_id}/download")
def download_document(
    doc_id: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    try:
        filename, content, media_type = build_global_document_download(doc_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
