"""Tests for punch_time_mode validation and sponsor-licence lock."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.punch_time_mode import (
    SPONSOR_PRESENCE_ONLY_BLOCKED,
    normalize_punch_time_mode,
    validate_punch_time_mode_choice,
)


def test_normalize_punch_time_mode_defaults() -> None:
    assert normalize_punch_time_mode(None) == "timestamped"
    assert normalize_punch_time_mode("") == "timestamped"
    assert normalize_punch_time_mode("presence_only") == "presence_only"
    assert normalize_punch_time_mode("TIMESTAMPED") == "timestamped"


def test_normalize_punch_time_mode_rejects_unknown() -> None:
    with pytest.raises(ValueError, match="timestamped or presence_only"):
        normalize_punch_time_mode("hidden")


def test_presence_only_blocked_for_sponsor_licence() -> None:
    with pytest.raises(ValueError, match="sponsor licence"):
        validate_punch_time_mode_choice(
            punch_time_mode="presence_only",
            holds_sponsor_licence=True,
        )


def test_presence_only_allowed_without_sponsor_licence() -> None:
    assert (
        validate_punch_time_mode_choice(
            punch_time_mode="presence_only",
            holds_sponsor_licence=False,
        )
        == "presence_only"
    )


def test_timestamped_always_allowed_for_sponsor() -> None:
    assert (
        validate_punch_time_mode_choice(
            punch_time_mode="timestamped",
            holds_sponsor_licence=True,
        )
        == "timestamped"
    )


def test_sponsor_block_message_is_explicit() -> None:
    assert "Home Office" in SPONSOR_PRESENCE_ONLY_BLOCKED
