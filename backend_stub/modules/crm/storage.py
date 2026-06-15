"""CRM document file storage — separate from HR employee document store."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from fastapi import HTTPException

CRM_STORAGE_DIR = Path(os.getenv("CRM_STORAGE_DIR", "uploads/crm"))

ALLOWED_UPLOAD_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
}

MAX_CRM_UPLOAD_BYTES = 10 * 1024 * 1024


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_slug(value: str, *, max_len: int = 60) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-._")
    return (slug or "file")[:max_len]


def validate_upload(*, data: bytes, content_type: str | None, filename: str | None) -> tuple[str, str]:
    if len(data) > MAX_CRM_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 10 MB limit")
    normalized = (content_type or "").split(";")[0].strip().lower()
    ext = ALLOWED_UPLOAD_TYPES.get(normalized)
    if not ext and filename and "." in filename:
        guess = "." + filename.rsplit(".", 1)[-1].lower()
        if guess in ALLOWED_UPLOAD_TYPES.values():
            ext = guess
            for mime, extension in ALLOWED_UPLOAD_TYPES.items():
                if extension == guess:
                    normalized = mime
                    break
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Allowed file types: PDF, PNG, JPG, DOC, DOCX, TXT",
        )
    return normalized or "application/octet-stream", ext


def tenant_crm_dir(*, tenant_id: int) -> Path:
    path = CRM_STORAGE_DIR / str(tenant_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_crm_file(
    *,
    tenant_id: int,
    document_id: int,
    title: str,
    original_filename: str | None,
    data: bytes,
    content_type: str,
    ext: str,
) -> tuple[str, str, int]:
    digest = _sha256_bytes(data)
    base = _safe_slug(original_filename or title)
    filename = f"{document_id}_{digest[:16]}_{base}{ext}"
    target = tenant_crm_dir(tenant_id=tenant_id) / filename
    if not target.exists():
        target.write_bytes(data)
    return str(target.resolve()), digest, len(data)


def resolve_crm_file(*, tenant_id: int, storage_path: str) -> Path:
    root = tenant_crm_dir(tenant_id=tenant_id).resolve()
    path = Path(storage_path).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=403, detail="Invalid file path")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return path
