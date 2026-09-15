"""Admin console tab title follows the signed-in tenant, not a leftover brand."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from employee_portal_consent import tenant_display_name

SESSION_AUTH = ROOT / "frontend" / "session-auth.js"
ADMIN_SHARED = ROOT / "frontend" / "admin-shared.js"
ADMIN_WORKSPACE = ROOT / "frontend" / "admin-workspace.js"


def test_tenant_display_name_prefers_trading_name_over_legal_name() -> None:
    conn = MagicMock()
    with patch(
        "admin_service.get_tenant_profile",
        return_value={"trading_name": "Himalayan Inn", "name": "Avatar Dining Ltd"},
    ):
        assert tenant_display_name(tenant_id=7, conn=conn) == "Himalayan Inn"


def test_tenant_display_name_falls_back_to_tenant_name() -> None:
    conn = MagicMock()
    with patch(
        "admin_service.get_tenant_profile",
        return_value={"trading_name": "", "name": "Himalayan Inn"},
    ):
        assert tenant_display_name(tenant_id=7, conn=conn) == "Himalayan Inn"


def test_admin_shared_does_not_set_tab_title_from_stale_storage_or_platform_brand() -> None:
    source = ADMIN_SHARED.read_text(encoding="utf-8")
    assert "document.title = `${businessName} | Admin Console`" not in source
    assert "ShiftSwiftBrand?.appName" not in source
    assert 'document.title = "ShiftSwift HR | Admin Console"' in source
    assert "applyWorkspaceBrand" in source


def test_auth_verify_attaches_tenant_name() -> None:
    auth_routes = (BACKEND / "auth_routes.py").read_text(encoding="utf-8")
    assert 'result["tenant_name"] = tenant_display_name(' in auth_routes


def test_workspace_applies_live_tenant_name_to_topbar_and_title() -> None:
    source = ADMIN_WORKSPACE.read_text(encoding="utf-8")
    assert "applyWorkspaceBrand" in source


def test_session_auth_overwrites_avatar_dining_title_with_himalayan_inn() -> None:
    node = subprocess.run(["node", "-v"], capture_output=True, text=True)
    if node.returncode != 0:
        pytest.skip("node is required to execute session-auth.js")

    script = f"""
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const sessionPath = {str(SESSION_AUTH)!r};

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

const localStorage = memoryStorage();
const sessionStorage = memoryStorage();
const document = {{ title: "Avatar Dining | Admin Console" }};
const window = {{
  location: {{ pathname: "/admin.html", href: "http://localhost/admin.html", search: "", hostname: "localhost", replace() {{}} }},
  Capacitor: undefined,
}};
const context = {{
  window,
  document,
  localStorage,
  sessionStorage,
  location: window.location,
  fetch: async () => ({{ ok: true, status: 200, json: async () => ({{}}) }}),
  Boolean,
  String,
  Number,
  JSON,
  URL,
  URLSearchParams,
  console,
}};
window.window = window;
window.document = document;
window.localStorage = localStorage;
window.sessionStorage = sessionStorage;
vm.createContext(context);
vm.runInContext(fs.readFileSync(sessionPath, "utf8"), context);
const session = context.window.ShiftSwiftSession;
assert.ok(session, "ShiftSwiftSession missing");

localStorage.setItem("businessName", "Avatar Dining");
localStorage.setItem("adminDisplayName", "Dining");
localStorage.setItem("adminFirstName", "Dining");
localStorage.setItem("tenantId", "1");
document.title = "Avatar Dining | Admin Console";

const applied = session.applyWorkspaceBrand({{
  trading_name: "Himalayan Inn",
  tenant_name: "Himalayan Inn Ltd",
}});
assert.strictEqual(applied, "Himalayan Inn");
assert.strictEqual(localStorage.getItem("businessName"), "Himalayan Inn");
assert.strictEqual(document.title, "Himalayan Inn | Admin Console");
assert.ok(!document.title.includes("Avatar Dining"));

localStorage.setItem("businessName", "Avatar Dining");
localStorage.setItem("adminDisplayName", "Dining");
session.storeSession(
  {{
    access_token: "tok",
    refresh_token: "ref",
    role: "hr",
    tenant_id: "42",
    tenant_name: "Himalayan Inn",
  }},
  {{ replaceIdentity: true }},
);
assert.strictEqual(localStorage.getItem("adminDisplayName"), null);
assert.strictEqual(localStorage.getItem("businessName"), "Himalayan Inn");
assert.strictEqual(document.title, "Himalayan Inn | Admin Console");
assert.strictEqual(localStorage.getItem("tenantId"), "42");

localStorage.setItem("businessName", "Avatar Dining");
localStorage.setItem("adminDisplayName", "Dining");
session.storeSession({{ access_token: "tok2", tenant_id: "99" }});
assert.strictEqual(localStorage.getItem("adminDisplayName"), null);
assert.strictEqual(localStorage.getItem("businessName"), null);
assert.ok(document.title !== "Avatar Dining | Admin Console");

session.applyAdminConsoleTitle("Himalayan Inn");
assert.strictEqual(document.title, "Himalayan Inn | Admin Console");
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(result.stderr or result.stdout or "session-auth.js node test failed")
