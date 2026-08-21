#!/usr/bin/env python3
"""Refresh marketing screenshots. Prefer the high-fidelity Chrome captures."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPTURE = ROOT / "scripts" / "generate_marketing_screenshots.py"


def main() -> None:
    subprocess.run([sys.executable, str(CAPTURE)], check=True)


if __name__ == "__main__":
    main()
