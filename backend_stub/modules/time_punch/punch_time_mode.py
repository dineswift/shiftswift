"""Per-tenant clock display mode helpers (no network/DB imports)."""

from __future__ import annotations

from typing import Any, Literal

PunchTimeMode = Literal["timestamped", "presence_only"]
PUNCH_TIME_MODES: tuple[str, ...] = ("timestamped", "presence_only")
DEFAULT_PUNCH_TIME_MODE: PunchTimeMode = "timestamped"
SPONSOR_PRESENCE_ONLY_BLOCKED = (
    "Presence-only clocking is not available while a sponsor licence is held. "
    "Exact attendance times must remain visible for Home Office monitoring duties."
)


def normalize_punch_time_mode(value: Any) -> PunchTimeMode:
    mode = str(value or DEFAULT_PUNCH_TIME_MODE).strip().lower()
    if mode not in PUNCH_TIME_MODES:
        raise ValueError("Clock display must be timestamped or presence_only.")
    return mode  # type: ignore[return-value]


def validate_punch_time_mode_choice(
    *,
    punch_time_mode: Any,
    holds_sponsor_licence: bool,
) -> PunchTimeMode:
    mode = normalize_punch_time_mode(punch_time_mode)
    if mode == "presence_only" and holds_sponsor_licence:
        raise ValueError(SPONSOR_PRESENCE_ONLY_BLOCKED)
    return mode
