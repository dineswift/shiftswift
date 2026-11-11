#!/usr/bin/env python3
"""Give the next store archive a version code that has not been built yet.

iOS 1.5.6 is a closed train. Android version codes 26 and 27 were already
accepted by Play. Running an archive again bumps past the last build this
script recorded, then records the new number before the long compile starts.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LEDGER = REPO / "release" / "store-versions.json"
IOS_PROJECT = REPO / "iphone-app" / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
IOS_PACKAGE = REPO / "iphone-app" / "package.json"
ANDROID_GRADLE = REPO / "android-app" / "android" / "app" / "build.gradle"


def version_key(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def bump_patch(value: str) -> str:
    parts = [int(part) for part in value.split(".")]
    parts[-1] += 1
    return ".".join(str(part) for part in parts)


def load_ledger(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_ledger(path: Path, ledger: dict) -> None:
    path.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")


def read_ios(text: str) -> tuple[str, int]:
    marketing = re.findall(r"MARKETING_VERSION = ([0-9.]+);", text)
    builds = re.findall(r"CURRENT_PROJECT_VERSION = (\d+);", text)
    if not marketing or not builds:
        raise SystemExit("Could not read the iOS marketing version or build number")
    if len(set(marketing)) != 1 or len(set(builds)) != 1:
        raise SystemExit("Debug and Release iOS versions differ")
    return marketing[0], int(builds[0])


def write_ios(text: str, marketing: str, build: int) -> str:
    text = re.sub(r"MARKETING_VERSION = [0-9.]+;", f"MARKETING_VERSION = {marketing};", text)
    text = re.sub(r"CURRENT_PROJECT_VERSION = \d+;", f"CURRENT_PROJECT_VERSION = {build};", text)
    return text


def read_android(text: str) -> int:
    match = re.search(r"versionCode\s+(\d+)", text)
    if not match:
        raise SystemExit("Could not read Android versionCode")
    return int(match.group(1))


def write_android(text: str, version_code: int) -> str:
    return re.sub(r"versionCode\s+\d+", f"versionCode {version_code}", text, count=1)


def next_ios(marketing: str, build: int, ledger: dict) -> tuple[str, int, bool]:
    ios = ledger["ios"]
    closed = set(ios.get("closedMarketing") or [])
    last_marketing = str(ios["lastBuiltMarketing"])
    last_build = int(ios["lastBuiltBuild"])
    changed = False
    if marketing in closed or version_key(marketing) < version_key(last_marketing):
        marketing = last_marketing
        build = last_build + 1
        changed = True
        while marketing in closed:
            marketing = bump_patch(marketing)
    elif version_key(marketing) == version_key(last_marketing) and build <= last_build:
        build = last_build + 1
        changed = True
    return marketing, build, changed


def next_android(version_code: int, ledger: dict) -> tuple[int, bool]:
    android = ledger["android"]
    consumed = [int(code) for code in android.get("consumedVersionCodes") or []]
    last_built = int(android["lastBuiltVersionCode"])
    floor = max([last_built, *consumed]) if consumed else last_built
    if version_code <= floor or version_code in consumed:
        return floor + 1, True
    return version_code, False


def prepare(platform: str, *, root: Path, ledger_path: Path) -> str:
    ledger = load_ledger(ledger_path)
    if platform == "ios":
        project = root / "iphone-app" / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
        package = root / "iphone-app" / "package.json"
        text = project.read_text(encoding="utf-8")
        marketing, build = read_ios(text)
        marketing, build, _changed = next_ios(marketing, build, ledger)
        project.write_text(write_ios(text, marketing, build), encoding="utf-8")
        package_text = package.read_text(encoding="utf-8")
        package.write_text(
            re.sub(r'"version":\s*"[0-9.]+"', f'"version": "{marketing}"', package_text, count=1),
            encoding="utf-8",
        )
        ledger["ios"]["lastBuiltMarketing"] = marketing
        ledger["ios"]["lastBuiltBuild"] = build
        save_ledger(ledger_path, ledger)
        return f"iOS {marketing} ({build})"
    gradle = root / "android-app" / "android" / "app" / "build.gradle"
    text = gradle.read_text(encoding="utf-8")
    version_code, _changed = next_android(read_android(text), ledger)
    gradle.write_text(write_android(text, version_code), encoding="utf-8")
    ledger["android"]["lastBuiltVersionCode"] = version_code
    save_ledger(ledger_path, ledger)
    name = re.search(r'versionName\s+"([^"]+)"', text)
    label = name.group(1) if name else "android"
    return f"Android {label} ({version_code})"


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in {"ios", "android"}:
        print("Usage: prepare_store_build.py ios|android", file=sys.stderr)
        return 1
    print(prepare(argv[1], root=REPO, ledger_path=LEDGER))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
