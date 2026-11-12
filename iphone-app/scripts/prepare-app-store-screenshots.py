#!/usr/bin/env python3
"""Prepare App Store Connect screenshot sets from source PNGs (iPhone + iPad).

Drop your captures in app-store-screenshots/source/ (any *.png, sorted by name).
Falls back to iphone-6.9/ and raw/ when source/ is empty.

Outputs app-store-screenshots/upload/ ready for App Store Connect.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Install Pillow: pip3 install Pillow") from exc

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "app-store-screenshots"
SOURCE = SHOTS / "source"
UPLOAD = SHOTS / "upload"
REPO = ROOT.parent

ICON_CANDIDATES = [
    ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png",
    REPO / "mobile" / "assets" / "icon.png",
    REPO / "frontend" / "assets" / "shiftswift-hr-app-icon.png",
]

APP_ICON_SIZE = 1024

# App Store Connect portrait sizes (width x height)
IPHONE_SIZES = {
    "iphone-6.9": (1320, 2868),
    "iphone-6.7": (1290, 2796),
    "iphone-6.5": (1284, 2778),   # App Store Connect "6.5-inch display" (also accepts 1242×2688)
    "iphone-6.5-xsmax": (1242, 2688),
    "iphone-6.1": (1179, 2556),
}

IPAD_SIZES = {
    "ipad-13": (2064, 2752),
    "ipad-12.9": (2048, 2732),
    "ipad-11": (1668, 2388),
}

PINE = (10, 90, 71)
GREEN = (15, 110, 86)
GREEN_MID = (29, 158, 117)
GREEN_PALE = (241, 249, 246)
WHITE = (255, 255, 255)
INK = (18, 32, 28)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def collect_sources() -> list[Path]:
    if SOURCE.is_dir():
        found = sorted(SOURCE.glob("*.png"))
        if found:
            return found

    merged: list[Path] = []
    for folder in (SHOTS / "iphone-6.9", SHOTS / "iphone-6.1", SHOTS / "raw"):
        if folder.is_dir():
            merged.extend(sorted(folder.glob("*.png")))
    # de-dupe by stem, keep first (prefer 6.9 mockups over raw)
    seen: set[str] = set()
    out: list[Path] = []
    for path in merged:
        stem = path.stem
        if stem in seen:
            continue
        seen.add(stem)
        out.append(path)
    return sorted(out, key=lambda p: p.name)


def resize_cover(img: Image.Image, target: tuple[int, int]) -> Image.Image:
    tw, th = target
    sw, sh = img.size
    scale = max(tw / sw, th / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def resize_contain(img: Image.Image, target: tuple[int, int], bg: tuple[int, int, int] = GREEN_PALE) -> Image.Image:
    tw, th = target
    canvas = Image.new("RGB", target, bg)
    sw, sh = img.size
    scale = min(tw / sw, th / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (tw - nw) // 2
    y = (th - nh) // 2
    canvas.paste(resized, (x, y))
    return canvas


def bg_from_edges(img: Image.Image) -> tuple[int, int, int]:
    rgb = img.convert("RGB")
    w, h = rgb.size
    points = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2), (w // 2, 1), (w // 2, h - 2)]
    rs = gs = bs = 0
    for x, y in points:
        r, g, b = rgb.getpixel((x, y))
        rs += r
        gs += g
        bs += b
    n = len(points)
    return (rs // n, gs // n, bs // n)


def fit_phone_screenshot(img: Image.Image, target: tuple[int, int]) -> Image.Image:
    """Scale UI capture to App Store iPhone size without cropping content."""
    return resize_contain(img, target, bg=bg_from_edges(img))


def ipad_frame(phone: Image.Image, canvas_size: tuple[int, int], title: str = "ShiftSwift HR") -> Image.Image:
    cw, ch = canvas_size
    img = Image.new("RGB", canvas_size, GREEN_PALE)
    draw = ImageDraw.Draw(img)

    # soft brand header band
    for y in range(int(ch * 0.22)):
        t = y / max(1, int(ch * 0.22))
        r = int(GREEN_PALE[0] * (1 - t) + GREEN[0] * t * 0.15)
        g = int(GREEN_PALE[1] * (1 - t) + GREEN[1] * t * 0.15)
        b = int(GREEN_PALE[2] * (1 - t) + GREEN[2] * t * 0.15)
        draw.line([(0, y), (cw, y)], fill=(r, g, b))

    title_f = font(max(42, cw // 22), bold=True)
    sub_f = font(max(24, cw // 36))
    tw = draw.textlength(title, font=title_f)
    draw.text(((cw - tw) / 2, int(ch * 0.05)), title, font=title_f, fill=PINE)
    subtitle = "HR admin · Employee portal · Compliance"
    sw = draw.textlength(subtitle, font=sub_f)
    draw.text(((cw - sw) / 2, int(ch * 0.05) + 52), subtitle, font=sub_f, fill=(90, 109, 100))

    # phone card — fit screenshot inside rounded rect
    max_w = int(cw * 0.42)
    max_h = int(ch * 0.72)
    sw, sh = phone.size
    scale = min(max_w / sw, max_h / sh)
    pw, ph = int(sw * scale), int(sh * scale)
    framed = phone.resize((pw, ph), Image.Resampling.LANCZOS)

    px = (cw - pw) // 2
    py = int(ch * 0.17) + (max_h - ph) // 2
    radius = max(28, pw // 18)
    shadow = 10
    draw.rounded_rectangle(
        [px - shadow, py - shadow, px + pw + shadow, py + ph + shadow],
        radius=radius + 4,
        fill=(210, 220, 215),
    )
    draw.rounded_rectangle([px - 4, py - 4, px + pw + 4, py + ph + 4], radius=radius + 2, fill=WHITE)
    mask = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw, ph], radius=radius, fill=255)
    img.paste(framed, (px, py), mask)
    return img


def slug_for(idx: int, src: Path) -> str:
    base = re.sub(r"^\d+-", "", src.stem)
    return f"{idx:02d}-{base}"


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def find_icon_source() -> Path:
    for path in ICON_CANDIDATES:
        if path.is_file():
            return path
    raise SystemExit(
        "No app icon found. Run: npm run brand:ios  (or add shiftswift-hr-app-icon.png under frontend/assets/)"
    )


def icon_background_color(img: Image.Image) -> tuple[int, int, int]:
    """Sample solid brand fill from the icon (avoids halos when flattening alpha)."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    points = [(w // 2, h // 4), (w // 4, h // 2), (3 * w // 4, h // 2), (w // 2, 3 * h // 4)]
    for x, y in points:
        r, g, b, a = rgba.getpixel((x, y))
        if a > 200:
            return (r, g, b)
    return GREEN


def prepare_app_connect_icon(
    *,
    dest: Path | None = None,
    also_write_xcassets: bool = False,
) -> Path:
    """1024×1024 RGB PNG for App Store Connect (no transparency, square corners)."""
    src = find_icon_source()
    rgba = Image.open(src).convert("RGBA")
    if rgba.size != (APP_ICON_SIZE, APP_ICON_SIZE):
        rgba = rgba.resize((APP_ICON_SIZE, APP_ICON_SIZE), Image.Resampling.LANCZOS)

    bg = icon_background_color(rgba)
    flat = Image.new("RGB", (APP_ICON_SIZE, APP_ICON_SIZE), bg)
    flat.paste(rgba, (0, 0), rgba)

    out = dest or (UPLOAD / "app-icon-1024.png")
    write_png(out, flat)

    if also_write_xcassets:
        xcassets = ICON_CANDIDATES[0]
        write_png(xcassets, flat)

    return out


def main() -> None:
    sources = collect_sources()
    if not sources:
        raise SystemExit(
            f"No PNGs found. Add screenshots to {SOURCE}/ (e.g. 01-sign-in.png, 02-admin.png …)"
        )

    if UPLOAD.exists():
        shutil.rmtree(UPLOAD)
    UPLOAD.mkdir(parents=True)

    manifest: dict[str, object] = {
        "app": "ShiftSwift HR",
        "bundle_id": "co.uk.shiftswifthr.app",
        "source_files": [p.name for p in sources],
        "iphone_sets": {},
        "ipad_sets": {},
        "app_store_connect": {
            "app_icon": "upload/app-icon-1024.png (1024×1024, no transparency)",
            "iphone_required": "Upload iphone-6.5/ (1284×2778) or iphone-6.9/ for 6.9-inch display",
            "ipad_required": "Upload ipad-13 or ipad-12.9 (iPad supports iPhone + iPad)",
            "transporter": "Use Transporter app or Xcode → Organizer → Distribute App",
            "ipa": "ios/build/export/App.ipa (run: bash scripts/archive-for-app-store.sh)",
        },
    }

    print(f"Using {len(sources)} source screenshot(s):")
    for src in sources:
        print(f"  - {src.relative_to(ROOT)}")

    # iPhone exports
    for size_name, size in IPHONE_SIZES.items():
        folder = UPLOAD / size_name
        names: list[str] = []
        for idx, src in enumerate(sources, start=1):
            img = Image.open(src).convert("RGB")
            out_img = fit_phone_screenshot(img, size)
            slug = slug_for(idx, src)
            out_path = folder / f"{slug}.png"
            write_png(out_path, out_img)
            names.append(out_path.name)
            print(f"wrote {out_path.relative_to(ROOT)}")
        manifest["iphone_sets"][size_name] = {"size": list(size), "files": names}

    # iPad exports (framed phone UI on iPad canvas)
    for size_name, size in IPAD_SIZES.items():
        folder = UPLOAD / size_name
        names: list[str] = []
        for idx, src in enumerate(sources, start=1):
            phone_base = fit_phone_screenshot(Image.open(src).convert("RGB"), IPHONE_SIZES["iphone-6.9"])
            out_img = ipad_frame(phone_base, size)
            slug = slug_for(idx, src)
            out_path = folder / f"{slug}.png"
            write_png(out_path, out_img)
            names.append(out_path.name)
            print(f"wrote {out_path.relative_to(ROOT)}")
        manifest["ipad_sets"][size_name] = {"size": list(size), "files": names}

    manifest_path = UPLOAD / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {manifest_path.relative_to(ROOT)}")

    icon_path = prepare_app_connect_icon(also_write_xcassets=True)
    manifest["app_icon"] = {
        "file": icon_path.name,
        "size": [APP_ICON_SIZE, APP_ICON_SIZE],
        "source": find_icon_source().relative_to(REPO).as_posix(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {icon_path.relative_to(ROOT)} (App Store Connect app icon)")

    print(f"\nUpload folder: {UPLOAD}")
    print("App Store Connect → App → iOS App:")
    print("  • App Icon: upload/app-icon-1024.png")
    print("  • Screenshots → iPhone 6.5\": drag files from upload/iphone-6.5/")
    print("  • Screenshots → iPhone 6.9\": upload/iphone-6.9/ (if required)")
    print("  • Screenshots → iPad:   drag files from upload/ipad-13/ (or ipad-12.9)")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--icon-only",
        action="store_true",
        help="Only generate App Store Connect app icon (1024×1024, no alpha)",
    )
    args = parser.parse_args()
    if args.icon_only:
        path = prepare_app_connect_icon(also_write_xcassets=True)
        print(f"wrote {path.relative_to(ROOT)}")
    else:
        main()
