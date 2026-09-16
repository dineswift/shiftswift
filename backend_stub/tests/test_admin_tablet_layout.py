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
    assert "@media (min-width: 861px) and (max-width: 1366px)" in css
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


def test_wide_detail_panel_only_applies_past_ipad() -> None:
    css = STYLES_CSS.read_text(encoding="utf-8")
    assert "@media (min-width: 1367px)" in css
    start = css.index(".hr-main-pane {\n  flex: 1;\n  min-width: 0;\n}\n\n.hr-detail-panel {")
    media = css.index("@media (min-width: 1367px)", start)
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
    assert 'href="./admin-tablet.css?v=4"' in html
    rota = (FRONTEND / "admin-rota.js").read_text(encoding="utf-8")
    assert "Use Print or Share in the preview." in rota
    assert "/admin/rota/weeks/" in rota
    assert "export.pdf" in rota or "export.${ext}" in rota


def test_native_ios_app_is_universal_ipad() -> None:
    plist = (ROOT / "mobile" / "ios-app" / "App" / "App" / "Info.plist").read_text(encoding="utf-8")
    pbx = (ROOT / "mobile" / "ios-app" / "App" / "App.xcodeproj" / "project.pbxproj").read_text(
        encoding="utf-8"
    )
    cap = (ROOT / "mobile" / "capacitor.config.ts").read_text(encoding="utf-8")
    assert "UISupportedInterfaceOrientations~ipad" in plist
    assert "ITSAppUsesNonExemptEncryption" in plist
    export_plist = (ROOT / "mobile" / "ios-app" / "ExportOptions.Transporter.plist").read_text(
        encoding="utf-8"
    )
    assert "app-store-connect" in export_plist
    podfile = (ROOT / "mobile" / "ios-app" / "App" / "Podfile").read_text(encoding="utf-8")
    assert "SUPPORTS_MACCATALYST'] = 'NO'" in podfile or 'SUPPORTS_MACCATALYST"] = "NO"' in podfile or "SUPPORTS_MACCATALYST'] = 'NO'" in podfile
    assert "SUPPORTS_MACCATALYST" in podfile
    assert "NSCameraUsageDescription" in plist
    assert "NSPhotoLibraryUsageDescription" in plist
    assert "<string>arm64</string>" in plist
    assert "IPHONEOS_DEPLOYMENT_TARGET = 15.0" in pbx
    assert 'TARGETED_DEVICE_FAMILY = "1,2"' in pbx
    assert "CURRENT_PROJECT_VERSION = 12" in pbx
    assert "SUPPORTED_PLATFORMS" in podfile
    assert "ENABLE_USER_SCRIPT_SANDBOXING = NO" in pbx
    assert "SWIFT_COMPILATION_MODE = wholemodule" in pbx
    assert 'SWIFT_OPTIMIZATION_LEVEL = "-O"' in pbx
    assert "MARKETING_VERSION = 1.0.3" in pbx
    assert 'preferredContentMode: "mobile"' in cap
    assert "UIRequiresFullScreen: true" in cap
    assert (ROOT / "mobile" / "ios-app" / "App" / "App" / "public" / "index.html").is_file()
    assert (ROOT / "mobile" / "ios-app" / "App" / "App" / "capacitor.config.json").is_file()
    assert (ROOT / "mobile" / "ios-app" / "App" / "App" / "config.xml").is_file()
    native_app = (FRONTEND / "native-app.js").read_text(encoding="utf-8")
    assert 'BUNDLED_ASSET_VERSION = "28"' in native_app

