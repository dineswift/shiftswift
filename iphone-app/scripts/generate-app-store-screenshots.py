#!/usr/bin/env python3
"""Generate App Store Connect screenshots for ShiftSwift HR (iPhone sizes)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app-store-screenshots"

# App Store Connect iPhone display sizes
SIZES = {
    "6.9": (1320, 2868),  # iPhone 16/17 Pro Max class
    "6.1": (1179, 2556),  # iPhone 16/17 class
}

PINE = (10, 90, 71)
GREEN = (15, 110, 86)
GREEN_MID = (29, 158, 117)
GREEN_SOFT = (214, 235, 224)
GREEN_PALE = (241, 249, 246)
WHITE = (255, 255, 255)
INK = (18, 32, 28)
MUTED = (90, 109, 100)
LINE = (216, 227, 220)
CARD = (255, 255, 255)
AMBER = (217, 145, 42)
RED_SOFT = (239, 138, 138)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def status_bar(draw: ImageDraw.ImageDraw, w: int, dark: bool = False) -> None:
    color = WHITE if dark else INK
    f = font(max(28, w // 28), bold=True)
    draw.text((48, 42), "9:41", font=f, fill=color)
    # signal / battery dots
    bx = w - 56
    for i, r in enumerate((8, 10, 12, 14)):
        draw.ellipse([bx - i * 22 - r, 52 - r // 2, bx - i * 22 + r, 52 + r // 2], fill=color)


def phone_chrome(img: Image.Image, dark_status: bool = False) -> ImageDraw.ImageDraw:
    draw = ImageDraw.Draw(img)
    w, h = img.size
    status_bar(draw, w, dark=dark_status)
    # home indicator
    bar_w = int(w * 0.34)
    x0 = (w - bar_w) // 2
    y0 = h - 34
    draw.rounded_rectangle([x0, y0, x0 + bar_w, y0 + 10], radius=5, fill=(200, 200, 200) if not dark_status else (255, 255, 255, 180))
    return draw


def text_center(draw: ImageDraw.ImageDraw, text: str, y: int, w: int, f: ImageFont.ImageFont, fill) -> None:
    tw = draw.textlength(text, font=f)
    draw.text(((w - tw) / 2, y), text, font=f, fill=fill)


def chooser(size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, GREEN)
    draw = ImageDraw.Draw(img)
    # gradient-ish bands
    for y in range(h):
        t = y / h
        r = int(10 * (1 - t) + 13 * t)
        g = int(90 * (1 - t) + 77 * t)
        b = int(71 * (1 - t) + 61 * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    phone_chrome(img, dark_status=True)
    draw = ImageDraw.Draw(img)

    # logo mark
    mark = 148
    mx = (w - mark) // 2
    my = int(h * 0.22)
    draw.rounded_rectangle([mx, my, mx + mark, my + mark], radius=32, fill=PINE, outline=(93, 202, 165), width=3)
    draw.rounded_rectangle([mx + 30, my + 34, mx + 86, my + 46], radius=6, fill=(93, 202, 165))
    draw.rounded_rectangle([mx + 30, my + 56, mx + 70, my + 68], radius=6, fill=(159, 225, 203))
    draw.rounded_rectangle([mx + 30, my + 78, mx + 78, my + 90], radius=6, fill=(93, 202, 165))
    draw.line([(mx + 30, my + 118), (mx + 118, my + 118)], fill=WHITE, width=6)

    title = font(max(52, w // 16), bold=True)
    lead = font(max(30, w // 28))
    text_center(draw, "ShiftSwift HR", my + mark + 36, w, title, WHITE)
    text_center(draw, "Who is signing in?", my + mark + 110, w, lead, (230, 245, 240))

    # buttons
    bw = int(w * 0.78)
    bx = (w - bw) // 2
    by = int(h * 0.58)
    bh = int(h * 0.09)
    gap = 28
    draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=28, fill=WHITE)
    f1 = font(max(34, w // 24), bold=True)
    f2 = font(max(24, w // 34))
    draw.text((bx + 36, by + bh * 0.22), "I'm an employee", font=f1, fill=PINE)
    draw.text((bx + 36, by + bh * 0.55), "Rota, clock in, leave & payslips", font=f2, fill=GREEN)

    by2 = by + bh + gap
    draw.rounded_rectangle([bx, by2, bx + bw, by2 + bh], radius=28, fill=(255, 255, 255, 40), outline=(255, 255, 255, 90), width=2)
    # simulate translucent card
    draw.rounded_rectangle([bx, by2, bx + bw, by2 + bh], radius=28, fill=(42, 120, 98))
    draw.text((bx + 36, by2 + bh * 0.22), "I'm a business admin", font=f1, fill=WHITE)
    draw.text((bx + 36, by2 + bh * 0.55), "Team, compliance & HR tools", font=f2, fill=(220, 240, 232))
    return img


def admin_overview(size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, GREEN_PALE)
    draw = phone_chrome(img)
    # header
    draw.rectangle([0, 0, w, int(h * 0.16)], fill=GREEN)
    status_bar(draw, w, dark=True)
    ht = font(max(40, w // 20), bold=True)
    draw.text((48, int(h * 0.08)), "Overview", font=ht, fill=WHITE)
    draw.text((48, int(h * 0.115)), "Himalayan Inn", font=font(max(26, w // 32)), fill=(200, 230, 218))

    # metric cards
    cards = [
        ("Active staff", "5", GREEN_MID),
        ("On leave", "1", AMBER),
        ("RTW due", "0", GREEN),
        ("Open tasks", "2", (70, 120, 180)),
    ]
    pad = 36
    cw = (w - pad * 3) // 2
    ch = int(h * 0.12)
    y0 = int(h * 0.19)
    for i, (label, value, accent) in enumerate(cards):
        col = i % 2
        row = i // 2
        x = pad + col * (cw + pad)
        y = y0 + row * (ch + pad)
        draw.rounded_rectangle([x, y, x + cw, y + ch], radius=24, fill=WHITE, outline=LINE, width=2)
        draw.rounded_rectangle([x, y, x + 12, y + ch], radius=6, fill=accent)
        draw.text((x + 28, y + 24), label, font=font(max(24, w // 34)), fill=MUTED)
        draw.text((x + 28, y + ch * 0.42), value, font=font(max(56, w // 14), bold=True), fill=INK)

    # section
    sy = y0 + 2 * (ch + pad) + 10
    draw.text((pad, sy), "Today", font=font(max(34, w // 24), bold=True), fill=INK)
    items = [
        ("Clock-ins", "3 of 5 on site"),
        ("Leave requests", "1 pending approval"),
        ("Documents", "2 awaiting signature"),
    ]
    iy = sy + 56
    for title, sub in items:
        draw.rounded_rectangle([pad, iy, w - pad, iy + int(h * 0.09)], radius=22, fill=WHITE, outline=LINE, width=2)
        draw.text((pad + 28, iy + 22), title, font=font(max(30, w // 26), bold=True), fill=INK)
        draw.text((pad + 28, iy + 62), sub, font=font(max(24, w // 34)), fill=MUTED)
        iy += int(h * 0.09) + 18

    # tab bar
    tabs = ["Home", "Team", "Rota", "More"]
    ty = h - int(h * 0.09)
    draw.rectangle([0, ty, w, h], fill=WHITE)
    draw.line([(0, ty), (w, ty)], fill=LINE, width=2)
    for i, t in enumerate(tabs):
        x = int((i + 0.5) * w / 4)
        color = GREEN if i == 0 else MUTED
        draw.ellipse([x - 10, ty + 22, x + 10, ty + 42], fill=color)
        tw = draw.textlength(t, font=font(22))
        draw.text((x - tw / 2, ty + 52), t, font=font(22), fill=color)
    return img


def employees(size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, GREEN_PALE)
    draw = phone_chrome(img)
    draw.rectangle([0, 0, w, int(h * 0.14)], fill=GREEN)
    status_bar(draw, w, dark=True)
    draw.text((48, int(h * 0.075)), "Employees", font=font(max(40, w // 20), bold=True), fill=WHITE)

    # lifecycle chips
    chips = [("Active", True), ("Onboarding", False), ("Leavers", False)]
    cx = 36
    cy = int(h * 0.16)
    for label, on in chips:
        f = font(max(24, w // 34), bold=True)
        tw = draw.textlength(label, font=f)
        pad_x = 28
        draw.rounded_rectangle([cx, cy, cx + tw + pad_x * 2, cy + 52], radius=26, fill=GREEN if on else WHITE, outline=LINE, width=2)
        draw.text((cx + pad_x, cy + 12), label, font=f, fill=WHITE if on else MUTED)
        cx += int(tw + pad_x * 2 + 16)

    people = [
        ("A. Gurung", "Front of House", "Active"),
        ("S. Sharma", "Kitchen", "Active"),
        ("P. Thapa", "Housekeeping", "Active"),
        ("R. Rai", "Reception", "Active"),
        ("M. Limbu", "Supervisor", "Active"),
    ]
    y = int(h * 0.24)
    for name, role, status in people:
        draw.rounded_rectangle([36, y, w - 36, y + int(h * 0.095)], radius=22, fill=WHITE, outline=LINE, width=2)
        # avatar
        draw.ellipse([56, y + 28, 56 + 70, y + 98], fill=GREEN_SOFT)
        initials = name.split()[0][0] + name.split()[1][0]
        iw = draw.textlength(initials, font=font(28, bold=True))
        draw.text((56 + (70 - iw) / 2, y + 50), initials, font=font(28, bold=True), fill=GREEN)
        draw.text((150, y + 28), name, font=font(max(32, w // 26), bold=True), fill=INK)
        draw.text((150, y + 72), role, font=font(max(24, w // 34)), fill=MUTED)
        sw = draw.textlength(status, font=font(22, bold=True))
        draw.rounded_rectangle([w - 36 - sw - 36, y + 40, w - 52, y + 78], radius=16, fill=GREEN_SOFT)
        draw.text((w - 36 - sw - 18, y + 48), status, font=font(22, bold=True), fill=GREEN)
        y += int(h * 0.095) + 16
    return img


def clock_in(size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, GREEN_PALE)
    draw = phone_chrome(img)
    draw.rectangle([0, 0, w, int(h * 0.14)], fill=GREEN)
    status_bar(draw, w, dark=True)
    draw.text((48, int(h * 0.075)), "Time clock", font=font(max(40, w // 20), bold=True), fill=WHITE)

    # site card
    draw.rounded_rectangle([36, int(h * 0.18), w - 36, int(h * 0.30)], radius=24, fill=WHITE, outline=LINE, width=2)
    draw.text((60, int(h * 0.20)), "Himalayan Inn", font=font(max(34, w // 24), bold=True), fill=INK)
    draw.text((60, int(h * 0.245)), "Within geofence · Ready to clock in", font=font(max(24, w // 34)), fill=GREEN_MID)

    # big clock button
    cx, cy = w // 2, int(h * 0.52)
    r = int(w * 0.22)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    draw.ellipse([cx - r + 18, cy - r + 18, cx + r - 18, cy + r - 18], outline=GREEN_SOFT, width=8)
    text_center(draw, "Clock in", cy - 20, w, font(max(40, w // 18), bold=True), WHITE)
    text_center(draw, "09:41", cy + 36, w, font(max(28, w // 28)), GREEN_SOFT)

    # recent
    draw.text((48, int(h * 0.72)), "Recent punches", font=font(max(30, w // 26), bold=True), fill=INK)
    rows = [("Today 08:02", "In"), ("Yesterday 17:11", "Out")]
    y = int(h * 0.77)
    for when, kind in rows:
        draw.rounded_rectangle([36, y, w - 36, y + 90], radius=18, fill=WHITE, outline=LINE, width=2)
        draw.text((60, y + 28), when, font=font(max(28, w // 28), bold=True), fill=INK)
        draw.text((w - 140, y + 30), kind, font=font(max(28, w // 28), bold=True), fill=GREEN_MID)
        y += 108
    return img


def compliance(size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, GREEN_PALE)
    draw = phone_chrome(img)
    draw.rectangle([0, 0, w, int(h * 0.14)], fill=GREEN)
    status_bar(draw, w, dark=True)
    draw.text((48, int(h * 0.075)), "Compliance", font=font(max(40, w // 20), bold=True), fill=WHITE)

    metrics = [("RTW checks", "5/5", GREEN_MID), ("Expiring 30d", "0", GREEN), ("Day-9 due", "0", GREEN)]
    x = 36
    mw = (w - 36 * 2 - 24) // 3
    y = int(h * 0.18)
    for label, value, color in metrics:
        draw.rounded_rectangle([x, y, x + mw, y + int(h * 0.12)], radius=20, fill=WHITE, outline=LINE, width=2)
        draw.text((x + 18, y + 20), label, font=font(max(20, w // 40)), fill=MUTED)
        draw.text((x + 18, y + 58), value, font=font(max(40, w // 18), bold=True), fill=color)
        x += mw + 12

    draw.text((48, int(h * 0.34)), "Right to work", font=font(max(34, w // 24), bold=True), fill=INK)
    rows = [
        ("A. Gurung", "Valid", GREEN_MID),
        ("S. Sharma", "Valid", GREEN_MID),
        ("P. Thapa", "Valid", GREEN_MID),
        ("R. Rai", "Valid", GREEN_MID),
    ]
    y = int(h * 0.39)
    for name, status, color in rows:
        draw.rounded_rectangle([36, y, w - 36, y + 100], radius=20, fill=WHITE, outline=LINE, width=2)
        draw.text((60, y + 32), name, font=font(max(30, w // 26), bold=True), fill=INK)
        sw = draw.textlength(status, font=font(24, bold=True))
        draw.rounded_rectangle([w - 36 - sw - 40, y + 30, w - 52, y + 70], radius=16, fill=GREEN_SOFT)
        draw.text((w - 36 - sw - 20, y + 38), status, font=font(24, bold=True), fill=color)
        y += 116
    return img


SCREENS = [
    ("01-sign-in", chooser),
    ("02-admin-overview", admin_overview),
    ("03-employees", employees),
    ("04-time-clock", clock_in),
    ("05-compliance", compliance),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size_name, size in SIZES.items():
        folder = OUT / f"iphone-{size_name}"
        folder.mkdir(parents=True, exist_ok=True)
        for slug, builder in SCREENS:
            img = builder(size)
            path = folder / f"{slug}.png"
            img.save(path, "PNG", optimize=True)
            print(f"wrote {path.relative_to(ROOT)}")
    print(f"\nUpload from: {OUT}")
    print("In App Store Connect → Screenshots, use the iphone-6.9 folder first (required).")


if __name__ == "__main__":
    main()
