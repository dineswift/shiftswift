"""Sync Stripe subscription seat quantity to active employees (with monthly cap)."""

from __future__ import annotations

import logging
from typing import Any

from billing_config import stripe_settings
from billing_plans import SubscriptionPlan, get_plan, resolve_stripe_price_id, resolve_stripe_seat_price_id
from billing_pricing import billable_seat_quantity, calculate_monthly_quote, plan_per_head_price

logger = logging.getLogger(__name__)

ACTIVE_EMPLOYEE_STATUSES = ("active", "onboarding", "suspended")


def count_active_employees(*, tenant_id: int, conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM employees
            WHERE tenant_id = %s AND status IN ('active', 'onboarding', 'suspended')
            """,
            (tenant_id,),
        )
        return int(cur.fetchone()[0])


def build_platform_subscription_items(
    *,
    plan: SubscriptionPlan,
    conn: Any,
    tenant_id: int,
    active_employees_override: int | None = None,
) -> list[dict[str, object]]:
    """Stripe subscription items for platform base + per-seat billing."""
    price_id = resolve_stripe_price_id(plan)
    if not price_id:
        raise ValueError(f"Missing Stripe base price for plan {plan.id}")

    items: list[dict[str, object]] = [{"price": price_id, "quantity": 1}]
    seat_price_id = resolve_stripe_seat_price_id(plan)
    if seat_price_id and plan_per_head_price(plan) > 0:
        active = (
            max(0, int(active_employees_override))
            if active_employees_override is not None
            else count_active_employees(tenant_id=tenant_id, conn=conn)
        )
        billable = billable_seat_quantity(plan, active)
        items.append({"price": seat_price_id, "quantity": billable})
    return items


def sync_tenant_stripe_seats(*, tenant_id: int, conn: Any) -> dict[str, object]:
    """Update Stripe seat subscription item quantity for a tenant."""
    cfg = stripe_settings()
    if not cfg["secret_key"]:
        return {"synced": False, "reason": "stripe_not_configured"}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT subscription_plan, stripe_subscription_id, subscription_status
            FROM tenants WHERE id = %s
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
    if not row:
        return {"synced": False, "reason": "tenant_not_found"}

    plan_id, subscription_id, subscription_status = row
    if not subscription_id:
        return {"synced": False, "reason": "no_stripe_subscription"}

    plan = get_plan(plan_id)
    if not plan:
        return {"synced": False, "reason": "unknown_plan", "plan_id": plan_id}

    per_head = plan_per_head_price(plan)
    if per_head <= 0:
        return {"synced": False, "reason": "flat_plan"}

    seat_price_id = resolve_stripe_seat_price_id(plan)
    if not seat_price_id:
        return {"synced": False, "reason": "seat_price_not_configured", "plan_id": plan.id}

    active = count_active_employees(tenant_id=tenant_id, conn=conn)
    billable = billable_seat_quantity(plan, active)
    quote = calculate_monthly_quote(plan, active_employees=active)

    try:
        import stripe

        stripe.api_key = cfg["secret_key"]
        subscription = stripe.Subscription.retrieve(subscription_id, expand=["items.data.price"])
        seat_item_id = None
        for item in subscription["items"]["data"]:
            price = item.get("price") or {}
            if price.get("id") == seat_price_id:
                seat_item_id = item["id"]
                break

        if seat_item_id:
            stripe.SubscriptionItem.modify(seat_item_id, quantity=billable)
        else:
            stripe.SubscriptionItem.create(
                subscription=subscription_id,
                price=seat_price_id,
                quantity=billable,
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Stripe seat sync failed for tenant %s", tenant_id)
        return {
            "synced": False,
            "reason": "stripe_error",
            "detail": str(exc),
            "active_employees": active,
            "billable_seats": billable,
        }

    return {
        "synced": True,
        "tenant_id": tenant_id,
        "subscription_status": subscription_status,
        "active_employees": active,
        "billable_seats": billable,
        "estimated_mrr_ex_vat": quote["total_gbp_ex_vat"],
        "cap_applied": quote["cap_applied"],
    }


def maybe_sync_tenant_stripe_seats(*, tenant_id: int, conn: Any) -> None:
    """Best-effort seat sync — never raises (employee CRUD must succeed)."""
    try:
        result = sync_tenant_stripe_seats(tenant_id=tenant_id, conn=conn)
        if not result.get("synced") and result.get("reason") not in {
            "stripe_not_configured",
            "no_stripe_subscription",
            "flat_plan",
            "seat_price_not_configured",
        }:
            logger.warning("Seat sync skipped/failed for tenant %s: %s", tenant_id, result)
    except Exception:
        logger.exception("Unexpected seat sync failure for tenant %s", tenant_id)
