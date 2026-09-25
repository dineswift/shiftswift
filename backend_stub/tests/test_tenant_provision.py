"""Manual tenant provisioning helpers."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.master.tenant_provision import (
    create_tenant_manually,
    generate_temporary_password,
    list_provision_plans,
    resolve_trial_end,
)


def test_generate_temporary_password_length() -> None:
    password = generate_temporary_password()
    assert password.startswith("Shift-")
    assert len(password) >= 12


def test_list_provision_plans_has_defaults() -> None:
    plans = list_provision_plans()
    assert plans
    ids = {plan["id"] for plan in plans}
    assert "site_medium_monthly" in ids
    compliance = next(plan for plan in plans if plan["id"] == "site_medium_monthly")
    tiers = compliance["staff_tiers"]
    assert tiers
    limits = [tier["max_employees"] for tier in tiers]
    assert 10 in limits
    assert 20 in limits
    assert all("quote_gbp_ex_vat" in tier for tier in tiers)
    by_limit = {tier["max_employees"]: tier["quote_gbp_ex_vat"] for tier in tiers}
    assert by_limit[10] == 15.0
    assert by_limit[20] == 25.0
    assert by_limit[30] == 35.0
    assert by_limit[100] == 79.0


def test_offline_compliance_incremental_then_cap() -> None:
    from billing_config import get_plan
    from billing_pricing import offline_staff_tiers

    plan = get_plan("site_medium_monthly")
    assert plan is not None
    by_limit = {tier["max_employees"]: tier for tier in offline_staff_tiers(plan)}
    assert by_limit[10]["quote_gbp_ex_vat"] == 15.0
    assert by_limit[20]["quote_gbp_ex_vat"] == 25.0
    assert by_limit[30]["quote_gbp_ex_vat"] == 35.0
    assert by_limit[40]["quote_gbp_ex_vat"] == 45.0
    assert by_limit[75]["quote_gbp_ex_vat"] == 75.0
    assert by_limit[100]["quote_gbp_ex_vat"] == 79.0
    assert by_limit[100]["cap_applied"] is True


def test_offline_essentials_incremental_prices() -> None:
    from billing_config import get_plan
    from billing_pricing import offline_staff_tiers

    plan = get_plan("site_starter_monthly")
    assert plan is not None
    by_limit = {tier["max_employees"]: tier for tier in offline_staff_tiers(plan)}
    assert set(by_limit) == {10, 20, 30, 40}
    assert by_limit[10]["quote_gbp_ex_vat"] == 15.0
    assert by_limit[10]["quote_gbp_inc_vat"] == 18.0
    assert by_limit[20]["quote_gbp_ex_vat"] == 25.0
    assert by_limit[30]["quote_gbp_ex_vat"] == 35.0
    assert by_limit[40]["quote_gbp_ex_vat"] == 45.0


def test_offline_staff_tiers_respect_plan_cap() -> None:
    from billing_config import get_plan
    from billing_pricing import offline_staff_tiers

    starter = get_plan("site_starter_monthly")
    assert starter is not None
    tiers = offline_staff_tiers(starter)
    assert tiers
    assert all(tier["max_employees"] <= starter.max_employees for tier in tiers)
    assert tiers[-1]["max_employees"] <= starter.max_employees


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


def test_offline_trialing_rejected(monkeypatch) -> None:
    from modules.master import tenant_provision as tp

    monkeypatch.setattr(tp, "_business_email_registered", lambda conn, email: False)
    conn = __import__("unittest.mock").mock.MagicMock()
    try:
        create_tenant_manually(
            conn=conn,
            master_tenant_id=999,
            business_name="Test Co",
            billing_email="new@example.com",
            admin_password="Password123!",
            plan_id="site_medium_monthly",
            billing_mode="offline",
            access="trialing",
        )
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "Offline" in str(exc)
