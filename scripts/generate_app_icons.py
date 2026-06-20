#!/usr/bin/env python3
"""Generate ShiftSwift PWA app icons — large centred mark, readable on home screens."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend" / "assets"

GREEN = "#0F6E56"
GREEN_LIGHT = "#5DCAA5"
GREEN_SOFT = "#9FE1CB"
INK = "#111111"
WHITE = "#FFFFFF"


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _draw_mark(draw: ImageDraw.ImageDraw, cx: int, top: int, scale: float = 1.0) -> None:
    size = int(96 * scale)
    left = cx - size // 2
    radius = int(20 * scale)
    draw.rounded_rectangle(
        (left, top, left + size, top + size),
        radius=radius,
        fill=GREEN,
    )
    bar_h = max(4, int(7 * scale))
    bar_rx = bar_h // 2
    bars = [
        (left + int(16 * scale), top + int(16 * scale), int(36 * scale), GREEN_LIGHT),
        (left + int(16 * scale), top + int(29 * scale), int(26 * scale), GREEN_SOFT),
        (left + int(16 * scale), top + int(42 * scale), int(32 * scale), GREEN_LIGHT),
    ]
    for x_off, y_off, width, color in bars:
        draw.rounded_rectangle(
            (x_off, y_off, x_off + width, y_off + bar_h),
            radius=bar_rx,
            fill=color,
        )
    y_line = top + int(65 * scale)
    x1 = left + int(16 * scale)
    x2 = left + int(80 * scale)
    sw = max(3, int(4 * scale))
    draw.line((x1, y_line, x2, y_line), fill=WHITE, width=sw)
    ax = left + int(63 * scale)
    ay = top + int(55 * scale)
    draw.line((ax, ay, x2, y_line), fill=WHITE, width=sw)
    draw.line((ax, top + int(75 * scale), x2, y_line), fill=WHITE, width=sw)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def render_mark_only(*, maskable: bool, size: int) -> Image.Image:
    """Home-screen icon: green tile with a large centred mark (no tiny wordmark)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = int(size * 0.08) if maskable else 0
    inner = size - 2 * pad
    radius = max(8, int(inner * 0.22))

    draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=radius, fill=GREEN)

    mark_target = inner * (0.76 if maskable else 0.88)
    mark_scale = mark_target / 96.0
    mark_height = int(96 * mark_scale)
    cx = size // 2
    mark_top = pad + (inner - mark_height) // 2
    _draw_mark(draw, cx, mark_top, scale=mark_scale)
    return img


def render_wordmark_icon(*, bottom_label: str, maskable: bool, size: int) -> Image.Image:
    """Marketing / store listing icon with ShiftSwift wordmark (not used for PWA home screen)."""
    img = Image.new("RGBA", (size, size), WHITE)
    draw = ImageDraw.Draw(img)

    pad = int(size * (0.10 if maskable else 0.04))
    draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=int(size * 0.18), fill=WHITE)

    inner_top = pad
    inner_bottom = size - pad
    inner_height = inner_bottom - inner_top
    cx = size // 2

    mark_scale = (0.92 if maskable else 1.35) * (size / 512)
    mark_height = int(96 * mark_scale)

    word_size = int(size * 0.09)
    label_size = int(size * (0.05 if bottom_label == "HR" else 0.042))
    word_font = _font(word_size)
    label_font = _font(label_size)

    word_box = draw.textbbox((0, 0), "ShiftSwift", font=word_font)
    word_h = word_box[3] - word_box[1]
    label_box = draw.textbbox((0, 0), bottom_label, font=label_font)
    label_h = label_box[3] - label_box[1]

    gap_after_mark = int(size * 0.022)
    gap_after_word = int(size * 0.035)
    content_height = mark_height + gap_after_mark + word_h + gap_after_word + label_h
    block_top = inner_top + max(0, (inner_height - content_height) // 2)

    mark_top = block_top
    _draw_mark(draw, cx, mark_top, scale=mark_scale)
    mark_bottom = mark_top + mark_height

    shift = "Shift"
    swift = "Swift"
    shift_w = _text_width(draw, shift, word_font)
    swift_w = _text_width(draw, swift, word_font)
    total_w = shift_w + swift_w
    word_y = mark_bottom + gap_after_mark
    x = cx - total_w // 2
    draw.text((x, word_y), shift, fill=INK, font=word_font)
    draw.text((x + shift_w, word_y), swift, fill=GREEN, font=word_font)

    word_bottom = draw.textbbox((x, word_y), shift + swift, font=word_font)[3]
    label_y = word_bottom + gap_after_word
    label_w = _text_width(draw, bottom_label, label_font)
    draw.text((cx - label_w // 2, label_y), bottom_label, fill=GREEN, font=label_font)

    return img


def render_splash(*, label: str, width: int, height: int) -> Image.Image:
    """iOS PWA launch splash — green field, centred mark, short app label."""
    img = Image.new("RGB", (width, height), GREEN)
    draw = ImageDraw.Draw(img)

    icon_size = int(min(width, height) * 0.22)
    mark_scale = icon_size / 96.0
    mark_height = int(96 * mark_scale)
    cx = width // 2
    mark_top = int(height * 0.36) - mark_height // 2
    _draw_mark(draw, cx, mark_top, scale=mark_scale)

    title_font = _font(int(height * 0.028))
    subtitle_font = _font(int(height * 0.018), bold=False)
    title = "ShiftSwift"
    subtitle = label
    title_box = draw.textbbox((0, 0), title, font=title_font)
    subtitle_box = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    title_w = title_box[2] - title_box[0]
    subtitle_w = subtitle_box[2] - subtitle_box[0]
    text_top = mark_top + mark_height + int(height * 0.04)
    draw.text((cx - title_w // 2, text_top), title, fill=WHITE, font=title_font)
    draw.text((cx - subtitle_w // 2, text_top + int(height * 0.035)), subtitle, fill=GREEN_SOFT, font=subtitle_font)
    return img


SPLASH_SIZES = [
    (1290, 2796),
    (1179, 2556),
    (1170, 2532),
    (828, 1792),
    (750, 1334),
]


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    mark_variants = [
        ("app-icon-hr", False),
        ("app-icon-hr-maskable", True),
        ("app-icon-clock", False),
        ("app-icon-employee", False),
    ]
    for base, maskable in mark_variants:
        for size in (180, 192, 512):
            out = ASSETS / f"{base}-{size}.png"
            render_mark_only(maskable=maskable, size=size).save(out, "PNG")
            print(f"wrote {out.relative_to(ROOT)}")

    for label, slug in (("Employee", "employee"), ("HR Admin", "hr")):
        for width, height in SPLASH_SIZES:
            out = ASSETS / f"shiftswift-{slug}-splash-{width}x{height}.png"
            render_splash(label=label, width=width, height=height).save(out, "PNG")
            print(f"wrote {out.relative_to(ROOT)}")

    aliases = {
        "app-icon-hr-512.png": "shiftswift-hr-app-icon.png",
        "app-icon-hr-maskable-512.png": "shiftswift-hr-app-icon-maskable.png",
        "app-icon-hr-192.png": "shiftswift-hr-app-icon-192.png",
        "app-icon-hr-180.png": "shiftswift-hr-app-icon-180.png",
        "app-icon-clock-512.png": "shiftswift-clock-app-icon.png",
        "app-icon-clock-192.png": "shiftswift-clock-app-icon-192.png",
        "app-icon-clock-180.png": "shiftswift-clock-app-icon-180.png",
        "app-icon-employee-512.png": "shiftswift-employee-app-icon.png",
        "app-icon-employee-192.png": "shiftswift-employee-app-icon-192.png",
        "app-icon-employee-180.png": "shiftswift-employee-app-icon-180.png",
    }
    for src, dest in aliases.items():
        target = ASSETS / dest
        target.write_bytes((ASSETS / src).read_bytes())
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
