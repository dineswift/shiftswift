"""Tests for platform global document downloads."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.global_documents.service import (
    build_global_document_download,
    list_global_documents,
)


def test_list_global_documents_includes_word_and_csv() -> None:
    items = list_global_documents()
    assert len(items) >= 6
    formats = {item["file_format"] for item in items}
    assert "docx" in formats
    assert "csv" in formats


def test_list_global_documents_filter_category() -> None:
    rota = list_global_documents(category="rota")
    assert rota
    assert all(item["category"] == "rota" for item in rota)


def test_download_weekly_rota_csv() -> None:
    filename, body, media_type = build_global_document_download("weekly_rota_planner")
    assert filename.endswith(".csv")
    assert b"Employee,Role,Mon" in body
    assert "csv" in media_type


def test_download_staff_details_docx() -> None:
    filename, body, media_type = build_global_document_download("staff_details_form")
    assert filename.endswith(".docx")
    assert body[:2] == b"PK"
    assert "wordprocessingml" in media_type
