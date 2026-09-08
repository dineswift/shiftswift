"""UK phone numbers → E.164 for caller ID matching."""

from __future__ import annotations

import re


def to_e164(raw: str | None, default_cc: str = "44") -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", str(raw))
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith(default_cc) and len(digits) >= 11:
        return f"+{digits}"
    if digits.startswith("0") and len(digits) >= 10:
        return f"+{default_cc}{digits[1:]}"
    if len(digits) == 10 and digits.startswith("7"):
        return f"+{default_cc}{digits}"
    if digits.startswith("1") and len(digits) == 11:
        return f"+{digits}"
    return f"+{digits}"


def digits_only(raw: str | None) -> str:
    return re.sub(r"\D+", "", str(raw or ""))
