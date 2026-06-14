from __future__ import annotations

from plan_features import (
    allowed_rota_modes,
    apply_rota_features,
    default_rota_mode,
    effective_features_for_tenant,
    features_for_plan,
    resolve_rota_mode,
    validate_rota_mode_choice,
)


def test_starter_plan_hides_growth_features() -> None:
    feats = features_for_plan("site_starter_monthly", payroll_enabled=False)
    assert feats["payroll_enabled"] is False
    assert feats["grievance_enabled"] is False
    assert feats["sponsor_compliance_enabled"] is False


def test_trial_unlocks_growth_features_on_starter() -> None:
    feats = effective_features_for_tenant(
        plan_id="site_starter_monthly",
        payroll_enabled=False,
        subscription_status="trialing",
        trial_access_allowed=True,
    )
    assert feats["trial_active"] is True
    assert feats["grievance_enabled"] is True
    assert feats["sponsor_compliance_enabled"] is True
    assert feats["payroll_enabled"] is False


def test_basic_rota_on_all_plans_without_addons() -> None:
    assert allowed_rota_modes() == ["basic"]
    assert default_rota_mode() == "basic"
    assert resolve_rota_mode(stored_mode="advanced") == "basic"


def test_advanced_addon_unlocks_advanced_mode() -> None:
    options = allowed_rota_modes(rota_advanced_addon=True)
    assert options == ["basic", "advanced"]
    feats: dict[str, object] = {}
    apply_rota_features(feats, stored_mode="advanced", rota_advanced_addon=True)
    assert feats["rota_mode"] == "advanced"
    assert feats["rota_advanced_enabled"] is True
    assert feats["rota_multi_site_enabled"] is False


def test_multi_site_addon_unlocks_multi_site_mode() -> None:
    options = allowed_rota_modes(rota_advanced_addon=True, rota_multi_site_addon=True)
    assert "multi_site" in options
    feats: dict[str, object] = {}
    apply_rota_features(
        feats,
        stored_mode="multi_site",
        rota_advanced_addon=True,
        rota_multi_site_addon=True,
    )
    assert feats["rota_multi_site_enabled"] is True


def test_validate_rota_mode_requires_addon() -> None:
    try:
        validate_rota_mode_choice(rota_mode="advanced", rota_advanced_addon=False)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "add-on" in str(exc).lower()
