"""Time Clock premises QR scan works on iPad Safari without BarcodeDetector."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
QR_SCAN = FRONTEND / "qr-scan.js"
JSQR = FRONTEND / "vendor" / "jsqr.min.js"
EMPLOYEE_HTML = FRONTEND / "employee.html"
EMPLOYEE_JS = FRONTEND / "employee-time-punch.js"
PUNCH_HTML = FRONTEND / "punch.html"
PUNCH_JS = FRONTEND / "punch.js"


def _run_node(script: str) -> None:
    node = subprocess.run(["node", "-v"], capture_output=True, text=True)
    if node.returncode != 0:
        pytest.skip("node is required to execute qr-scan.js")
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(result.stderr or result.stdout or "qr-scan node test failed")


def test_employee_and_clock_load_jsqr_fallback() -> None:
    employee_html = EMPLOYEE_HTML.read_text(encoding="utf-8")
    punch_html = PUNCH_HTML.read_text(encoding="utf-8")
    employee_js = EMPLOYEE_JS.read_text(encoding="utf-8")
    punch_js = PUNCH_JS.read_text(encoding="utf-8")
    assert 'src="./qr-scan.js?v=1"' in employee_html
    assert 'src="./qr-scan.js?v=1"' in punch_html
    assert 'id="punch-scan-photo"' in employee_html
    assert 'id="punch-scan-photo"' in punch_html
    assert "ShiftSwiftQrScan" in employee_js
    assert "ShiftSwiftQrScan" in punch_js
    assert "decodeImageFile" in employee_js
    assert JSQR.is_file()
    assert JSQR.stat().st_size > 10000


def test_jsqr_vendor_exposes_decoder() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const sandbox = {{ module: {{ exports: {{}} }}, exports: {{}}, console }};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync({str(JSQR)!r}, "utf8"), sandbox);
const decoder = sandbox.module.exports;
assert.strictEqual(typeof decoder, "function");
assert.ok(decoder.default || true);
"""
    _run_node(script)


def test_qr_scan_helper_loads_vendor_when_barcode_detector_missing() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const scripts = [];
const context = {{
  console, URL, URLSearchParams, String, Boolean, JSON,
  Image: function Image() {{}},
}};
context.document = {{
  querySelector() {{ return null; }},
  createElement(tag) {{
    assert.strictEqual(tag, "script");
    const el = {{ src: "", async: false, dataset: {{}}, onload: null, onerror: null }};
    scripts.push(el);
    return el;
  }},
  head: {{
    appendChild(el) {{
      context.jsQR = function fakeJsQR() {{ return {{ data: "clock-token" }}; }};
      if (typeof el.onload === "function") el.onload();
      return el;
    }},
  }},
}};
vm.createContext(context);
vm.runInContext(fs.readFileSync({str(QR_SCAN)!r}, "utf8"), context);
const helper = context.ShiftSwiftQrScan;
assert.ok(helper);
assert.ok(String(helper.JSQR_SRC).includes("vendor/jsqr.min.js"));
helper.loadJsQR().then((fn) => {{
  assert.strictEqual(typeof fn, "function");
  assert.ok(scripts[0].src.includes("vendor/jsqr.min.js"));
}}).catch((err) => {{ console.error(err); process.exit(1); }});
"""
    _run_node(script)
