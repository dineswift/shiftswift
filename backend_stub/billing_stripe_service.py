"""Auto-provision Stripe customer + subscription when a tenant registers."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from billing_plans import SubscriptionPlan, resolve_stripe_price_id
from billing_promotions import PromotionResult, record_promotion_redemption
from billing_config import stripe_settings
from billing_seat_sync import build_platform_subscription_items, sync_tenant_stripe_seats
from billing_stripe_checkout import create_direct_debit_mandate_session
from payroll_plans import PayrollPlan, resolve_stripe_price_id as resolve_payroll_stripe_price_id
from trial_service import DEFAULT_TRIAL_DAYS


def cancel_stripe_subscription(*, subscription_id: str) -> dict[str, object]:
    """Cancel a Stripe subscription (e.g. when switching tenant to offline billing)."""
    import logging

    logger = logging.getLogger(__name__)
    cfg = stripe_settings()
    if not cfg["secret_key"]:
        return {"cancelled": False, "reason": "stripe_not_configured"}
    if not subscription_id:
        return {"cancelled": False, "reason": "missing_subscription_id"}

    import stripe

    stripe.api_key = cfg["secret_key"]
    try:
        stripe.Subscription.cancel(subscription_id)
        return {"cancelled": True, "subscription_id": subscription_id}
    except Exception as exc:
        logger.exception("Stripe subscription cancel failed for %s", subscription_id)
        return {"cancelled": False, "subscription_id": subscription_id, "reason": str(exc)}


def provision_tenant_billing(
    *,
    conn: Any,
    tenant_id: int,
    business_name: str,
    billing_email: str,
    plan: SubscriptionPlan,
    start_trial: bool,
    promotion: PromotionResult,
    vat_number: str | None = None,
    payroll_plan: PayrollPlan | None = None,
    expected_active_employees: int | None = None,
) -> dict[str, object]:
    cfg = stripe_settings()
    trial_days = (DEFAULT_TRIAL_DAYS if start_trial else 0) + promotion.extra_trial_days
    trial_end = datetime.now(timezone.utc) + timedelta(days=trial_days) if trial_days else None

    stripe_customer_id = None
    stripe_subscription_id = None
    checkout_url = None
    subscription_status = "trialing" if trial_days else "pending_payment"

    price_id = resolve_stripe_price_id(plan)
    payroll_price_id = resolve_payroll_stripe_price_id(payroll_plan) if payroll_plan else None

    if cfg["secret_key"] and price_id:
        import stripe

        stripe.api_key = cfg["secret_key"]

        customer = stripe.Customer.create(
            email=billing_email,
            name=business_name,
            metadata={
                "tenant_id": str(tenant_id),
                "plan_id": plan.id,
                "payroll_plan_id": payroll_plan.id if payroll_plan else "",
                "platform": "hr",
            },
        )
        stripe_customer_id = customer.id
        if vat_number:
            try:
                stripe.Customer.create_tax_id(
                    stripe_customer_id,
                    type="gb_vat",
                    value=vat_number,
                )
            except Exception:
                pass

        line_items = build_platform_subscription_items(
            plan=plan,
            conn=conn,
            tenant_id=tenant_id,
            active_employees_override=expected_active_employees,
        )
        if payroll_price_id:
            line_items.append({"price": payroll_price_id, "quantity": 1})

        subscription_kwargs: dict[str, object] = {
            "customer": stripe_customer_id,
            "items": line_items,
            "metadata": {
                "tenant_id": str(tenant_id),
                "plan_id": plan.id,
                "payroll_plan_id": payroll_plan.id if payroll_plan else "",
                "discount_code": promotion.discount_code or "",
                "referral_code": promotion.referral_code or "",
            },
        }
        if trial_days:
            subscription_kwargs["trial_period_days"] = trial_days
        if promotion.stripe_coupon_ids:
            subscription_kwargs["discounts"] = [{"coupon": cid} for cid in promotion.stripe_coupon_ids]

        subscription = stripe.Subscription.create(**subscription_kwargs)
        stripe_subscription_id = subscription.id
        subscription_status = subscription.status or subscription_status
        sync_tenant_stripe_seats(tenant_id=tenant_id, conn=conn)

        if subscription.status in {"incomplete", "trialing"}:
            try:
                session = create_direct_debit_mandate_session(
                    tenant_id=tenant_id,
                    customer_id=stripe_customer_id,
                    success_url=os.getenv(
                        "BILLING_SETUP_SUCCESS_URL",
                        "http://localhost:5173/signup-success.html?tenant=" + str(tenant_id),
                    ),
                    cancel_url=os.getenv(
                        "BILLING_SETUP_CANCEL_URL",
                        "http://localhost:5173/signup.html?plan=" + plan.id,
                    ),
                    purpose="signup_trial_mandate",
                )
                checkout_url = session.url
            except Exception:
                checkout_url = None

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants SET
              stripe_customer_id = COALESCE(%s, stripe_customer_id),
              stripe_subscription_id = COALESCE(%s, stripe_subscription_id),
              subscription_status = %s,
              subscription_plan = %s,
              payroll_plan_id = %s,
              payroll_enabled = %s,
              discount_code = %s,
              referral_code = %s,
              trial_ends_at = %s,
              billing_created_at = NOW(),
              max_employees = %s
            WHERE id = %s
            """,
            (
                stripe_customer_id,
                stripe_subscription_id,
                subscription_status,
                plan.id,
                payroll_plan.id if payroll_plan else None,
                bool(payroll_plan),
                promotion.discount_code,
                promotion.referral_code,
                trial_end,
                plan.max_employees,
                tenant_id,
            ),
        )

    if promotion.discount_code or promotion.referral_code:
        record_promotion_redemption(
            tenant_id=tenant_id,
            plan_id=plan.id,
            promotion=promotion,
            conn=conn,
        )

    return {
        "stripe_customer_id": stripe_customer_id,
        "stripe_subscription_id": stripe_subscription_id,
        "subscription_status": subscription_status,
        "payroll_plan_id": payroll_plan.id if payroll_plan else None,
        "payroll_enabled": bool(payroll_plan),
        "trial_days": trial_days,
        "trial_ends_at": trial_end.isoformat() if trial_end else None,
        "checkout_url": checkout_url,
        "billing_auto_created": True,
        "discount_applied_gbp": promotion.discount_amount_gbp,
    }
