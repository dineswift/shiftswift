"""Stripe Billing configuration and B2B subscription tiers."""

from __future__ import annotations

import os
from dataclasses import dataclass

from billing_pricing import plan_pricing_payload


@dataclass(frozen=True)
class SubscriptionPlan:
    id: str
    name: str
    description: str
    stripe_price_id_env: str
    billing_interval: str
    max_employees: int
    price_gbp_ex_vat: float
    features: tuple[str, ...]
    base_price_gbp_ex_vat: float
    price_per_active_employee_gbp_ex_vat: float
    monthly_cap_gbp_ex_vat: float | None
    stripe_seat_price_id_env: str = ""
    level_label: str = ""


# Base + per active employee, hard monthly cap (strategy 2026).
# Stripe: each plan uses two recurring Prices — base + per-seat (quantity = active employees).
PLANS: tuple[SubscriptionPlan, ...] = (
    SubscriptionPlan(
        id="site_starter_monthly",
        name="Essentials",
        description="HR records, RTW checks, and geofenced time clock.",
        stripe_price_id_env="STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY",
        stripe_seat_price_id_env="STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY",
        billing_interval="month",
        max_employees=40,
        price_gbp_ex_vat=9.0,
        base_price_gbp_ex_vat=9.0,
        price_per_active_employee_gbp_ex_vat=2.0,
        monthly_cap_gbp_ex_vat=49.0,
        level_label="Level 1 · Small sites",
        features=(
            "Employee records & lifecycle",
            "Right-to-work checks",
            "Geofenced time clock (mobile PWA)",
            "Payroll CSV export · BrightPay & Xero",
            "Document storage",
            "Email support",
        ),
    ),
    SubscriptionPlan(
        id="site_medium_monthly",
        name="Compliance",
        description="Sponsor licence duties, day-9 absence alerts, and Home Office audit exports.",
        stripe_price_id_env="STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY",
        stripe_seat_price_id_env="STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY",
        billing_interval="month",
        max_employees=100,
        price_gbp_ex_vat=19.0,
        base_price_gbp_ex_vat=19.0,
        price_per_active_employee_gbp_ex_vat=3.0,
        monthly_cap_gbp_ex_vat=79.0,
        level_label="Level 2 · Sponsor licence",
        features=(
            "Everything in Essentials",
            "Day-9 absence alerts (clock-in linked)",
            "Sponsor licence compliance",
            "Home Office audit export",
            "Grievance workflows",
            "SMS alerts · Priority support",
        ),
    ),
    SubscriptionPlan(
        id="site_growth_monthly",
        name="Multi-site",
        description="Consolidated compliance across locations — API and account support.",
        stripe_price_id_env="STRIPE_PRICE_MULTISITE_BASE_MONTHLY",
        stripe_seat_price_id_env="STRIPE_PRICE_MULTISITE_SEAT_MONTHLY",
        billing_interval="month",
        max_employees=200,
        price_gbp_ex_vat=29.0,
        base_price_gbp_ex_vat=29.0,
        price_per_active_employee_gbp_ex_vat=2.0,
        monthly_cap_gbp_ex_vat=129.0,
        level_label="Level 3 · Multi-site groups",
        features=(
            "Everything in Compliance",
            "Multi-site dashboard",
            "Custom onboarding workflows",
            "API access",
            "Dedicated account manager",
        ),
    ),
)


def get_plan(plan_id: str) -> SubscriptionPlan | None:
    return next((plan for plan in PLANS if plan.id == plan_id), None)


def resolve_stripe_seat_price_id(plan: SubscriptionPlan) -> str | None:
    seat = getattr(plan, "stripe_seat_price_id", None)
    if seat:
        return seat
    env_key = getattr(plan, "stripe_seat_price_id_env", "") or ""
    if env_key:
        return os.getenv(env_key) or None
    return None


def stripe_payment_method_types() -> list[str]:
    """UK B2B default: Bacs Direct Debit + card backup."""
    raw = os.getenv("STRIPE_PAYMENT_METHOD_TYPES", os.getenv("STRIPE_PAYMENT_METHODS", "bacs_debit,card"))
    methods = [part.strip() for part in raw.split(",") if part.strip()]
    return methods or ["bacs_debit", "card"]


def stripe_settings() -> dict[str, str | bool]:
    return {
        "secret_key": os.getenv("STRIPE_SECRET_KEY", ""),
        "webhook_secret": os.getenv("STRIPE_WEBHOOK_SECRET", ""),
        "tax_enabled": os.getenv("STRIPE_TAX_ENABLED", "1").lower() in {"1", "true", "yes"},
        "currency": os.getenv("STRIPE_CURRENCY", "gbp"),
        "configured": bool(os.getenv("STRIPE_SECRET_KEY")),
        "direct_debit_enabled": "bacs_debit" in stripe_payment_method_types(),
    }


def plan_catalog() -> list[dict[str, object]]:
    settings = stripe_settings()
    items: list[dict[str, object]] = []
    for plan in PLANS:
        price_id = os.getenv(plan.stripe_price_id_env, "")
        seat_price_id = resolve_stripe_seat_price_id(plan) or ""
        payload = plan_pricing_payload(plan)
        items.append(
            {
                "id": plan.id,
                "name": plan.name,
                "description": plan.description,
                "billing_interval": plan.billing_interval,
                "max_employees": plan.max_employees,
                "price_gbp_ex_vat": plan.base_price_gbp_ex_vat,
                "price_gbp_inc_vat": round(plan.base_price_gbp_ex_vat * 1.2, 2),
                "vat_rate": "20%",
                "features": list(plan.features),
                "stripe_price_configured": bool(price_id),
                "stripe_seat_price_configured": bool(seat_price_id),
                "level_label": plan.level_label,
                **payload,
            }
        )
    items.append(
        {
            "billing_model": "base_plus_per_head",
            "note": (
                "UK B2B SaaS — base fee plus per active employee, capped monthly. "
                "VAT at 20% via Stripe Tax when enabled."
            ),
            "stripe_configured": settings["configured"],
            "stripe_tax_enabled": settings["tax_enabled"],
        }
    )
    return items
