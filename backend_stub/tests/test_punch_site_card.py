"""Premises QR print cards keep the clock URL without sessionStorage."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
FRONTEND = ROOT / "frontend"
PUNCH_CARD_LINK = FRONTEND / "punch-card-link.js"
PUNCH_SITE_CARD = FRONTEND / "punch-site-card.html"
ADMIN_TIME_PUNCH = FRONTEND / "admin-time-punch.js"
ADMIN_HTML = FRONTEND / "admin.html"


def _run_node(script: str) -> None:
    node = subprocess.run(["node", "-v"], capture_output=True, text=True)
    if node.returncode != 0:
        pytest.skip("node is required to execute punch-card-link.js")
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(result.stderr or result.stdout or "punch card node test failed")


def test_admin_html_cache_busts_punch_card_scripts() -> None:
    source = ADMIN_HTML.read_text(encoding="utf-8")
    assert 'src="./punch-card-link.js?v=38"' in source
    assert 'src="./admin-time-punch.js?v=38"' in source
    assert 'src="./admin-time-punch.js?v=37"' not in source
    assert 'src="./file-open.js?v=1"' in source
    assert 'src="./admin-shared.js?v=admin-v47"' in source
    assert 'src="./admin-rota.js?v=37"' in source
    assert 'id="rota-print-submit">Open PDF' in source


def test_print_card_entry_points_all_call_open_punch_card_page() -> None:
    source = ADMIN_TIME_PUNCH.read_text(encoding="utf-8")
    assert 'data-gallery-print-card' in source
    assert 'id="punch-print-clock-card"' in source
    assert "data-site-qr-print" in source
    assert source.count('openPunchCardPage("pocket"') >= 4
    assert source.count('openPunchCardPage("tent"') >= 2
    assert "Allow pop-ups to open the QR print page." not in source
    assert "openCardInAdminTab(href)" in source
    assert "window.location.assign(href)" in source
    assert "isBlankPrintWindow" in source
    assert "navigatePrintWindow" in source
    assert "shouldOpenPrintInPlace" in source
    assert "pngBlobFromOnScreenQr" in source
    assert "data-gallery-qr" in source
    assert "shiftswift-punch-card" in source
    assert 'window.open(href, "_blank")' in source
    assert 'window.open(href, "_blank", "noopener")' not in source
    assert "punch-site-card.html" in source
    assert "window.location.origin + window.location.pathname" in source
    assert 'new URL("./punch-site-card.html", window.location.href)' not in source
    assert "QR card opened in the app. Use Print, then Close to return." in source


def test_card_html_reads_shared_helper_not_session_storage_only() -> None:
    source = PUNCH_SITE_CARD.read_text(encoding="utf-8")
    assert 'src="./punch-card-link.js?v=38"' in source
    assert "bootPunchSiteCard" in source
    assert "listenForParentPayload" in source
    assert "localStorage, sessionStorage" in source
    assert "#url=" in source or "#url=…" in source


def test_query_and_hash_render_without_session_storage() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const helperPath = {str(PUNCH_CARD_LINK)!r};

function memoryStorage() {{
  const data = new Map();
  return {{
    getItem(key) {{
      return data.has(String(key)) ? data.get(String(key)) : null;
    }},
    setItem(key, value) {{
      data.set(String(key), String(value));
    }},
    removeItem(key) {{
      data.delete(String(key));
    }},
  }};
}}

function mockNode(id, extras = {{}}) {{
  return Object.assign({{
    id,
    hidden: true,
    textContent: "",
    src: "",
    alt: "",
    classList: {{ remove() {{}}, add() {{}} }},
    style: {{ setProperty() {{}} }},
    querySelector() {{ return null; }},
  }}, extras);
}}

function mockDocument() {{
  const empty = mockNode("card-empty");
  const preview = mockNode("card-preview");
  const site = mockNode("card-site-name");
  const tentSite = mockNode("tent-site-name");
  const qr = mockNode("card-qr-image");
  const tentQr = mockNode("tent-qr-image");
  const cardWrap = mockNode("wrap", {{ hidden: false }});
  const tentWrap = mockNode("tent", {{ hidden: true }});
  const body = {{
    classList: {{
      tokens: new Set(),
      remove(...names) {{ names.forEach((n) => this.tokens.delete(n)); }},
      add(...names) {{ names.forEach((n) => this.tokens.add(n)); }},
    }},
  }};
  const nodes = {{
    "card-empty": empty,
    "card-preview": preview,
    "card-site-name": site,
    "tent-site-name": tentSite,
    "card-qr-image": qr,
    "tent-qr-image": tentQr,
  }};
  return {{
    body,
    documentElement: {{ style: {{ setProperty() {{}} }} }},
    getElementById(id) {{ return nodes[id] || null; }},
    querySelector(sel) {{
      if (sel === ".punch-card-wrap") return cardWrap;
      if (sel === ".tent-wrap") return tentWrap;
      return null;
    }},
    empty,
    preview,
    site,
    qr,
    tentQr,
  }};
}}

const context = {{ console, URL, URLSearchParams, String, Boolean, JSON }};
vm.createContext(context);
vm.runInContext(fs.readFileSync(helperPath, "utf8"), context);
const cards = context.ShiftSwiftPunchCards;
assert.ok(cards, "ShiftSwiftPunchCards missing");

const adminLocation = {{
  href: "https://app.shiftswifthr.co.uk/admin.html#time-punch",
  origin: "https://app.shiftswifthr.co.uk",
  pathname: "/admin.html",
  search: "",
  hash: "#time-punch",
}};
const clockUrl = "https://app.shiftswifthr.co.uk/punch.html?clock=site-token";
const built = cards.buildPunchCardHref("pocket", {{
  clock_url: clockUrl,
  site_name: "Himalayan Inn",
}}, adminLocation);
const parsed = new URL(built.href);
assert.strictEqual(parsed.pathname, "/punch-site-card.html");
assert.strictEqual(parsed.searchParams.get("url"), clockUrl);
assert.strictEqual(parsed.searchParams.get("site"), "Himalayan Inn");
assert.ok(parsed.hash.includes("url="));
assert.ok(parsed.hash.includes("site="));
assert.ok(!parsed.hash.includes("time-punch"));

const emptyStorage = [];
const queryOnly = {{
  href: parsed.origin + parsed.pathname + parsed.search,
  origin: parsed.origin,
  pathname: parsed.pathname,
  search: parsed.search,
  hash: "",
}};
const fromQuery = cards.readPunchCardParams(queryOnly, emptyStorage);
assert.strictEqual(fromQuery.clockUrl, clockUrl);
assert.strictEqual(fromQuery.siteName, "Himalayan Inn");

const hashOnly = {{
  href: parsed.origin + parsed.pathname + parsed.hash,
  origin: parsed.origin,
  pathname: parsed.pathname,
  search: "",
  hash: parsed.hash,
}};
const fromHash = cards.readPunchCardParams(hashOnly, emptyStorage);
assert.strictEqual(fromHash.clockUrl, clockUrl);
assert.strictEqual(fromHash.siteName, "Himalayan Inn");

const queryDoc = mockDocument();
const queryBoot = cards.bootPunchSiteCard(queryDoc, queryOnly, emptyStorage);
assert.strictEqual(queryBoot.ok, true);
assert.strictEqual(queryDoc.empty.hidden, true);
assert.strictEqual(queryDoc.preview.hidden, false);
assert.strictEqual(queryDoc.site.textContent, "Himalayan Inn");
assert.ok(queryDoc.qr.src.includes("create-qr-code") || queryDoc.qr.src.startsWith("data:"));
assert.ok(queryDoc.qr.src.includes("site-token") || queryDoc.qr.src.includes(encodeURIComponent(clockUrl)));

const hashDoc = mockDocument();
const hashBoot = cards.bootPunchSiteCard(hashDoc, hashOnly, emptyStorage);
assert.strictEqual(hashBoot.ok, true);
assert.strictEqual(hashDoc.empty.hidden, true);
assert.strictEqual(hashDoc.preview.hidden, false);
assert.strictEqual(hashDoc.site.textContent, "Himalayan Inn");

const missingDoc = mockDocument();
const missing = cards.bootPunchSiteCard(missingDoc, {{
  href: "https://app.shiftswifthr.co.uk/punch-site-card.html",
  origin: "https://app.shiftswifthr.co.uk",
  pathname: "/punch-site-card.html",
  search: "",
  hash: "",
}}, emptyStorage);
assert.strictEqual(missing.ok, false);
assert.strictEqual(missingDoc.empty.hidden, false);
assert.strictEqual(missingDoc.preview.hidden, true);

const storedOnly = memoryStorage();
storedOnly.setItem("punchCardPayload", JSON.stringify({{
  clock_url: clockUrl,
  site_name: "From storage",
}}));
const session = memoryStorage();
const storedDoc = mockDocument();
const storedBoot = cards.bootPunchSiteCard(storedDoc, {{
  href: "https://app.shiftswifthr.co.uk/punch-site-card.html",
  origin: "https://app.shiftswifthr.co.uk",
  pathname: "/punch-site-card.html",
  search: "",
  hash: "",
}}, [storedOnly, session]);
assert.strictEqual(storedBoot.ok, true);
assert.strictEqual(storedDoc.site.textContent, "From storage");
"""
    _run_node(script)


def test_www_redirect_dropping_search_still_reads_hash() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const helperPath = {str(PUNCH_CARD_LINK)!r};
const context = {{ console, URL, URLSearchParams, String, Boolean, JSON }};
vm.createContext(context);
vm.runInContext(fs.readFileSync(helperPath, "utf8"), context);
const cards = context.ShiftSwiftPunchCards;
const built = cards.buildPunchCardHref("tent", {{
  clock_url: "https://app.shiftswifthr.co.uk/punch.html?clock=abc",
  site_name: "Main site",
}}, {{
  href: "https://www.shiftswifthr.co.uk/admin.html#time-punch",
  origin: "https://www.shiftswifthr.co.uk",
  pathname: "/admin.html",
  search: "",
  hash: "#time-punch",
}});
const parsed = new URL(built.href);
assert.strictEqual(parsed.host, "www.shiftswifthr.co.uk");
assert.strictEqual(parsed.pathname, "/punch-site-card.html");
const afterServerRedirect = {{
  href: "https://app.shiftswifthr.co.uk/punch-site-card.html" + parsed.hash,
  origin: "https://app.shiftswifthr.co.uk",
  pathname: "/punch-site-card.html",
  search: "",
  hash: parsed.hash,
}};
const params = cards.readPunchCardParams(afterServerRedirect, []);
assert.strictEqual(params.clockUrl, "https://app.shiftswifthr.co.uk/punch.html?clock=abc");
assert.strictEqual(params.siteName, "Main site");
assert.strictEqual(params.layout, "tent");
"""
    _run_node(script)
