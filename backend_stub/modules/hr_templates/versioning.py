"""Semantic version helpers for HR process templates."""

from __future__ import annotations

import hashlib
import re


def content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_version(version: str) -> tuple[int, ...]:
    cleaned = version.strip().lower().lstrip("v")
    parts = re.split(r"[.\-]", cleaned)
    numbers: list[int] = []
    for part in parts:
        if part.isdigit():
            numbers.append(int(part))
        elif part:
            break
    return tuple(numbers or [0])


def version_lt(left: str, right: str) -> bool:
    return parse_version(left) < parse_version(right)


def version_gt(left: str, right: str) -> bool:
    return parse_version(left) > parse_version(right)


def format_download_filename(
    *, template_id: str, version: str, variant: str, ext: str = "md"
) -> str:
    safe_id = template_id.replace("_", "-")
    safe_version = version.replace(".", "-")
    safe_ext = ext.strip().lower().lstrip(".") or "md"
    return f"shiftswift-hr-{safe_id}-v{safe_version}-{variant}.{safe_ext}"
