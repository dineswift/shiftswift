"""Unit tests for EPOS till punch integration."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.epos import (
    _hash_integration_token,
    _is_pin_rate_limited,
    _record_failed_pin,
    resolve_toggle_punch_type,
)


def test_hash_integration_token_is_stable() -> None:
    assert _hash_integration_token("sshr_epos_abc") == _hash_integration_token("sshr_epos_abc")
    assert _hash_integration_token("sshr_epos_abc") != _hash_integration_token("sshr_epos_xyz")


def test_resolve_toggle_punch_type() -> None:
    assert resolve_toggle_punch_type("off") == "in"
    assert resolve_toggle_punch_type("clocked_in") == "out"
    assert resolve_toggle_punch_type("on_break") == "break_end"


def test_pin_rate_limit_blocks_after_threshold() -> None:
    token_id = 999_001
    employee_id = 42
    for _ in range(10):
        _record_failed_pin(token_id=token_id, employee_id=employee_id)
    assert _is_pin_rate_limited(token_id=token_id, employee_id=employee_id)
