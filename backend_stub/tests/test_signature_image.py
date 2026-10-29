"""Tests for handwritten PNG signature validation."""

from __future__ import annotations

import base64
import struct
import sys
import zlib
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.document_signing.signature_image import (
    PNG_PREFIX,
    normalize_signature_image,
    signature_image_html,
)
from modules.document_signing.service import _build_acknowledgment_html


def _png_bytes(width: int = 80, height: int = 40) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    rows = []
    for y in range(height):
        row = bytearray(1 + width * 3)
        for x in range(width):
            row[1 + x * 3] = (x * 13 + y) % 256
            row[2 + x * 3] = (y * 7) % 256
            row[3 + x * 3] = 40
        rows.append(bytes(row))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")


def _png_url() -> str:
    return PNG_PREFIX + base64.b64encode(_png_bytes()).decode("ascii")


def test_normalize_signature_image_accepts_png() -> None:
    url = _png_url()
    assert normalize_signature_image(url).startswith(PNG_PREFIX)


def test_normalize_signature_image_rejects_empty() -> None:
    with pytest.raises(ValueError, match="Draw your signature"):
        normalize_signature_image("")


def test_normalize_signature_image_rejects_html() -> None:
    with pytest.raises(ValueError, match="drawn"):
        normalize_signature_image("data:text/html;base64,PHNjcmlwdD4=")


def test_signature_image_html_embeds_png() -> None:
    html = signature_image_html(_png_url())
    assert 'alt="Handwritten signature"' in html
    assert PNG_PREFIX in html
    assert "<script>" not in html


def test_acknowledgment_html_includes_drawing() -> None:
    html = _build_acknowledgment_html(
        doc={
            "title": "Staff handbook",
            "original_filename": "handbook.pdf",
            "content_sha256": "abc123",
        },
        signature_name="Jane Doe",
        reference_code="DOC-SIG-000042",
        ip_address="203.0.113.10",
        signature_image=_png_url(),
    )
    assert "Handwritten signature" in html
    assert PNG_PREFIX in html
    assert "Jane Doe" in html
