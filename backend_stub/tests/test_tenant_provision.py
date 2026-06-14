"""Manual tenant provisioning helpers."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.master.tenant_provision import generate_temporary_password, list_provision_plans, resolve_trial_end


def test_generate_temporary_password_length() -> None:
    password = generate_temporary_password()
    assert password.startswith("Shift-")
    assert len(password) >= 12


def test_list_provision_plans_has_defaults() -> None:
    plans = list_provision_plans()
    assert plans
    ids = {plan["id"] for plan in plans}
    assert "site_medium_monthly" in ids


def test_resolve_trial_end_preserves_existing_future_end() -> None:
    now = datetime(2026, 6, 14, tzinfo=timezone.utc)
    existing = now + timedelta(days=9)
    end = resolve_trial_end(
        now=now,
        status="trialing",
        trial_days=None,
        existing_trial_end=existing,
    )
    assert end == existing


def test_resolve_trial_end_uses_explicit_days() -> None:
    now = datetime(2026, 6, 14, tzinfo=timezone.utc)
    existing = now + timedelta(days=9)
    end = resolve_trial_end(
        now=now,
        status="trialing",
        trial_days=21,
        existing_trial_end=existing,
    )
    assert end == now + timedelta(days=21)


def test_resolve_trial_end_active_clears() -> None:
    now = datetime(2026, 6, 14, tzinfo=timezone.utc)
    end = resolve_trial_end(
        now=now,
        status="active",
        trial_days=None,
        existing_trial_end=now + timedelta(days=5),
    )
    assert end is None
