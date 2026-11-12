"""Validate a handwritten PNG signature drawn on the signing page."""

from __future__ import annotations

import base64
import binascii

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_PREFIX = "data:image/png;base64,"
MAX_SIGNATURE_IMAGE_BYTES = 180_000
MIN_SIGNATURE_IMAGE_BYTES = 200


def normalize_signature_image(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Draw your signature before signing")
    if not raw.startswith(PNG_PREFIX):
        raise ValueError("Signature must be drawn on the signature pad")
    try:
        decoded = base64.b64decode(raw[len(PNG_PREFIX) :], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Signature drawing is invalid") from exc
    if len(decoded) < MIN_SIGNATURE_IMAGE_BYTES:
        raise ValueError("Draw a clearer signature before signing")
    if len(decoded) > MAX_SIGNATURE_IMAGE_BYTES:
        raise ValueError("Signature drawing is too large — clear and sign again")
    if not decoded.startswith(PNG_MAGIC):
        raise ValueError("Signature must be drawn on the signature pad")
    return PNG_PREFIX + base64.b64encode(decoded).decode("ascii")


def signature_image_html(data_url: str) -> str:
    safe = normalize_signature_image(data_url)
    return (
        '<p><strong>Handwritten signature:</strong></p>'
        f'<img alt="Handwritten signature" src="{safe}" '
        'width="280" style="max-width:280px;height:auto;border:1px solid #d1d5db;'
        'background:#fff;padding:8px;border-radius:8px;" />'
    )
