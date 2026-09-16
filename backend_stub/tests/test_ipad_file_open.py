"""iPad HR app opens files in-place instead of relying on <a download>."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
FILE_OPEN = FRONTEND / "file-open.js"
QR_SCAN = FRONTEND / "qr-scan.js"
EMPLOYEE_HTML = FRONTEND / "employee.html"
PUNCH_HTML = FRONTEND / "punch.html"
JSQR = FRONTEND / "vendor" / "jsqr.min.js"


def _run_node(script: str) -> None:
    node = subprocess.run(["node", "-v"], capture_output=True, text=True)
    if node.returncode != 0:
        pytest.skip("node is required")
    result = subprocess.run(["node", "-e", script], cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        pytest.fail(result.stderr or result.stdout or "node test failed")


def test_file_open_helper_exists() -> None:
    source = FILE_OPEN.read_text(encoding="utf-8")
    assert "prefersInAppViewer" in source
    assert "deliverBlob" in source
    assert "openInAppViewer" in source
    assert "sshr-file-viewer" in source
    assert "admin-blob-preview" in source


def test_qr_scan_helper_falls_back_to_jsqr() -> None:
    source = QR_SCAN.read_text(encoding="utf-8")
    assert "BarcodeDetector" in source
    assert "./vendor/jsqr.min.js" in source
    assert "decodeImageFile" in source
    assert JSQR.is_file()
    assert "jsQR" in JSQR.read_text(encoding="utf-8")[:80]


def test_employee_and_punch_pages_load_scanner() -> None:
    employee = EMPLOYEE_HTML.read_text(encoding="utf-8")
    punch = PUNCH_HTML.read_text(encoding="utf-8")
    assert 'src="./qr-scan.js?v=1"' in employee
    assert 'src="./employee-time-punch.js?v=12"' in employee
    assert 'id="punch-scan-photo"' in employee
    assert 'src="./qr-scan.js?v=1"' in punch
    assert 'src="./punch.js?v=9"' in punch
    assert 'id="punch-scan-photo"' in punch


def test_file_open_prefers_viewer_on_ipad() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const context = {{ console, URL, URLSearchParams, String, Boolean, JSON, File: class File {{}}, setTimeout() {{}} }};
vm.createContext(context);
vm.runInContext(fs.readFileSync({str(FILE_OPEN)!r}, "utf8"), context);
const open = context.ShiftSwiftFileOpen;
assert.ok(open);
assert.strictEqual(open.isIosLike({{ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }}), true);
assert.strictEqual(open.isIosLike({{ userAgent: "Mozilla/5.0", platform: "MacIntel", maxTouchPoints: 5 }}), true);
assert.strictEqual(open.isIosLike({{ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 0 }}), false);
assert.strictEqual(open.prefersInAppViewer({{ userAgent: "iPad" }}), true);
assert.strictEqual(open.blobKind({{ type: "application/pdf" }}, "rota.pdf"), "pdf");
assert.strictEqual(open.blobKind({{ type: "image/png" }}, "qr.png"), "image");
"""
    _run_node(script)
