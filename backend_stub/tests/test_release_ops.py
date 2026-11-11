"""Store version guard and the one-download page bundle."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, relative: str):
    path = ROOT / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_closed_ios_train_moves_to_the_next_build(tmp_path: Path) -> None:
    guard = _load("prepare_store_build", "scripts/prepare_store_build.py")
    root = tmp_path / "repo"
    project = root / "iphone-app/ios/App/App.xcodeproj/project.pbxproj"
    project.parent.mkdir(parents=True)
    project.write_text(
        "CURRENT_PROJECT_VERSION = 32;\nMARKETING_VERSION = 1.5.6;\n"
        "CURRENT_PROJECT_VERSION = 32;\nMARKETING_VERSION = 1.5.6;\n",
        encoding="utf-8",
    )
    package = root / "iphone-app/package.json"
    package.write_text('{"version": "1.5.6"}\n', encoding="utf-8")
    ledger_path = tmp_path / "store-versions.json"
    ledger_path.write_text(
        json.dumps(
            {
                "ios": {
                    "closedMarketing": ["1.5.6"],
                    "lastBuiltMarketing": "1.5.7",
                    "lastBuiltBuild": 32,
                }
            }
        ),
        encoding="utf-8",
    )

    label = guard.prepare("ios", root=root, ledger_path=ledger_path)

    assert label == "iOS 1.5.7 (33)"
    text = project.read_text(encoding="utf-8")
    assert "MARKETING_VERSION = 1.5.7;" in text
    assert "CURRENT_PROJECT_VERSION = 33;" in text
    assert "1.5.6" not in text
    assert '"version": "1.5.7"' in package.read_text(encoding="utf-8")
    saved = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert saved["ios"]["lastBuiltBuild"] == 33


def test_android_version_code_skips_codes_play_already_has(tmp_path: Path) -> None:
    guard = _load("prepare_store_build_android", "scripts/prepare_store_build.py")
    root = tmp_path / "repo"
    gradle = root / "android-app/android/app/build.gradle"
    gradle.parent.mkdir(parents=True)
    gradle.write_text('        versionCode 27\n        versionName "1.3.12"\n', encoding="utf-8")
    ledger_path = tmp_path / "store-versions.json"
    ledger_path.write_text(
        json.dumps({"android": {"consumedVersionCodes": [26, 27], "lastBuiltVersionCode": 28}}),
        encoding="utf-8",
    )

    label = guard.prepare("android", root=root, ledger_path=ledger_path)

    assert label == "Android 1.3.12 (29)"
    assert "versionCode 29" in gradle.read_text(encoding="utf-8")


def test_inline_keeps_each_script_in_its_own_block(tmp_path: Path) -> None:
    bundler = _load("inline_page_scripts", "scripts/inline_page_scripts.py")
    (tmp_path / "app.js").write_text("const n = 1;\nwindow.ready = '</script>';\n", encoding="utf-8")
    page = tmp_path / "admin.html"
    page.write_text(
        '<script src="./app.js?v=2"></script>\n<script src="https://example.com/x.js"></script>\n',
        encoding="utf-8",
    )

    html, count = bundler.inline_html(page.read_text(encoding="utf-8"), tmp_path)

    assert count == 1
    assert 'src="./app.js' not in html
    assert "https://example.com/x.js" in html
    assert "const n = 1;" in html
    assert "<\\/script>" in html
    assert html.count("<script") == 2


def test_inline_page_stops_when_a_local_script_is_missing(tmp_path: Path) -> None:
    bundler = _load("inline_page_scripts_missing", "scripts/inline_page_scripts.py")
    page = tmp_path / "admin.html"
    page.write_text('<script src="./missing.js"></script>\n', encoding="utf-8")

    code = bundler.main(["inline_page_scripts.py", str(page)])

    assert code == 1
    assert 'src="./missing.js"' in page.read_text(encoding="utf-8")
