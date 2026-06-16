"""Tests for premises QR image generation."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.qr import punch_qr_data_uri, punch_qr_png_bytes


def test_punch_qr_png_bytes_is_valid_png() -> None:
    png = punch_qr_png_bytes("https://app.shiftswifthr.co.uk/punch.html?clock=test-token")
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(png) > 200


def test_punch_qr_data_uri_prefix() -> None:
    uri = punch_qr_data_uri("https://example.com/punch?clock=abc")
    assert uri.startswith("data:image/png;base64,")
    assert len(uri) > len("data:image/png;base64,") + 100
