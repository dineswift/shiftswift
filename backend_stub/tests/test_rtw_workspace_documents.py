"""Right to work workspace includes passport, visa/BRP, and RTW employee documents."""

from __future__ import annotations

import sys
from datetime import date, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sponsor_licence_compliance import (  # noqa: E402
    _serialize_identity_document_row,
    apply_rtw_followup_state,
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
        row.get("issued_at"),
        row.get("recorded_at"),
    )


def test_serialize_passport_document() -> None:
    item = _serialize_identity_document_row(_doc_row(), as_of=date(2026, 9, 16))
    assert item["id"] == "doc-10"
    assert item["source"] == "employee_document"
    assert item["document_kind"] == "passport"
    assert item["document_type"] == "Passport / ID"
    assert item["status"] == "verified"
    assert item["expiry_date"] == "2030-01-15"
    assert item["expiry_label"] == "Expiry date"
    assert item["employee_name"] == "Karun Acharya"


def test_serialize_expired_visa_needs_review() -> None:
    item = _serialize_identity_document_row(
        _doc_row(title="BRP", category="visa_brp", expires_at=date(2026, 1, 1)),
        as_of=date(2026, 9, 16),
    )
    assert item["document_kind"] == "visa"
    assert item["document_type"] == "Visa / BRP"
    assert item["status"] == "needs_review"
    assert item["expiry_label"] == "Visa end date"


def test_serialize_rtw_document_without_expiry_needs_review() -> None:
    item = _serialize_identity_document_row(
        _doc_row(title="Share code check", category="rtw", expires_at=None),
        as_of=date(2026, 9, 16),
    )
    assert item["document_kind"] == "rtw_check"
    assert item["status"] == "needs_review"
    assert item["expiry_date"] is None
    assert item["date_label"] == "Date taken"


def test_serialize_passport_issue_and_expiry_dates() -> None:
    item = _serialize_identity_document_row(
        _doc_row(issued_at=date(2020, 5, 1), expires_at=date(2030, 1, 15)),
        as_of=date(2026, 9, 16),
    )
    assert item["check_date"] == "2020-05-01"
    assert item["document_issue_date"] == "2020-05-01"
    assert item["issued_at"] == "2020-05-01"
    assert item["date_label"] == "Issue date"
    assert item["expiry_label"] == "Expiry date"
    assert item["expiry_date"] == "2030-01-15"


def test_serialize_visa_start_and_end_dates() -> None:
    item = _serialize_identity_document_row(
        _doc_row(
            title="Skilled Worker visa",
            category="visa_brp",
            issued_at=date(2025, 4, 6),
            expires_at=date(2028, 4, 5),
        ),
        as_of=date(2026, 9, 16),
    )
    assert item["document_kind"] == "visa"
    assert item["visa_start_date"] == "2025-04-06"
    assert item["check_date"] == "2025-04-06"
    assert item["expiry_date"] == "2028-04-05"
    assert item["date_label"] == "Visa start date"
    assert item["expiry_label"] == "Visa end date"


def test_serialize_rtw_date_taken() -> None:
    item = _serialize_identity_document_row(
        _doc_row(
            title="Share code check",
            category="rtw",
            recorded_at=date(2026, 8, 20),
            expires_at=date(2026, 12, 1),
        ),
        as_of=date(2026, 9, 16),
    )
    assert item["document_kind"] == "rtw_check"
    assert item["recorded_at"] == "2026-08-20"
    assert item["check_date"] == "2026-08-20"
    assert item["date_label"] == "Date taken"
    assert item["expiry_label"] == "RTW expiry date"
    assert item["expiry_date"] == "2026-12-01"


def test_followup_turns_previous_same_document_review_off() -> None:
    older = _serialize_identity_document_row(
        _doc_row(document_id=10, category="rtw", recorded_at=date(2026, 1, 9), expires_at=date(2026, 6, 1)),
        as_of=date(2026, 9, 16),
    )
    newer = _serialize_identity_document_row(
        _doc_row(document_id=11, category="rtw", recorded_at=date(2026, 9, 16), expires_at=date(2027, 1, 1)),
        as_of=date(2026, 9, 16),
    )
    visa = _serialize_identity_document_row(
        _doc_row(document_id=12, category="visa_brp", expires_at=date(2028, 4, 5)),
        as_of=date(2026, 9, 16),
    )
    apply_rtw_followup_state([older, newer, visa])
    assert newer["is_current"] is True
    assert newer["status"] == "verified"
    assert older["superseded"] is True
    assert older["status"] == "superseded"
    assert older["superseded_by_id"] == newer["id"]
    assert visa["superseded"] is False
    assert visa["status"] == "verified"
    assert [version["id"] for version in newer["previous_versions"]] == [older["id"]]
    current = [item for item in (older, newer, visa) if not item.get("superseded")]
    assert {item["id"] for item in current} == {newer["id"], visa["id"]}


def test_followup_does_not_replace_another_employee() -> None:
    first = _serialize_identity_document_row(
        _doc_row(document_id=20, employee_id=1, category="rtw", recorded_at=date(2026, 1, 1)),
        as_of=date(2026, 9, 16),
    )
    second = _serialize_identity_document_row(
        _doc_row(
            document_id=21,
            employee_id=2,
            first_name="Mina",
            last_name="Rai",
            category="rtw",
            recorded_at=date(2026, 9, 1),
        ),
        as_of=date(2026, 9, 16),
    )
    apply_rtw_followup_state([first, second])
    assert first["superseded"] is False
    assert second["superseded"] is False
    assert first["is_current"] is True
    assert second["is_current"] is True
