"""Tests for HR document upload type and size validation."""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path
import pytest
from fastapi import HTTPException, UploadFile

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.documents.storage import (
    document_upload_policy,
    format_upload_size_limit,
    read_validated_upload,
)


def test_document_upload_policy_defaults() -> None:
    policy = document_upload_policy(max_bytes=10 * 1024 * 1024)
    assert policy["max_size_label"] == "10 MB"
    assert ".pdf" in policy["extensions"]
    assert "application/pdf" in policy["mime_types"]
    assert "PNG" in policy["hint"]


def test_format_upload_size_limit() -> None:
    assert format_upload_size_limit(512 * 1024) == "512 KB"
    assert format_upload_size_limit(5 * 1024 * 1024) == "5 MB"


@pytest.mark.asyncio
async def test_read_validated_upload_accepts_pdf() -> None:
    upload = UploadFile(filename="payslip.pdf", file=BytesIO(b"%PDF-1.4 test"))
    upload.content_type = "application/pdf"
    data, content_type, ext = await read_validated_upload(upload, max_bytes=1024)
    assert data.startswith(b"%PDF")
    assert content_type == "application/pdf"
    assert ext == ".pdf"


@pytest.mark.asyncio
async def test_read_validated_upload_rejects_docx() -> None:
    upload = UploadFile(filename="notes.docx", file=BytesIO(b"PK\x03\x04"))
    upload.content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    with pytest.raises(HTTPException) as exc:
        await read_validated_upload(upload, max_bytes=1024)
    assert exc.value.status_code == 400
    assert "PDF, JPEG, or PNG" in exc.value.detail


@pytest.mark.asyncio
async def test_read_validated_upload_rejects_oversized_file() -> None:
    upload = UploadFile(filename="scan.pdf", file=BytesIO(b"%PDF" + b"x" * 20))
    upload.content_type = "application/pdf"
    with pytest.raises(HTTPException) as exc:
        await read_validated_upload(upload, max_bytes=10)
    assert exc.value.status_code == 413
    assert "maximum upload size" in exc.value.detail
