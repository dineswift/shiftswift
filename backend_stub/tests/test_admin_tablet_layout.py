"""HR admin layout stays inside 13-inch iPad CSS widths without page-level horizontal scroll."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
ADMIN_HTML = FRONTEND / "admin.html"
TABLET_CSS = FRONTEND / "admin-tablet.css"
STYLES_CSS = FRONTEND / "styles.css"


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


def test_tablet_css_includes_in_app_file_preview() -> None:
    css = TABLET_CSS.read_text(encoding="utf-8")
    assert ".admin-blob-preview" in css
    assert ".admin-blob-preview__bar" in css
    assert ".admin-blob-preview__body iframe" in css


def test_admin_shared_opens_files_in_place_on_ipad() -> None:
    source = (FRONTEND / "admin-shared.js").read_text(encoding="utf-8")
    assert "function isCompactIosShell()" in source
    assert "ShiftSwiftFileOpen" in source
    assert "deliverBlob" in source
    html = ADMIN_HTML.read_text(encoding="utf-8")
    assert 'src="./file-open.js?v=1"' in html
    assert 'src="./admin-shared.js?v=admin-v47"' in html
    assert 'href="./admin-tablet.css?v=3"' in html
    rota = (FRONTEND / "admin-rota.js").read_text(encoding="utf-8")
    assert "Use Print or Share in the preview." in rota
    assert "/admin/rota/print.pdf?" in rota
