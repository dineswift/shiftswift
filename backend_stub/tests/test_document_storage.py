"""Tests for document file storage and export."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.documents.export import build_documents_csv
from modules.documents.storage import (
    _safe_slug,
    delete_stored_file,
    resolve_documents_storage_dir,
    resolve_stored_file,
    write_document_file,
)


def test_safe_slug_strips_unsafe_characters() -> None:
    assert _safe_slug("Contract / v1 (final).pdf") == "Contract-v1-final-.pdf"


def test_resolve_documents_storage_dir_relative_to_backend_stub(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("DOCUMENTS_STORAGE_DIR", raising=False)
    backend_stub = BACKEND
    expected = (backend_stub / "uploads" / "documents").resolve()
    assert resolve_documents_storage_dir() == expected


def test_write_and_resolve_tenant_document_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("DOCUMENTS_STORAGE_DIR", str(tmp_path))
    import modules.documents.storage as storage_mod

    monkeypatch.setattr(storage_mod, "DOCUMENTS_STORAGE_DIR", tmp_path)

    data = b"%PDF-1.4 test document"
    storage_path, digest, size = write_document_file(
        tenant_id=7,
        document_id=12,
        title="Contract",
        original_filename="contract.pdf",
        data=data,
        content_type="application/pdf",
        ext=".pdf",
        scope="tenant",
    )
    assert size == len(data)
    assert len(digest) == 64
    resolved = resolve_stored_file(tenant_id=7, storage_path=storage_path)
    assert resolved.read_bytes() == data


def test_resolve_stored_file_rejects_other_tenant_paths(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("DOCUMENTS_STORAGE_DIR", str(tmp_path))
    import modules.documents.storage as storage_mod

    monkeypatch.setattr(storage_mod, "DOCUMENTS_STORAGE_DIR", tmp_path)
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"x")
    with pytest.raises(Exception) as exc:
        resolve_stored_file(tenant_id=1, storage_path=str(outside.resolve()))
    assert exc.value.status_code == 403


def test_build_documents_csv_includes_tenant_and_employee_rows() -> None:
    csv_body = build_documents_csv(
        tenant_id=1,
        tenant_documents=[
            {
                "id": 1,
                "employee_id": None,
                "title": "Handbook",
                "category": "policy",
                "lifecycle_stage": "general",
                "document_url": None,
                "storage_path": "/tmp/x",
                "content_sha256": "abc",
                "content_type": "application/pdf",
                "file_size_bytes": 10,
                "original_filename": "handbook.pdf",
                "expires_at": None,
                "uploaded_by": "hr@example.com",
                "created_at": "2026-06-10",
                "notes": "",
            }
        ],
        employee_documents=[
            {
                "id": 2,
                "employee_id": 5,
                "title": "Contract",
                "category": "contract",
                "lifecycle_stage": "document_store",
                "document_url": None,
                "storage_path": None,
                "content_sha256": None,
                "content_type": None,
                "file_size_bytes": None,
                "original_filename": None,
                "expires_at": None,
                "uploaded_by": "hr@example.com",
                "created_at": "2026-06-10",
                "notes": "External link only",
            }
        ],
    )
    assert "scope,id,employee_id" in csv_body.splitlines()[0]
    assert "tenant,1," in csv_body
    assert "employee,2,5" in csv_body
    assert ",yes," in csv_body
    assert ",no," in csv_body


def test_delete_stored_file_removes_file(tmp_path) -> None:
    target = tmp_path / "doc.pdf"
    target.write_bytes(b"data")
    delete_stored_file(str(target))
    assert not target.exists()
