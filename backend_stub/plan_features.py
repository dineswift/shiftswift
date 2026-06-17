"""Subscription tier feature flags — aligned to ShiftSwift HR strategy pricing."""

from __future__ import annotations

from typing import Any

STARTER_PLAN_IDS = frozenset({"site_starter_monthly", "site_starter_annual"})
GROWTH_PLAN_IDS = frozenset({"site_medium_monthly", "site_medium_annual"})
SCALE_PLAN_IDS = frozenset({"site_growth_monthly", "site_growth_annual"})

TIER_LABELS = {
    "starter": "Essentials",
    "growth": "Compliance",
    "scale": "Multi-site",
}

ROTA_MODES = ("basic", "advanced", "multi_site")

ROTA_MODE_LABELS = {
    "basic": "Basic — manual weekly grid",
    "advanced": "Advanced — templates, coverage & hours",
    "multi_site": "Multi-site — per-location rotas",
}


def allowed_rota_modes(
    *,
    rota_advanced_addon: bool = False,
    rota_multi_site_addon: bool = False,
) -> list[str]:
    """Basic manual rota is included on all plans; advanced modes require purchased add-ons."""
    options = ["basic"]
    if rota_advanced_addon:
        options.append("advanced")
    if rota_multi_site_addon:
        options.append("multi_site")
    return options


def default_rota_mode() -> str:
    return "basic"


def resolve_rota_mode(
    *,
    stored_mode: str | None,
    rota_advanced_addon: bool = False,
    rota_multi_site_addon: bool = False,
) -> str:
    options = allowed_rota_modes(
        rota_advanced_addon=rota_advanced_addon,
        rota_multi_site_addon=rota_multi_site_addon,
    )
    normalized = (stored_mode or "").strip().lower()
    if normalized in options:
        return normalized
    return default_rota_mode()


def apply_rota_features(
    feats: dict[str, object],
    *,
    stored_mode: str | None,
    rota_advanced_addon: bool = False,
    rota_multi_site_addon: bool = False,
) -> dict[str, object]:
    options = allowed_rota_modes(
        rota_advanced_addon=rota_advanced_addon,
        rota_multi_site_addon=rota_multi_site_addon,
    )
    mode = resolve_rota_mode(
        stored_mode=stored_mode,
        rota_advanced_addon=rota_advanced_addon,
        rota_multi_site_addon=rota_multi_site_addon,
    )
    feats["rota_mode"] = mode
    feats["rota_mode_options"] = options
    feats["rota_mode_default"] = default_rota_mode()
    feats["rota_advanced_addon"] = bool(rota_advanced_addon)
    feats["rota_multi_site_addon"] = bool(rota_multi_site_addon)
    feats["rota_advanced_enabled"] = bool(rota_advanced_addon) and mode in ("advanced", "multi_site")
    feats["rota_multi_site_enabled"] = bool(rota_multi_site_addon) and mode == "multi_site"
    return feats


def validate_rota_mode_choice(
    *,
    rota_mode: str | None,
    rota_advanced_addon: bool = False,
    rota_multi_site_addon: bool = False,
) -> str | None:
    """Return normalized mode to store, or raise ValueError."""
    if rota_mode is None or str(rota_mode).strip() == "":
        return None
    normalized = str(rota_mode).strip().lower()
    if normalized not in ROTA_MODES:
        raise ValueError("Rota mode must be basic, advanced, or multi_site")
    allowed = allowed_rota_modes(
        rota_advanced_addon=rota_advanced_addon,
        rota_multi_site_addon=rota_multi_site_addon,
    )
    if normalized not in allowed:
        if normalized == "advanced":
            raise ValueError("Advanced rota is a paid add-on — contact support to enable it on your account")
        if normalized == "multi_site":
            raise ValueError("Multi-site rota is a paid add-on — contact support to enable it on your account")
        raise ValueError(f"{ROTA_MODE_LABELS.get(normalized, normalized)} is not available on your account")
    return normalized


def plan_tier(plan_id: str | None) -> str:
    pid = (plan_id or "").strip()
    if pid in SCALE_PLAN_IDS or pid.startswith("enterprise"):
        return "scale"
    if pid in GROWTH_PLAN_IDS:
        return "growth"
    return "starter"


def plan_display_name(plan_id: str | None) -> str:
    return TIER_LABELS.get(plan_tier(plan_id), "Starter")


def features_for_plan(
    plan_id: str | None,
    *,
    payroll_enabled: bool,
    sponsored_employees: int = 0,
    trial_active: bool = False,
) -> dict[str, object]:
    tier = plan_tier(plan_id)
    growth_plus = tier in ("growth", "scale")
    if trial_active:
        growth_plus = True
    return {
        "plan_tier": tier,
        "plan_display_name": plan_display_name(plan_id),
        "payroll_enabled": False,
        "trial_active": bool(trial_active),
        "sponsor_compliance_enabled": growth_plus,
        "grievance_enabled": growth_plus,
        "disciplinary_enabled": growth_plus,
        "audit_export_enabled": growth_plus,
        "multi_site_enabled": tier == "scale",
        "api_access_enabled": tier == "scale",
        "sponsored_employees": sponsored_employees,
    }


def effective_features_for_tenant(
    *,
    plan_id: str | None,
    payroll_enabled: bool,
    sponsored_employees: int = 0,
    subscription_status: str | None = None,
    trial_access_allowed: bool = False,
) -> dict[str, object]:
    """Plan flags with active trial unlocking Growth-tier HR modules."""
    status = (subscription_status or "").strip().lower()
    trial_active = trial_access_allowed and status in {"trialing", "provisioning"}
    return features_for_plan(
        plan_id,
        payroll_enabled=payroll_enabled,
        sponsored_employees=sponsored_employees,
        trial_active=trial_active,
    )


def assert_tenant_feature(
    *,
    tenant_id: int,
    feature: str,
    conn: Any,
) -> None:
    """Raise HTTPException 403 when tenant plan (or trial) does not include a feature."""
    from admin_service import get_tenant_profile
    from trial_service import trial_snapshot

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    trial = trial_snapshot(tenant_id=tenant_id, conn=conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM employees WHERE tenant_id = %s AND is_sponsored = TRUE",
            (tenant_id,),
        )
        sponsored_employees = int(cur.fetchone()[0])
    feats = effective_features_for_tenant(
        plan_id=profile["subscription_plan"],
        payroll_enabled=bool(profile["payroll_enabled"]),
        sponsored_employees=sponsored_employees,
        subscription_status=profile.get("subscription_status"),
        trial_access_allowed=bool(trial.get("access_allowed")),
    )
    apply_rota_features(
        feats,
        stored_mode=profile.get("rota_mode_preference"),
        rota_advanced_addon=bool(profile.get("rota_advanced_addon")),
        rota_multi_site_addon=bool(profile.get("rota_multi_site_addon")),
    )
    flag = f"{feature}_enabled"
    if feats.get(flag):
        return
    from fastapi import HTTPException

    raise HTTPException(
        status_code=403,
        detail=UPGRADE_MESSAGES.get(feature, "Upgrade your plan to use this feature."),
    )


UPGRADE_MESSAGES = {
    "payroll": "Staff CSV export is not available on your plan yet.",
    "grievance": "Grievance workflows are included on Compliance and Multi-site plans.",
    "disciplinary": "Disciplinary workflows are included on Compliance and Multi-site plans.",
    "audit_export": "Home Office audit export is included on Compliance and Multi-site plans.",
    "sponsor_compliance": "Sponsor licence compliance is included on Compliance and Multi-site plans.",
    "multi_site": "Multi-site dashboard is included on the Multi-site plan.",
    "api_access": "API access is included on the Multi-site plan.",
    "rota_advanced": "Advanced rota is a paid add-on. Contact support to add it to your subscription.",
    "rota_multi_site": "Multi-site rota is a paid add-on. Contact support to add it to your subscription.",
}


def assert_plan_feature(
    plan_id: str | None,
    feature: str,
    *,
    payroll_enabled: bool = False,
) -> None:
    """Raise HTTPException 403 when the tenant plan does not include a feature."""
    from fastapi import HTTPException

    feats = features_for_plan(plan_id, payroll_enabled=payroll_enabled)
    flag = f"{feature}_enabled"
    if feats.get(flag):
        return
    raise HTTPException(
        status_code=403,
        detail=UPGRADE_MESSAGES.get(feature, "Upgrade your plan to use this feature."),
    )
