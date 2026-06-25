"""Public document signing routes (token-based, no login)."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from deps import client_ip
from modules.document_signing.service import get_signing_by_token, resolve_signing_file, sign_document

router = APIRouter(prefix="/document-sign", tags=["Document Signing"])


class SignDocumentRequest(BaseModel):
    signature_name: str = Field(min_length=2, max_length=120)
    signature_title: str | None = Field(default=None, max_length=120)
    accept_terms: bool


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


@router.get("/view/{token}")
def view_document_for_signing(token: str) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            return get_signing_by_token(conn, token)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/file/{token}")
def download_document_for_signing(token: str):
    conn = _db_conn()
    try:
        try:
            meta, path = resolve_signing_file(conn, token)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    from modules.documents.storage import download_filename

    filename = download_filename(
        title=str(meta.get("title") or "document"),
        original_filename=meta.get("original_filename"),
        storage_path=str(path),
    )
    return FileResponse(
        path,
        media_type=meta.get("content_type") or "application/octet-stream",
        filename=filename,
        content_disposition_type="inline",
    )


@router.post("/{token}")
def accept_document_signature(
    token: str,
    payload: SignDocumentRequest,
    request: Request,
) -> dict[str, object]:
    if not payload.accept_terms:
        raise HTTPException(status_code=400, detail="You must confirm you have reviewed the document")
    conn = _db_conn()
    try:
        try:
            return sign_document(
                conn=conn,
                token=token,
                signature_name=payload.signature_name,
                ip_address=client_ip(request),
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
