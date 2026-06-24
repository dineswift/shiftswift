#!/usr/bin/env python3
"""Rasterise marketing screenshot placeholders for reliable mobile <img> display."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "frontend" / "assets" / "screenshots"

W, H = 1200, 750
PINE = (15, 46, 34)
GREEN = (29, 158, 117)
GREEN_SOFT = (241, 249, 246)
BG_TOP = (244, 248, 244)
BG_BOTTOM = (232, 242, 234)
BORDER = (216, 227, 220)
MUTED = (90, 109, 100)
MUTED_LIGHT = (122, 143, 132)
SAGE = (234, 243, 222)
WHITE = (255, 255, 255)
DOT_RED = (239, 138, 138)
DOT_YELLOW = (232, 196, 104)
DOT_GREEN = (123, 198, 126)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def chrome(draw: ImageDraw.ImageDraw, title: str) -> None:
    for y in range(H):
        t = y / max(H - 1, 1)
        c = tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)
    draw.rounded_rectangle([48, 48, W - 48, H - 48], radius=20, fill=WHITE, outline=BORDER, width=2)
    draw.rounded_rectangle([48, 48, W - 48, 100], radius=20, fill=PINE)
    draw.rectangle([48, 76, W - 48, 100], fill=PINE)
    for cx, color in ((84, DOT_RED), (108, DOT_YELLOW), (132, DOT_GREEN)):
        draw.ellipse([cx - 8, 66, cx + 8, 82], fill=color)
    font = load_font(18, bold=True)
    tw = draw.textlength(title, font=font)
    draw.text(((W - tw) / 2, 62), title, font=font, fill=SAGE)


def footer(draw: ImageDraw.ImageDraw, headline: str, hint: str) -> None:
    hfont = load_font(22, bold=True)
    sfont = load_font(16)
    hw = draw.textlength(headline, font=hfont)
    sw = draw.textlength(hint, font=sfont)
    draw.text(((W - hw) / 2, 400), headline, font=hfont, fill=MUTED)
    draw.text(((W - sw) / 2, 432), hint, font=sfont, fill=MUTED_LIGHT)


def admin_overview() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(img)
    chrome(draw, "ShiftSwift HR · Admin overview")
    draw.rounded_rectangle([88, 132, 288, 652], radius=12, fill=GREEN_SOFT, outline=BORDER)
    draw.rounded_rectangle([320, 132, 1112, 252], radius=12, fill=GREEN_SOFT, outline=BORDER)
    draw.rounded_rectangle([340, 160, 480, 176], radius=4, fill=BORDER)
    draw.rounded_rectangle([340, 190, 560, 226], radius=8, fill=(29, 158, 117, 46) if False else (214, 235, 224))
    for x in (320, 590, 860):
        draw.rounded_rectangle([x, 276, x + 250, 436], radius=12, fill=WHITE, outline=BORDER)
    draw.rounded_rectangle([320, 460, 1112, 652], radius=12, fill=WHITE, outline=BORDER)
    footer(draw, "Admin overview", "Illustrative placeholder")
    return img


def time_clock() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(img)
    chrome(draw, "ShiftSwift HR · Time Clock")
    draw.rounded_rectangle([120, 140, 1080, 212], radius=12, fill=GREEN_SOFT, outline=BORDER)
    draw.rounded_rectangle([120, 240, 580, 620], radius=12, fill=WHITE, outline=BORDER)
    draw.rounded_rectangle([620, 240, 1080, 420], radius=12, fill=WHITE, outline=BORDER)
    draw.rounded_rectangle([620, 440, 1080, 620], radius=12, fill=(214, 235, 224), outline=GREEN, width=2)
    draw.ellipse([278, 358, 422, 502], outline=GREEN, width=10)
    footer(draw, "Geofenced clock + hours export", "Illustrative placeholder")
    return img


def compliance() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(img)
    chrome(draw, "ShiftSwift HR · Sponsor compliance")
    draw.rounded_rectangle([120, 140, 400, 188], radius=10, fill=(214, 235, 224))
    draw.rounded_rectangle([120, 210, 1080, 620], radius=12, fill=WHITE, outline=BORDER)
    draw.rounded_rectangle([150, 250, 470, 264], radius=4, fill=BORDER)
    for y in (290, 320, 350):
        draw.rounded_rectangle([150, y, 1030, y + 12], radius=4, fill=(232, 240, 235))
    draw.rounded_rectangle([150, 400, 350, 436], radius=8, fill=(15, 46, 34))
    footer(draw, "RTW · day-9 · audit export", "Illustrative placeholder")
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    specs = [
        ("admin-overview", admin_overview),
        ("time-clock", time_clock),
        ("compliance", compliance),
    ]
    for slug, builder in specs:
        image = builder()
        png_path = OUT_DIR / f"{slug}.png"
        webp_path = OUT_DIR / f"{slug}.webp"
        image.save(png_path, "PNG", optimize=True)
        image.save(webp_path, "WEBP", quality=88, method=6)
        print(f"wrote {png_path.name}, {webp_path.name}")


if __name__ == "__main__":
    main()
