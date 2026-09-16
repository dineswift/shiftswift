"""Passport, BRP, visa and RTW employee documents appear in the RTW workspace."""

from __future__ import annotations

import sys
from datetime import date, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sponsor_licence_compliance import (
    identity_document_kind,
    identity_document_type_label,
    parse_rtw_record_id,
    _serialize_identity_document_row,
)


def test_identity_document_kind_maps_saved_categories() -> None:
    assert identity_document_kind("id") == "passport"
    assert identity_document_kind("passport") == "passport"
    assert identity_document_kind("identity") == "passport"
    assert identity_document_kind("visa_brp") == "visa"
    assert identity_document_kind("visa") == "visa"
    assert identity_document_kind("rtw") == "rtw_check"
    assert identity_document_kind("right_to_work") == "rtw_check"
    assert identity_document_kind("contract") is None


def test_identity_document_type_labels() -> None:
    assert identity_document_type_label("id") == "Passport / ID"
    assert identity_document_type_label("visa_brp") == "Visa / BRP"
    assert identity_document_type_label("rtw") == "Right to work check"


def test_parse_rtw_record_id_accepts_prefixed_and_numeric() -> None:
    assert parse_rtw_record_id(12) == ("check", 12)
    assert parse_rtw_record_id("12") == ("check", 12)
    assert parse_rtw_record_id("check-12") == ("check", 12)
    assert parse_rtw_record_id("doc-44") == ("document", 44)


def test_serialize_identity_passport_row() -> None:
    row = (
        44,
        9,
        "UK passport",
        "id",
        "passport.jpg",
        "/files/passport.jpg",
        "abc123",
        "image/jpeg",
        date(2028, 1, 15),
        datetime(2026, 3, 4, 12, 0, 0),
        "hr.admin",
        "Ada",
        "Khan",
        "Chef",
        "Kitchen",
        "ada@example.com",
        False,
        date(2027, 4, 1),
        date(2026, 10, 15),
    )
    item = _serialize_identity_document_row(row, as_of=date(2026, 9, 16))
    assert item["id"] == "doc-44"
    assert item["source"] == "employee_document"
    assert item["document_kind"] == "passport"
    assert item["document_type"] == "Passport / ID"
    assert item["document_title"] == "UK passport"
    assert item["document_expiry_date"] == "2028-01-15"
    assert item["visa_expiry_date"] == "2027-04-01"
    assert item["download_path"] == "/compliance/sponsor-licence/rtw-checks/doc-44/file"
    assert item["immutable_locked"] is False
    assert item["status"] == "verified"


if __name__ == "__main__":
    test_identity_document_kind_maps_saved_categories()
    test_identity_document_type_labels()
    test_parse_rtw_record_id_accepts_prefixed_and_numeric()
    test_serialize_identity_passport_row()
    print("ok")
