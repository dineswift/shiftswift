#!/usr/bin/env python3
"""Inline local script tags so admin and employee load in one response.

Each local script stays in its own <script> block, so top-level const and let
keep the same scope they have as separate files. External scripts are left
as links. Run this on the deployed copy, not on the source HTML you edit.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_SCRIPT_SRC = re.compile(
    r"""<script\s+src=(['"])(\./[^'"]+)\1\s*>\s*</script>""",
    re.IGNORECASE,
)
_CLOSE_SCRIPT = re.compile(r"</script", re.IGNORECASE)


def inline_html(html: str, base: Path) -> tuple[str, int]:
    root = base.resolve()
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        src = match.group(2).split("?", 1)[0]
        relative = src[2:] if src.startswith("./") else src
        path = (root / relative).resolve()
        if root not in path.parents and path != root:
            return match.group(0)
        if not path.is_file():
            return match.group(0)
        body = path.read_text(encoding="utf-8")
        body = _CLOSE_SCRIPT.sub(r"<\\/script", body)
        count += 1
        return f'<script data-src="{relative}">\n{body}\n</script>'

    return _SCRIPT_SRC.sub(replace, html), count


def local_script_count(html: str) -> int:
    return len(_SCRIPT_SRC.findall(html))


def inline_page(path: Path) -> tuple[int, int]:
    html, count = inline_html(path.read_text(encoding="utf-8"), path.parent)
    path.write_text(html, encoding="utf-8")
    left = local_script_count(html)
    print(f"inlined {count} scripts into {path} ({path.stat().st_size} bytes, {left} local scripts left)")
    return count, left


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: inline_page_scripts.py page.html [page.html ...]", file=sys.stderr)
        return 1
    failed = False
    for raw in argv[1:]:
        page = Path(raw)
        if not page.is_file():
            print(f"ERROR: missing {page}", file=sys.stderr)
            return 1
        _count, left = inline_page(page)
        if left:
            print(f"ERROR: {page} still has {left} local script tags", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
