"""Tests for uploaded-document e-signature flow."""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from core.email_templates import document_signing_email
from modules.document_signing.service import (
    SIGNING_TABLE_UNAVAILABLE,
    UNSIGNABLE_CATEGORIES,
    _build_acknowledgment_html,
    _is_missing_signing_table,
    _reference_code,
    attach_signing_status,
    sanitize_signature_image,
    signing_service_error_message,
)


def test_reference_code_format() -> None:
    assert _reference_code(1) == "DOC-SIG-000001"
    assert _reference_code(999999) == "DOC-SIG-999999"


def test_payslip_category_blocked() -> None:
    assert "payslip" in UNSIGNABLE_CATEGORIES


def test_acknowledgment_html_includes_reference_and_hash() -> None:
    html = _build_acknowledgment_html(
        doc={
            "title": "Staff handbook",
            "original_filename": "handbook.pdf",
            "content_sha256": "abc123",
        },
        signature_name="Jane Doe",
        reference_code="DOC-SIG-000042",
        ip_address="203.0.113.10",
    )
    assert "DOC-SIG-000042" in html
    assert "Staff handbook" in html
    assert "handbook.pdf" in html
    assert "abc123" in html
    assert "Jane Doe" in html
    assert "203.0.113.10" in html
    assert "Electronic signature acknowledgment" in html


def test_acknowledgment_html_escapes_user_input() -> None:
    html = _build_acknowledgment_html(
        doc={"title": '<script>alert(1)</script>', "original_filename": "x.pdf"},
        signature_name='Bob "Evil" <img>',
        reference_code="DOC-SIG-000001",
        ip_address=None,
    )
    assert "<script>" not in html
    assert "&lt;img&gt;" in html


def test_document_signing_email_contains_link_and_reference() -> None:
    content = document_signing_email(
        signatory_name="Alex Smith",
        document_title="NDA",
        reference_code="DOC-SIG-000007",
        signing_url="https://app.example.com/sign-contract.html?token=abc&type=document",
    )
    assert "DOC-SIG-000007" in content.subject
    assert "NDA" in content.subject
    assert "sign-contract.html" in content.html
    assert "Alex Smith" in content.text


def test_attach_signing_status_defaults_when_no_requests() -> None:
    docs = [{"id": 5, "title": "Contract"}]

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, *args, **kwargs):
            pass

        def fetchall(self):
            return []

    class _Conn:
        def cursor(self):
            return _Cursor()

    enriched = attach_signing_status(tenant_id=1, documents=docs, conn=_Conn())
    assert enriched[0]["signing_status"] is None
    assert enriched[0]["title"] == "Contract"


def test_attach_signing_status_when_table_missing() -> None:
    docs = [{"id": 5, "title": "Contract"}]

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, *args, **kwargs):
            exc = Exception('relation "employee_document_signing_requests" does not exist')
            exc.pgcode = "42P01"
            raise exc

        def fetchall(self):
            return []

    class _Conn:
        def __init__(self):
            self.rolled_back = False

        def cursor(self):
            return _Cursor()

        def rollback(self):
            self.rolled_back = True

    conn = _Conn()
    enriched = attach_signing_status(tenant_id=1, documents=docs, conn=conn)
    assert enriched[0]["signing_status"] is None
    assert conn.rolled_back is True


def test_missing_signing_table_error_message() -> None:
    class UndefinedTable(Exception):
        pgcode = "42P01"

        def __init__(self) -> None:
            super().__init__('relation "employee_document_signing_requests" does not exist')

    exc = UndefinedTable()
    assert _is_missing_signing_table(exc)
    assert signing_service_error_message(exc) == SIGNING_TABLE_UNAVAILABLE


def test_sanitize_signature_image_accepts_png() -> None:
    raw = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20).decode("ascii")
    url = f"data:image/png;base64,{raw}"
    assert sanitize_signature_image(url) == url
    assert sanitize_signature_image(None) is None
    assert sanitize_signature_image("  ") is None


def test_sanitize_signature_image_rejects_html_and_short_payloads() -> None:
    with pytest.raises(ValueError):
        sanitize_signature_image("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")
    with pytest.raises(ValueError):
        sanitize_signature_image("data:image/png;base64,QQ==")


def test_acknowledgment_html_includes_drawn_signature() -> None:
    raw = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20).decode("ascii")
    png = f"data:image/png;base64,{raw}"
    html = _build_acknowledgment_html(
        doc={"title": "Contract", "original_filename": "c.pdf", "content_sha256": "abc"},
        signature_name="Jane Doe",
        reference_code="DOC-SIG-000009",
        ip_address="203.0.113.10",
        signature_image=png,
    )
    assert png in html
    assert 'alt="Handwritten signature"' in html
