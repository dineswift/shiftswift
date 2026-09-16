"""HR admin layout stays inside 13-inch iPad CSS widths without page-level horizontal scroll."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
ADMIN_HTML = FRONTEND / "admin.html"
TABLET_CSS = FRONTEND / "admin-tablet.css"
STYLES_CSS = FRONTEND / "styles.css"

IPAD_SHELL = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="./styles.css" />
    <link rel="stylesheet" href="./admin-tablet.css" />
  </head>
  <body class="admin-portal">
    <div class="app">
      <aside class="sidebar">
        <nav class="nav">
          <a class="nav-link active" href="#employees"><span class="nav-link__label">Employees</span></a>
          <a class="nav-link" href="#rota"><span class="nav-link__label">Rota</span></a>
        </nav>
      </aside>
      <main class="content">
        <header class="topbar"><strong class="topbar-brand__name">Himalayan Inn</strong></header>
        <section id="employees" class="admin-section">
          <header class="section-header employees-page-header">
            <div><h2>Employees</h2><p class="muted">Register</p></div>
            <div class="section-actions">
              <a class="btn ghost" href="#recruitment">Recruitment pipeline</a>
              <a class="btn ghost" href="#offboarding">Offboarding workflow</a>
            </div>
          </header>
          <div class="lifecycle-stage-rail">
            <div class="lifecycle-stage-rail__track">
              <button type="button" class="lifecycle-stage-rail__step"><span class="lifecycle-stage-rail__label">Recruitment</span></button>
              <button type="button" class="lifecycle-stage-rail__step"><span class="lifecycle-stage-rail__label">Onboarding</span></button>
              <button type="button" class="lifecycle-stage-rail__step"><span class="lifecycle-stage-rail__label">Active</span></button>
              <button type="button" class="lifecycle-stage-rail__step"><span class="lifecycle-stage-rail__label">Offboarding</span></button>
            </div>
          </div>
          <div class="employees-desktop-layout hr-workspace-layout">
            <div class="hr-main-pane">
              <article class="hr-surface-panel">
                <h4>Add employee</h4>
                <label class="edit-field"><span class="edit-label">First name</span><input value="Karun" /></label>
              </article>
              <div class="hr-table-wrap">
                <table class="data-table">
                  <thead><tr><th>Name</th><th>Department</th><th>Status</th><th>Portal</th><th>Progress</th></tr></thead>
                  <tbody><tr><td>Karun Acharya</td><td>Kitchen</td><td>ACTIVE</td><td>Active</td><td>33%</td></tr></tbody>
                </table>
              </div>
            </div>
            <aside class="hr-detail-panel" id="employees-side-panel">
              <h4>No employee selected</h4>
              <p>Select someone from the register to view and edit their profile.</p>
            </aside>
          </div>
        </section>
        <section class="admin-section">
          <div class="overview-dashboard-layout">
            <div class="overview-main"><p>Modules</p></div>
            <aside class="overview-actions-panel"><p>Open actions</p></aside>
          </div>
        </section>
      </main>
    </div>
    <script>
      window.addEventListener("load", function () {
        var layout = document.querySelector(".employees-desktop-layout");
        var panel = document.querySelector("#employees-side-panel");
        var out = {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
          layoutDirection: layout ? getComputedStyle(layout).flexDirection : ""
        };
        document.body.setAttribute("data-tablet-metrics", JSON.stringify(out));
      });
    </script>
  </body>
</html>
"""


def test_admin_html_loads_tablet_stylesheet_after_core_styles() -> None:
    source = ADMIN_HTML.read_text(encoding="utf-8")
    styles_at = source.find("styles.css")
    tablet_at = source.find("admin-tablet.css")
    assert tablet_at > styles_at > 0
    assert "admin-tablet.css?v=" in source


def test_tablet_css_stacks_shared_workspaces_for_ipad_portrait() -> None:
    css = TABLET_CSS.read_text(encoding="utf-8")
    assert "@media (min-width: 861px) and (max-width: 1180px)" in css
    for selector in (
        ".hr-workspace-layout",
        ".employees-desktop-layout",
        ".recruitment-workspace-layout",
        ".grievance-workspace-layout",
        ".leave-workspace-layout",
        ".contracts-workspace-layout",
        ".templates-workspace",
        ".rota-builder-layout",
        ".settings-accordion",
        ".overview-dashboard-layout",
    ):
        assert selector in css
    assert "flex-direction: column" in css
    assert ".hr-detail-panel" in css
    assert "width: 100%" in css


def test_wide_detail_panel_only_applies_past_ipad_portrait() -> None:
    css = STYLES_CSS.read_text(encoding="utf-8")
    assert "@media (min-width: 1181px)" in css
    start = css.index(".hr-main-pane {\n  flex: 1;\n  min-width: 0;\n}\n\n.hr-detail-panel {")
    media = css.index("@media (min-width: 1181px)", start)
    unscoped = css[start:media]
    assert "400px" not in unscoped
    desktop = css[media : media + 180]
    assert "flex: 0 0 400px" in desktop
    assert "width: 400px" in desktop


def test_phone_layout_breakpoint_is_unchanged() -> None:
    css = TABLET_CSS.read_text(encoding="utf-8")
    assert "min-width: 861px" in css
    mobile = (FRONTEND / "admin-mobile-polish.css").read_text(encoding="utf-8")
    assert "@media (max-width: 860px)" in mobile


def _chromium_bin() -> str | None:
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    return None


def test_ipad_shell_does_not_need_page_horizontal_scroll() -> None:
    chromium = _chromium_bin()
    if not chromium:
        return

    probe = FRONTEND / "_admin_tablet_overflow_probe.html"
    probe.write_text(IPAD_SHELL, encoding="utf-8")
    try:
        dumped = subprocess.run(
            [
                chromium,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--window-size=1024,1366",
                "--virtual-time-budget=4000",
                "--dump-dom",
                probe.as_uri(),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=40,
        )
        html = dumped.stdout
        marker = 'data-tablet-metrics="'
        assert marker in html, html[-2000:]
        raw = html.split(marker, 1)[1].split('"', 1)[0]
        metrics = json.loads(raw.replace("&quot;", '"').replace("&#34;", '"'))
        assert metrics["layoutDirection"] == "column", metrics
        assert metrics["scrollWidth"] <= metrics["clientWidth"] + 1, metrics
        assert metrics["panelWidth"] >= 200, metrics
        assert metrics["panelWidth"] <= metrics["clientWidth"], metrics
    finally:
        probe.unlink(missing_ok=True)
