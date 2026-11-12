"""Per-head subscription quotes — base + active employees, with monthly cap."""

from __future__ import annotations

from typing import Any, Protocol


class PlanPricing(Protocol):
    base_price_gbp_ex_vat: float
    price_per_active_employee_gbp_ex_vat: float
    monthly_cap_gbp_ex_vat: float | None
    price_gbp_ex_vat: float
    max_employees: int


def plan_base_price(plan: PlanPricing) -> float:
    base = getattr(plan, "base_price_gbp_ex_vat", None)
    if base is not None and float(base) > 0:
        return float(base)
    return float(plan.price_gbp_ex_vat)


def plan_per_head_price(plan: PlanPricing) -> float:
    return float(getattr(plan, "price_per_active_employee_gbp_ex_vat", 0) or 0)


def plan_monthly_cap(plan: PlanPricing) -> float | None:
    cap = getattr(plan, "monthly_cap_gbp_ex_vat", None)
    if cap is None:
        return None
    value = float(cap)
    return value if value > 0 else None


def calculate_monthly_quote(
    plan: PlanPricing,
    *,
    active_employees: int,
) -> dict[str, Any]:
    """Return ex-VAT monthly bill for a plan and active headcount."""
    seats = max(0, int(active_employees))
    billable_seats = billable_seat_quantity(plan, seats)
    base = plan_base_price(plan)
    per_head = plan_per_head_price(plan)
    variable = round(billable_seats * per_head, 2)
    subtotal = round(base + variable, 2)
    cap = plan_monthly_cap(plan)
    capped = round(min(subtotal, cap), 2) if cap is not None else subtotal
    return {
        "active_employees": seats,
        "billable_seats": billable_seats,
        "base_gbp_ex_vat": base,
        "per_head_gbp_ex_vat": per_head,
        "variable_gbp_ex_vat": variable,
        "subtotal_gbp_ex_vat": subtotal,
        "monthly_cap_gbp_ex_vat": cap,
        "total_gbp_ex_vat": capped,
        "total_gbp_inc_vat": round(capped * 1.2, 2),
        "cap_applied": seats > billable_seats,
    }


def max_billable_seats_under_cap(plan: PlanPricing) -> int | None:
    """Seat quantity at which base + seats × per-head reaches the monthly cap."""
    cap = plan_monthly_cap(plan)
    per_head = plan_per_head_price(plan)
    base = plan_base_price(plan)
    if cap is None or per_head <= 0:
        return None
    return max(0, int((cap - base) // per_head))


def billable_seat_quantity(plan: PlanPricing, active_employees: int) -> int:
    """Stripe seat line quantity — active employees capped so invoice ≤ monthly cap."""
    seats = max(0, int(active_employees))
    max_under_cap = max_billable_seats_under_cap(plan)
    if max_under_cap is not None:
        return min(seats, max_under_cap)
    return seats


def estimate_monthly_total(plan: PlanPricing, *, active_employees: int) -> float:
    return float(calculate_monthly_quote(plan, active_employees=active_employees)["total_gbp_ex_vat"])


def example_headcounts(plan: PlanPricing) -> list[int]:
    """Headcounts for marketing examples (5, 10, 20) within plan max."""
    cap = plan.max_employees
    samples = [5, 10, 20]
    return [n for n in samples if n <= cap] or [min(5, cap)]


# Sales-led offline billing — discrete staff license tiers for quoting / invoicing.
# Stripe self-serve pricing is unchanged; these are master-console invoice list prices (ex VAT).
OFFLINE_VAT_RATE = 0.20
OFFLINE_TIER_INCREMENT_GBP = 10.0

OFFLINE_ESSENTIALS_TIERS: tuple[int, ...] = (10, 20, 30, 40)
OFFLINE_ESSENTIALS_BASE_GBP_EX_VAT = 15.0

OFFLINE_COMPLIANCE_TIERS: tuple[int, ...] = (10, 20, 30, 40, 50, 60, 75, 100)
OFFLINE_COMPLIANCE_BASE_GBP_EX_VAT = 15.0
OFFLINE_COMPLIANCE_MONTHLY_CAP_GBP_EX_VAT = 79.0

OFFLINE_MULTISITE_TIERS: tuple[int, ...] = (10, 20, 30, 40, 50, 60, 75, 100, 150, 200)
OFFLINE_MULTISITE_BASE_GBP_EX_VAT = 29.0
OFFLINE_MULTISITE_MONTHLY_CAP_GBP_EX_VAT = 129.0

OFFLINE_STAFF_TIER_LIMITS: tuple[int, ...] = (
    10,
    20,
    30,
    40,
    50,
    60,
    75,
    100,
    150,
    200,
)


def _plan_id(plan: PlanPricing) -> str:
    return str(getattr(plan, "id", "") or "")


def offline_staff_tier_limits(plan: PlanPricing) -> tuple[int, ...]:
    plan_id = _plan_id(plan)
    max_staff = int(plan.max_employees)
    if plan_id == "site_starter_monthly":
        return tuple(limit for limit in OFFLINE_ESSENTIALS_TIERS if limit <= max_staff)
    if plan_id == "site_medium_monthly":
        return tuple(limit for limit in OFFLINE_COMPLIANCE_TIERS if limit <= max_staff)
    if plan_id == "site_growth_monthly":
        return tuple(limit for limit in OFFLINE_MULTISITE_TIERS if limit <= max_staff)
    return tuple(limit for limit in OFFLINE_STAFF_TIER_LIMITS if limit <= max_staff)


def _offline_incremental_tier_price(
    *,
    tiers: tuple[int, ...],
    max_employees: int,
    base_gbp_ex_vat: float,
    increment_gbp_ex_vat: float,
    monthly_cap_gbp_ex_vat: float | None = None,
) -> tuple[float, bool]:
    limit = int(max_employees)
    if limit not in tiers:
        raise ValueError(f"Offline tiers are: {', '.join(map(str, tiers))}")
    index = tiers.index(limit)
    uncapped = base_gbp_ex_vat + index * increment_gbp_ex_vat
    if monthly_cap_gbp_ex_vat is None:
        return round(uncapped, 2), False
    capped = min(uncapped, monthly_cap_gbp_ex_vat)
    return round(capped, 2), uncapped > monthly_cap_gbp_ex_vat


def offline_tier_list_price_ex_vat(*, plan_id: str, max_employees: int) -> float:
    """Invoice list price for a staff license bracket (ex VAT)."""
    limit = int(max_employees)
    if plan_id == "site_starter_monthly":
        price, _ = _offline_incremental_tier_price(
            tiers=OFFLINE_ESSENTIALS_TIERS,
            max_employees=limit,
            base_gbp_ex_vat=OFFLINE_ESSENTIALS_BASE_GBP_EX_VAT,
            increment_gbp_ex_vat=OFFLINE_TIER_INCREMENT_GBP,
        )
        return price

    if plan_id == "site_medium_monthly":
        price, _ = _offline_incremental_tier_price(
            tiers=OFFLINE_COMPLIANCE_TIERS,
            max_employees=limit,
            base_gbp_ex_vat=OFFLINE_COMPLIANCE_BASE_GBP_EX_VAT,
            increment_gbp_ex_vat=OFFLINE_TIER_INCREMENT_GBP,
            monthly_cap_gbp_ex_vat=OFFLINE_COMPLIANCE_MONTHLY_CAP_GBP_EX_VAT,
        )
        return price

    if plan_id == "site_growth_monthly":
        price, _ = _offline_incremental_tier_price(
            tiers=OFFLINE_MULTISITE_TIERS,
            max_employees=limit,
            base_gbp_ex_vat=OFFLINE_MULTISITE_BASE_GBP_EX_VAT,
            increment_gbp_ex_vat=OFFLINE_TIER_INCREMENT_GBP,
            monthly_cap_gbp_ex_vat=OFFLINE_MULTISITE_MONTHLY_CAP_GBP_EX_VAT,
        )
        return price

    quote = calculate_monthly_quote(
        _FallbackPlanPricing(plan_id=plan_id, max_employees=limit),
        active_employees=limit,
    )
    return float(quote["total_gbp_ex_vat"])


class _FallbackPlanPricing:
    """Minimal plan stand-in when offline table has no explicit row."""

    def __init__(self, *, plan_id: str, max_employees: int) -> None:
        from billing_config import get_plan

        plan = get_plan(plan_id)
        self.id = plan_id
        self.max_employees = max_employees
        if plan:
            self.base_price_gbp_ex_vat = plan.base_price_gbp_ex_vat
            self.price_per_active_employee_gbp_ex_vat = plan.price_per_active_employee_gbp_ex_vat
            self.monthly_cap_gbp_ex_vat = plan.monthly_cap_gbp_ex_vat
            self.price_gbp_ex_vat = plan.price_gbp_ex_vat
        else:
            self.base_price_gbp_ex_vat = 0.0
            self.price_per_active_employee_gbp_ex_vat = 0.0
            self.monthly_cap_gbp_ex_vat = None
            self.price_gbp_ex_vat = 0.0


def offline_staff_tiers(plan: PlanPricing) -> list[dict[str, Any]]:
    """Per-tier list price (ex/inc VAT) for manual billing."""
    plan_id = _plan_id(plan)
    tiers: list[dict[str, Any]] = []
    for limit in offline_staff_tier_limits(plan):
        try:
            if plan_id == "site_starter_monthly":
                ex_vat, cap_applied = _offline_incremental_tier_price(
                    tiers=OFFLINE_ESSENTIALS_TIERS,
                    max_employees=limit,
                    base_gbp_ex_vat=OFFLINE_ESSENTIALS_BASE_GBP_EX_VAT,
                    increment_gbp_ex_vat=OFFLINE_TIER_INCREMENT_GBP,
                )
            elif plan_id == "site_medium_monthly":
                ex_vat, cap_applied = _offline_incremental_tier_price(
                    tiers=OFFLINE_COMPLIANCE_TIERS,
                    max_employees=limit,
                    base_gbp_ex_vat=OFFLINE_COMPLIANCE_BASE_GBP_EX_VAT,
                    increment_gbp_ex_vat=OFFLINE_TIER_INCREMENT_GBP,
                    monthly_cap_gbp_ex_vat=OFFLINE_COMPLIANCE_MONTHLY_CAP_GBP_EX_VAT,
                )
            elif plan_id == "site_growth_monthly":
                ex_vat, cap_applied = _offline_incremental_tier_price(
                    tiers=OFFLINE_MULTISITE_TIERS,
                    max_employees=limit,
                    base_gbp_ex_vat=OFFLINE_MULTISITE_BASE_GBP_EX_VAT,
                    increment_gbp_ex_vat=OFFLINE_TIER_INCREMENT_GBP,
                    monthly_cap_gbp_ex_vat=OFFLINE_MULTISITE_MONTHLY_CAP_GBP_EX_VAT,
                )
            else:
                ex_vat = offline_tier_list_price_ex_vat(plan_id=plan_id, max_employees=limit)
                cap_applied = False
        except ValueError:
            continue
        tiers.append(
            {
                "max_employees": limit,
                "quote_gbp_ex_vat": ex_vat,
                "quote_gbp_inc_vat": round(ex_vat * (1 + OFFLINE_VAT_RATE), 2),
                "cap_applied": cap_applied,
                "offline_pricing": True,
            }
        )
    if not tiers:
        limit = int(plan.max_employees)
        quote = calculate_monthly_quote(plan, active_employees=limit)
        tiers.append(
            {
                "max_employees": limit,
                "quote_gbp_ex_vat": quote["total_gbp_ex_vat"],
                "quote_gbp_inc_vat": quote["total_gbp_inc_vat"],
                "cap_applied": bool(quote["cap_applied"]),
                "offline_pricing": False,
            }
        )
    return tiers


def offline_pricing_summary(plan_id: str) -> dict[str, Any]:
    """Human-readable offline pricing rules for master console hints."""
    if plan_id == "site_starter_monthly":
        return {
            "model": "incremental",
            "base_gbp_ex_vat": OFFLINE_ESSENTIALS_BASE_GBP_EX_VAT,
            "increment_gbp_ex_vat": OFFLINE_TIER_INCREMENT_GBP,
            "tier_limits": list(OFFLINE_ESSENTIALS_TIERS),
            "note": f"£{OFFLINE_ESSENTIALS_BASE_GBP_EX_VAT:.0f} ex VAT up to 10 staff, +£{OFFLINE_TIER_INCREMENT_GBP:.0f} per bracket (20/30/40).",
        }
    if plan_id == "site_medium_monthly":
        return {
            "model": "incremental_capped",
            "base_gbp_ex_vat": OFFLINE_COMPLIANCE_BASE_GBP_EX_VAT,
            "increment_gbp_ex_vat": OFFLINE_TIER_INCREMENT_GBP,
            "monthly_cap_gbp_ex_vat": OFFLINE_COMPLIANCE_MONTHLY_CAP_GBP_EX_VAT,
            "tier_limits": list(OFFLINE_COMPLIANCE_TIERS),
            "note": (
                f"£{OFFLINE_COMPLIANCE_BASE_GBP_EX_VAT:.0f} ex VAT up to 10 staff, "
                f"+£{OFFLINE_TIER_INCREMENT_GBP:.0f} per bracket (20/30/…), "
                f"£{OFFLINE_COMPLIANCE_MONTHLY_CAP_GBP_EX_VAT:.0f} monthly cap."
            ),
        }
    if plan_id == "site_growth_monthly":
        return {
            "model": "incremental_capped",
            "base_gbp_ex_vat": OFFLINE_MULTISITE_BASE_GBP_EX_VAT,
            "increment_gbp_ex_vat": OFFLINE_TIER_INCREMENT_GBP,
            "monthly_cap_gbp_ex_vat": OFFLINE_MULTISITE_MONTHLY_CAP_GBP_EX_VAT,
            "tier_limits": list(OFFLINE_MULTISITE_TIERS),
            "note": (
                f"£{OFFLINE_MULTISITE_BASE_GBP_EX_VAT:.0f} ex VAT base, +£{OFFLINE_TIER_INCREMENT_GBP:.0f} per bracket, "
                f"£{OFFLINE_MULTISITE_MONTHLY_CAP_GBP_EX_VAT:.0f} cap."
            ),
        }
    return {"model": "stripe_catalog", "note": "Uses Stripe catalog formula."}


def plan_pricing_payload(plan: PlanPricing) -> dict[str, Any]:
    base = plan_base_price(plan)
    per_head = plan_per_head_price(plan)
    cap = plan_monthly_cap(plan)
    examples = [
        {"active_employees": n, **calculate_monthly_quote(plan, active_employees=n)}
        for n in example_headcounts(plan)
    ]
    return {
        "billing_model": "base_plus_per_head" if per_head > 0 else "flat",
        "base_price_gbp_ex_vat": base,
        "price_per_active_employee_gbp_ex_vat": per_head,
        "monthly_cap_gbp_ex_vat": cap,
        "from_price_gbp_ex_vat": base,
        "example_quotes": examples,
    }
