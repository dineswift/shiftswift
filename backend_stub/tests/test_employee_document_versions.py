"""Employee document updates keep distinct earlier files and hide identical copies."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.documents.service import apply_employee_document_versions, employee_document_version_key  # noqa: E402


def test_version_key_groups_identity_kinds() -> None:
    assert employee_document_version_key({"category": "passport"}) == "id"
    assert employee_document_version_key({"category": "visa_brp"}) == "visa"
    assert employee_document_version_key({"category": "rtw"}) == "rtw"
    assert employee_document_version_key({"category": "dbs"}) == "dbs"
    assert employee_document_version_key({"category": "contract"}) == "contract"


def test_newer_contract_keeps_previous_file() -> None:
    older = {"id": 1, "category": "contract", "title": "Contract", "created_at": "2026-01-01", "content_sha256": "aaa"}
    newer = {"id": 2, "category": "contract", "title": "Contract", "created_at": "2026-09-16", "content_sha256": "bbb"}
    apply_employee_document_versions([older, newer])
    assert newer["is_current"] is True
    assert older["superseded"] is True
    assert older["superseded_by_id"] == 2
    assert [item["id"] for item in newer["previous_versions"]] == [1]


def test_same_file_hash_is_not_kept_twice() -> None:
    older = {"id": 3, "category": "id", "title": "Passport", "created_at": "2026-01-01", "content_sha256": "same"}
    clone = {"id": 4, "category": "id", "title": "Passport", "created_at": "2026-09-16", "content_sha256": "same"}
    apply_employee_document_versions([older, clone])
    assert clone["is_current"] is True
    assert older["duplicate_file"] is True
    assert clone["previous_versions"] == []


def test_different_training_titles_stay_current() -> None:
    food = {"id": 5, "category": "training", "title": "Food hygiene", "created_at": "2026-01-01", "content_sha256": "a"}
    first_aid = {"id": 6, "category": "training", "title": "First aid", "created_at": "2026-02-01", "content_sha256": "b"}
    apply_employee_document_versions([food, first_aid])
    assert food["superseded"] is False
    assert first_aid["superseded"] is False
    assert food["is_current"] is True
    assert first_aid["is_current"] is True
