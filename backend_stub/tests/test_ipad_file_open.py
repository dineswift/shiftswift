"""iPad/Safari file open does not rely on <a download> alone."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
FILE_OPEN = FRONTEND / "file-open.js"
ADMIN_SHARED = FRONTEND / "admin-shared.js"
ADMIN_ROTA = FRONTEND / "admin-rota.js"
ADMIN_HTML = FRONTEND / "admin.html"
STYLES_CSS = FRONTEND / "styles.css"
TABLET_CSS = FRONTEND / "admin-tablet.css"


def _run_node(script: str) -> None:
    node = subprocess.run(["node", "-v"], capture_output=True, text=True)
    if node.returncode != 0:
        pytest.skip("node is required to execute file-open.js")
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(result.stderr or result.stdout or "file-open node test failed")


def test_admin_loads_file_open_before_shared() -> None:
    source = ADMIN_HTML.read_text(encoding="utf-8")
    file_open_at = source.find("file-open.js")
    shared_at = source.find("admin-shared.js?v=admin-v47")
    assert 0 < file_open_at < shared_at
    assert "rota-export-pdf-btn" in source or "Grid PDF" in source


def test_download_authenticated_uses_file_open_helper() -> None:
    shared = ADMIN_SHARED.read_text(encoding="utf-8")
    assert "ShiftSwiftFileOpen" in shared
    assert "deliverBlob" in shared
    assert "prefersInAppViewer" in shared
    rota = ADMIN_ROTA.read_text(encoding="utf-8")
    assert "downloadAuthenticated" in rota
    assert "/admin/rota/weeks/" in rota
    assert "Use Print or Share in the preview." in rota


def test_print_dialog_stays_on_screen_on_ipad() -> None:
    styles = STYLES_CSS.read_text(encoding="utf-8")
    tablet = TABLET_CSS.read_text(encoding="utf-8")
    assert "#rota-print-dialog" in tablet or ".punch-export-dialog" in styles
    assert "100dvh" in tablet
    assert "env(safe-area-inset-top" in tablet
    assert "position: fixed" in tablet
    assert "admin-blob-preview" in tablet


def test_ipad_ua_opens_in_app_viewer_not_anchor_download() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const {{ Blob }} = require("buffer");
const helperPath = {str(FILE_OPEN)!r};

class FakeEl {{
  constructor(tag) {{
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {{}};
    this.className = "";
    this.id = "";
    this.textContent = "";
    this.src = "";
    this.href = "";
    this.download = "";
    this.clicked = false;
  }}
  setAttribute(name, value) {{ this.attrs[name] = String(value); }}
  addEventListener() {{}}
  appendChild(child) {{ this.children.push(child); return child; }}
  click() {{ this.clicked = true; }}
  remove() {{ this.removed = true; }}
  querySelector(sel) {{
    const all = [];
    const walk = (node) => {{
      all.push(node);
      (node.children || []).forEach(walk);
    }};
    this.children.forEach(walk);
    if (sel === "iframe") return all.find((n) => n.tagName === "IFRAME") || null;
    return null;
  }}
}}

const body = new FakeEl("body");
const created = [];
const documentRef = {{
  body,
  getElementById() {{ return null; }},
  createElement(tag) {{
    const el = new FakeEl(tag);
    created.push(el);
    return el;
  }},
}};

const ipadNav = {{
  userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  platform: "iPad",
  maxTouchPoints: 5,
}};
const desktopNav = {{
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
  platform: "Win32",
  maxTouchPoints: 0,
}};

const nativeURL = URL;
nativeURL.createObjectURL = () => "blob:https://app.shiftswifthr.co.uk/rota";
nativeURL.revokeObjectURL = () => {{}};

const context = {{
  console, URL: nativeURL, URLSearchParams, String, Boolean, JSON, Blob, File,
  setTimeout: () => 0,
}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(helperPath, "utf8"), context);
const helper = context.ShiftSwiftFileOpen;
assert.ok(helper.prefersInAppViewer(ipadNav, {{}}));
assert.ok(!helper.prefersInAppViewer(desktopNav, {{}}));

(async () => {{
  const pdf = new Blob(["%PDF-1.4"], {{ type: "application/pdf" }});
  const viewed = await helper.deliverBlob(pdf, "shiftswift-rota.pdf", {{
    navigator: ipadNav,
    document: documentRef,
    window: {{ open() {{ return null; }} }},
  }});
  assert.strictEqual(viewed.method, "in-app-viewer");
  assert.strictEqual(viewed.kind, "pdf");
  assert.strictEqual(body.children.length, 1);
  assert.ok(created.some((el) => el.tagName === "IFRAME" && el.src === "blob:https://app.shiftswifthr.co.uk/rota"));
  assert.ok(created.some((el) => el.textContent === "Open tab"));
  assert.ok(created.some((el) => el.textContent === "Share"));
  assert.ok(!created.some((el) => el.tagName === "A" && el.clicked));

  const downloaded = await helper.deliverBlob(pdf, "shiftswift-rota.pdf", {{
    navigator: desktopNav,
    document: documentRef,
    window: {{}},
  }});
  assert.strictEqual(downloaded.method, "anchor-download");
}})().catch((err) => {{ console.error(err); process.exit(1); }});
"""
    _run_node(script)
