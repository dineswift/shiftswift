"""Document 'take photo' must not sit inside a file-upload label."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ADMIN_HTML = ROOT / "frontend" / "admin.html"
ADMIN_DOCS = ROOT / "frontend" / "admin-documents.js"
ADMIN_EMPLOYEES = ROOT / "frontend" / "admin-employees.js"


def test_upload_dropzone_is_not_wrapped_in_a_label() -> None:
    html = ADMIN_HTML.read_text(encoding="utf-8")
    upload_idx = html.index('id="document-upload-dropzone"')
    snippet = html[max(0, upload_idx - 250) : upload_idx]
    assert "<label" not in snippet
    assert 'class="edit-field"' in snippet


def test_distribute_dropzone_is_not_wrapped_in_a_label() -> None:
    html = ADMIN_HTML.read_text(encoding="utf-8")
    idx = html.index('id="document-distribute-dropzone"')
    snippet = html[max(0, idx - 250) : idx]
    assert "<label" not in snippet


def test_take_photo_opens_live_camera() -> None:
    source = ADMIN_DOCS.read_text(encoding="utf-8")
    assert "getUserMedia" in source
    assert "captureLiveDocumentPhoto" in source
    assert "event.stopPropagation()" in source


def test_employee_record_dropzone_is_not_wrapped_in_a_label() -> None:
    source = ADMIN_EMPLOYEES.read_text(encoding="utf-8")
    idx = source.index('id="employees-side-doc-dropzone"')
    snippet = source[max(0, idx - 280) : idx]
    assert "<label" not in snippet
