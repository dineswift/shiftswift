"""Tests for AI assistant and HR template helpers."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _load_module(name: str, rel_path: str):
    path = ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


ai_client = _load_module("ai_client", "modules/ai/client.py")


def test_configured_provider_requires_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("AI_ENABLED", "1")
    assert ai_client.configured_provider() is None


def test_configured_provider_prefers_gemini(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "1")
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    assert ai_client.configured_provider() == "gemini"


def test_ai_globally_disabled(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "0")
    assert ai_client.ai_globally_enabled() is False


versioning = _load_module("hr_versioning", "modules/hr_templates/versioning.py")
sync_mod = _load_module("hr_sync", "modules/hr_templates/sync.py")


def test_parse_version_semantic():
    assert versioning.parse_version("1.1") == (1, 1)
    assert versioning.parse_version("v2.0.3") == (2, 0, 3)
    assert versioning.version_lt("1.0", "1.1")
    assert versioning.version_gt("1.1", "1.0")


def test_format_download_filename():
    name = versioning.format_download_filename(
        template_id="sponsor_worker_onboarding", version="1.1", variant="platform-latest"
    )
    assert name == "shiftswift-hr-sponsor-worker-onboarding-v1-1-platform-latest.md"


def test_build_download_markdown_includes_version_header():
    body = sync_mod.build_download_markdown(
        title="Test template",
        content_markdown="Hello",
        version="1.1",
        variant="platform",
        legal_basis="Home Office guidance",
        change_summary="Clarified absence types",
        published_at="2026-06-08T12:00:00+00:00",
    )
    assert "Template version:** v1.1" in body
    assert "Platform latest (recommended)" in body
    assert "Clarified absence types" in body
    assert "Hello" in body


def test_build_download_markdown_warns_when_update_available():
    body = sync_mod.build_download_markdown(
        title="Custom",
        content_markdown="Body",
        version="1.0-custom",
        variant="custom",
        legal_basis="",
        change_summary="",
        published_at=None,
        platform_version="1.1",
        based_on_version="1.0",
        update_available=True,
    )
    assert "Platform update available" in body
    assert "v1.1" in body


export_mod = _load_module("hr_export", "modules/hr_templates/export_document.py")


def test_build_template_pdf_bytes_starts_with_pdf_header():
    markdown = "# Test policy\n\n## Section\n\n- Item one\n- Item two\n\nPlain paragraph."
    pdf = export_mod.build_template_pdf_bytes(markdown, title="Test policy")
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 500


def test_build_template_word_bytes_is_docx_document():
    markdown = "# Test policy\n\nHello **world**."
    doc = export_mod.build_template_word_bytes(markdown, title="Test policy")
    assert doc[:2] == b"PK"
    assert len(doc) > 500
