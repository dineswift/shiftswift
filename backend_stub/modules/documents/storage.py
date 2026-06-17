"""Secure on-disk storage for HR document uploads."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

DOCUMENTS_STORAGE_DIR = Path(os.getenv("DOCUMENTS_STORAGE_DIR", "uploads/documents"))

DOCUMENT_ALLOWED_UPLOAD_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}

DOCUMENT_UPLOAD_EXTENSIONS = frozenset({".pdf", ".jpg", ".jpeg", ".png"})
DOCUMENT_UPLOAD_MIME_TYPES = frozenset(DOCUMENT_ALLOWED_UPLOAD_TYPES.keys())
DOCUMENT_UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"

_FALLBACK_OCTET = "application/octet-stream"


def format_upload_size_limit(max_bytes: int) -> str:
    if max_bytes >= 1024 * 1024:
        mb = max_bytes / (1024 * 1024)
        if mb == int(mb):
            return f"{int(mb)} MB"
        return f"{mb:.1f} MB"
    if max_bytes >= 1024:
        return f"{max_bytes // 1024} KB"
    return f"{max_bytes} bytes"


def document_upload_policy(*, max_bytes: int) -> dict[str, Any]:
    max_label = format_upload_size_limit(max_bytes)
    return {
        "accept": DOCUMENT_UPLOAD_ACCEPT,
        "extensions": sorted(DOCUMENT_UPLOAD_EXTENSIONS),
        "mime_types": sorted(DOCUMENT_UPLOAD_MIME_TYPES),
        "max_bytes": max_bytes,
        "max_size_label": max_label,
        "hint": f"PDF, JPEG or PNG · max {max_label} per file",
    }


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_slug(value: str, *, max_len: int = 60) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-._")
    return (slug or "document")[:max_len]


def _detect_document_type(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"%PDF"):
        return "application/pdf", ".pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if data.startswith(b"\x89PNG"):
        return "image/png", ".png"
    return None


async def read_validated_upload(upload: UploadFile, *, max_bytes: int) -> tuple[bytes, str, str]:
    """Return file bytes, normalised content type, and file extension."""
    max_label = format_upload_size_limit(max_bytes)
    raw_type = (upload.content_type or _FALLBACK_OCTET).split(";")[0].strip().lower()
    filename = (upload.filename or "").strip().lower()
    ext_from_name = Path(filename).suffix if filename else ""
    if ext_from_name and ext_from_name not in DOCUMENT_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Upload PDF, JPEG, or PNG only (max {max_label}).",
        )
    if raw_type not in DOCUMENT_UPLOAD_MIME_TYPES and raw_type != _FALLBACK_OCTET:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Upload PDF, JPEG, or PNG only (max {max_label}).",
        )

    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum upload size ({max_label}). Choose a smaller PDF or image.",
        )

    content_type = raw_type
    ext = DOCUMENT_ALLOWED_UPLOAD_TYPES.get(content_type)
    if ext is None:
        detected = _detect_document_type(data)
        if detected is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Upload PDF, JPEG, or PNG only (max {max_label}).",
            )
        content_type, ext = detected
    return data, content_type, ext


def tenant_document_dir(*, tenant_id: int) -> Path:
    path = DOCUMENTS_STORAGE_DIR / str(tenant_id) / "tenant"
    path.mkdir(parents=True, exist_ok=True)
    return path


def employee_document_dir(*, tenant_id: int, employee_id: int) -> Path:
    path = DOCUMENTS_STORAGE_DIR / str(tenant_id) / "employees" / str(employee_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_document_file(
    *,
    tenant_id: int,
    document_id: int,
    title: str,
    original_filename: str | None,
    data: bytes,
    content_type: str,
    ext: str,
    scope: str,
    employee_id: int | None = None,
) -> tuple[str, str, int]:
    digest = _sha256_bytes(data)
    base = _safe_slug(original_filename or title)
    filename = f"{document_id}_{digest[:16]}_{base}{ext}"
    if scope == "employee":
        if employee_id is None:
            raise ValueError("employee_id required for employee document storage")
        target = employee_document_dir(tenant_id=tenant_id, employee_id=employee_id) / filename
    else:
        target = tenant_document_dir(tenant_id=tenant_id) / filename
    if not target.exists():
        target.write_bytes(data)
    return str(target.resolve()), digest, len(data)


def _tenant_root(tenant_id: int) -> Path:
    return (DOCUMENTS_STORAGE_DIR / str(tenant_id)).resolve()


def resolve_stored_file(*, tenant_id: int, storage_path: str | None) -> Path:
    if not storage_path:
        raise HTTPException(status_code=404, detail="No file stored for this document")
    path = Path(storage_path).resolve()
    root = _tenant_root(tenant_id)
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Invalid storage path") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored file not found")
    return path


def resolve_rtw_file(*, tenant_id: int, storage_path: str | None) -> Path:
    from sponsor_licence_compliance import RTW_STORAGE_DIR

    if not storage_path:
        raise HTTPException(status_code=404, detail="No RTW file stored")
    path = Path(storage_path).resolve()
    root = (RTW_STORAGE_DIR / str(tenant_id)).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Invalid RTW storage path") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="RTW file not found on disk")
    return path


def delete_stored_file(storage_path: str | None) -> None:
    if not storage_path:
        return
    path = Path(storage_path)
    if path.is_file():
        path.unlink(missing_ok=True)


def download_filename(*, title: str, original_filename: str | None, storage_path: str | None) -> str:
    if original_filename:
        return _safe_slug(original_filename, max_len=120)
    if storage_path:
        return Path(storage_path).name
    return f"{_safe_slug(title, max_len=80)}.bin"


def document_has_file(doc: dict[str, Any]) -> bool:
    return bool(doc.get("storage_path"))
