"""Right to work workspace includes passport, visa/BRP, and RTW employee documents."""

from __future__ import annotations

import sys
from datetime import date, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sponsor_licence_compliance import (  # noqa: E402
    _serialize_identity_document_row,
    identity_document_kind,
    identity_document_type_label,
    parse_rtw_record_id,
)


def test_identity_kind_maps_passport_visa_and_rtw() -> None:
    assert identity_document_kind("id") == "passport"
    assert identity_document_kind("passport") == "passport"
    assert identity_document_kind("visa_brp") == "visa"
    assert identity_document_kind("visa") == "visa"
    assert identity_document_kind("rtw") == "rtw_check"
    assert identity_document_kind("right_to_work") == "rtw_check"


def test_identity_type_labels_are_readable() -> None:
    assert identity_document_type_label("id") == "Passport / ID"
    assert identity_document_type_label("visa_brp") == "Visa / BRP"
    assert identity_document_type_label("rtw") == "Right to work check"


def test_parse_rtw_record_ids() -> None:
    assert parse_rtw_record_id("doc-12") == ("document", 12)
    assert parse_rtw_record_id("check-4") == ("check", 4)
    assert parse_rtw_record_id(9) == ("check", 9)


def _doc_row(**overrides):
    row = {
        "document_id": 10,
        "employee_id": 42,
        "title": "British passport",
        "category": "id",
        "original_filename": "passport.jpg",
        "storage_path": "uploads/passport.jpg",
        "content_sha256": "abc123deadbeef",
        "content_type": "image/jpeg",
        "expires_at": date(2030, 1, 15),
        "created_at": datetime(2026, 3, 1, 12, 0),
        "uploaded_by": "hr@example.com",
        "first_name": "Karun",
        "last_name": "Acharya",
        "job_title": "Chef",
        "department": "Kitchen",
        "email": "k@example.com",
        "is_sponsored": True,
        "visa_expiry_date": None,
        "rtw_check_expiry_date": None,
    }
    row.update(overrides)
    return (
        row["document_id"],
        row["employee_id"],
        row["title"],
        row["category"],
        row["original_filename"],
        row["storage_path"],
        row["content_sha256"],
        row["content_type"],
        row["expires_at"],
        row["created_at"],
        row["uploaded_by"],
        row["first_name"],
        row["last_name"],
        row["job_title"],
        row["department"],
        row["email"],
        row["is_sponsored"],
        row["visa_expiry_date"],
        row["rtw_check_expiry_date"],
    )


def test_serialize_passport_document() -> None:
    item = _serialize_identity_document_row(_doc_row(), as_of=date(2026, 9, 16))
    assert item["id"] == "doc-10"
    assert item["source"] == "employee_document"
    assert item["document_kind"] == "passport"
    assert item["document_type"] == "Passport / ID"
    assert item["status"] == "verified"
    assert item["expiry_date"] == "2030-01-15"
    assert item["expiry_label"] == "Passport expiry"
    assert item["employee_name"] == "Karun Acharya"


def test_serialize_expired_visa_needs_review() -> None:
    item = _serialize_identity_document_row(
        _doc_row(title="BRP", category="visa_brp", expires_at=date(2026, 1, 1)),
        as_of=date(2026, 9, 16),
    )
    assert item["document_kind"] == "visa"
    assert item["document_type"] == "Visa / BRP"
    assert item["status"] == "needs_review"
    assert item["expiry_label"] == "Visa expiry"


def test_serialize_rtw_document_without_expiry_needs_review() -> None:
    item = _serialize_identity_document_row(
        _doc_row(title="Share code check", category="rtw", expires_at=None),
        as_of=date(2026, 9, 16),
    )
    assert item["document_kind"] == "rtw_check"
    assert item["status"] == "needs_review"
    assert item["expiry_date"] is None
