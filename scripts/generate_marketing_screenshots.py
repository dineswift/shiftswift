#!/usr/bin/env python3
"""Capture high-fidelity marketing screenshots from the product mockup page."""

from __future__ import annotations

import http.server
import shutil
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
OUT_DIR = FRONTEND / "assets" / "screenshots"
MOCK_PATH = "/assets/screenshots/mockups.html"
PORT = 8766

SCREENS = (
    "overview",
    "employees",
    "time-clock",
    "rota",
    "compliance",
)

FILENAME = {
    "overview": "admin-overview",
    "employees": "employees",
    "time-clock": "time-clock",
    "rota": "rota",
    "compliance": "compliance",
}


def chrome_bin() -> str:
    for candidate in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(candidate)
        if path:
            return path
    raise SystemExit("Chrome/Chromium is required to render marketing screenshots.")


def serve() -> http.server.HTTPServer:
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(FRONTEND), **kwargs
    )
    server = http.server.HTTPServer(("127.0.0.1", PORT), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def capture(chrome: str, screen: str, png_path: Path) -> None:
    url = f"http://127.0.0.1:{PORT}{MOCK_PATH}?screen={screen}"
    profile = Path("/tmp/sshr-chrome-screenshots") / screen
    if profile.exists():
        shutil.rmtree(profile, ignore_errors=True)
    profile.mkdir(parents=True, exist_ok=True)
    if png_path.exists():
        png_path.unlink()
    cmd = [
        chrome,
        "--headless=old",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--remote-debugging-port=0",
        f"--user-data-dir={profile}",
        "--force-device-scale-factor=1",
        "--window-size=1440,900",
        f"--screenshot={png_path}",
        url,
    ]
    proc = subprocess.Popen(cmd, cwd=str(FRONTEND), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 20
    while time.time() < deadline:
        if png_path.exists() and png_path.stat().st_size > 20_000:
            time.sleep(0.4)
            break
        time.sleep(0.15)
    proc.kill()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.terminate()
    if not png_path.exists() or png_path.stat().st_size < 20_000:
        raise SystemExit(f"Screenshot failed for {screen}: {png_path}")


def to_webp(png_path: Path, webp_path: Path) -> None:
    import sys
    user_site = str(Path.home() / ".local/lib/python3.12/site-packages")
    if user_site not in sys.path:
        sys.path.append(user_site)
    from PIL import Image

    image = Image.open(png_path).convert("RGB")
    image.save(webp_path, "WEBP", quality=88, method=6)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    chrome = chrome_bin()
    server = serve()
    time.sleep(0.3)
    try:
        for screen in SCREENS:
            slug = FILENAME[screen]
            png_path = OUT_DIR / f"{slug}.png"
            webp_path = OUT_DIR / f"{slug}.webp"
            capture(chrome, screen, png_path)
            to_webp(png_path, webp_path)
            print(f"wrote {png_path.name}, {webp_path.name}")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
