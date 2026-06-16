"""Generate premises clock-in QR images without third-party services."""

from __future__ import annotations

import base64
import io

import qrcode
from qrcode.constants import ERROR_CORRECT_M


def punch_qr_png_bytes(content: str, *, box_size: int = 8, border: int = 2) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(content)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def punch_qr_data_uri(content: str, *, box_size: int = 8, border: int = 2) -> str:
    encoded = base64.standard_b64encode(punch_qr_png_bytes(content, box_size=box_size, border=border)).decode(
        "ascii"
    )
    return f"data:image/png;base64,{encoded}"
