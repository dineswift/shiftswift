"""Stripe Billing routes for B2B HR subscriptions."""

from __future__ import annotations

import json
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser
from billing_config import stripe_payment_method_types, stripe_settings
from billing_plans import get_plan, list_plans, resolve_stripe_price_id, resolve_stripe_seat_price_id
from billing_pricing import estimate_monthly_total, plan_pricing_payload
from billing_promotions import validate_promotions
from billing_seat_sync import build_platform_subscription_items
from billing_stripe_checkout import (
    create_mandate_checkout_for_tenant,
    create_subscription_checkout_session,
    fetch_tenant_mandate,
    sync_mandate_from_setup_intent,
    sync_mandate_status,
)
from license_service import (
    clear_payment_failure,
    process_payment_failure_cycle,
    record_payment_failure,
    resolve_tenant_by_stripe_customer,
)
from deps import get_admin_user, get_current_user, resolve_tenant_id
from payroll_plans import get_payroll_plan, list_payroll_plans, resolve_stripe_price_id as resolve_payroll_stripe_price_id
from rbac import has_permission, normalize_role
from trial_service import create_upgrade_checkout, trial_snapshot
from license_service import license_snapshot

router = APIRouter(prefix="/billing", tags=["B2B Billing"])


class CheckoutRequest(BaseModel):
    plan_id: str
    tenant_id: int
    success_url: str = Field(min_length=8, max_length=2048)
    cancel_url: str = Field(min_length=8, max_length=2048)
    billing_email: EmailStr
    vat_number: str | None = Field(default=None, max_length=32)
    payroll_plan_id: str | None = Field(default=None, max_length=64)


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


def _require_billing_access(user: AuthUser, tenant_id: int) -> None:
    role = normalize_role(user.role)
    if user.role == "admin":
        return
    if str(user.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Business access denied")
    if not has_permission(role, "billing.write"):
        raise HTTPException(status_code=403, detail="Billing permission required")


class PromoValidateRequest(BaseModel):
    plan_id: str
    discount_code: str | None = Field(default=None, max_length=64)
    referral_code: str | None = Field(default=None, max_length=64)
    active_employees: int = Field(default=0, ge=0, le=10000)


class UpgradeRequest(BaseModel):
    success_url: str | None = Field(default=None, max_length=2048)
    cancel_url: str | None = Field(default=None, max_length=2048)


class MandateSetupRequest(BaseModel):
    success_url: str | None = Field(default=None, max_length=2048)
    cancel_url: str | None = Field(default=None, max_length=2048)


def _plan_item(plan, *, category: str) -> dict[str, object]:
    price_id = resolve_stripe_price_id(plan) if category == "platform" else resolve_payroll_stripe_price_id(plan)
    seat_price_id = resolve_stripe_seat_price_id(plan) if category == "platform" else None
    payload = plan_pricing_payload(plan) if category == "platform" else {}
    base = float(getattr(plan, "base_price_gbp_ex_vat", None) or plan.price_gbp_ex_vat)
    return {
        "id": plan.id,
        "name": plan.name,
        "description": plan.description,
        "billing_interval": plan.billing_interval,
        "max_employees": plan.max_employees,
        "price_gbp_ex_vat": base,
        "price_gbp_inc_vat": round(base * 1.2, 2),
        "vat_rate": "20%",
        "features": list(plan.features),
        "stripe_price_configured": bool(price_id),
        "stripe_seat_price_configured": bool(seat_price_id),
        "editable": True,
        "category": category,
        **payload,
    }


@router.get("/plans")
def list_plan_catalog() -> dict[str, object]:
    platform_plans = list_plans()
    payroll_plans = list_payroll_plans()
    settings = stripe_settings()
    platform_items = [_plan_item(plan, category="platform") for plan in platform_plans]
    payroll_items = [_plan_item(plan, category="payroll") for plan in payroll_plans]
    return {
        "plans": platform_items,
        "platform_plans": platform_items,
        "payroll_plans": payroll_items,
        "model": {
            "platform": "base_plus_per_head_with_monthly_cap",
            "payroll": "flat_per_site_payroll_addon",
        },
        "note": "Platform HR and payroll are billed separately — combine at signup or add payroll later.",
        "payment_methods": stripe_payment_method_types(),
        "direct_debit_note": "UK Bacs Direct Debit mandate collected securely via Stripe Checkout.",
        "stripe_configured": settings["configured"],
        "stripe_tax_enabled": settings["tax_enabled"],
        "direct_debit_enabled": settings.get("direct_debit_enabled", False),
    }


class QuoteRequest(BaseModel):
    plan_id: str
    active_employees: int = Field(default=0, ge=0, le=10000)


@router.post("/quote")
def subscription_quote(payload: QuoteRequest) -> dict[str, object]:
    from billing_pricing import calculate_monthly_quote

    plan = get_plan(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Unknown plan")
    if payload.active_employees > plan.max_employees:
        raise HTTPException(
            status_code=400,
            detail=f"This plan supports up to {plan.max_employees} employees. Choose a higher plan or reduce headcount.",
        )
    quote = calculate_monthly_quote(plan, active_employees=payload.active_employees)
    return {
        "plan_id": plan.id,
        "plan_name": plan.name,
        "max_employees": plan.max_employees,
        **quote,
    }


@router.post("/validate-promo")
def validate_promo(payload: PromoValidateRequest) -> dict[str, object]:
    plan = get_plan(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Unknown plan")
    monthly_total = estimate_monthly_total(plan, active_employees=payload.active_employees)
    promo = validate_promotions(
        plan_id=plan.id,
        base_price_gbp=monthly_total,
        discount_code=payload.discount_code,
        referral_code=payload.referral_code,
    )
    adjusted = max(round(monthly_total - promo.discount_amount_gbp, 2), 0)
    return {
        "valid": promo.valid,
        "message": promo.message,
        "discount_code": promo.discount_code,
        "referral_code": promo.referral_code,
        "discount_applied_gbp": promo.discount_amount_gbp,
        "extra_trial_days": promo.extra_trial_days,
        "partner_name": promo.partner_name,
        "active_employees": payload.active_employees,
        "price_gbp_ex_vat": monthly_total,
        "adjusted_price_gbp_ex_vat": adjusted,
        "adjusted_price_gbp_inc_vat": round(adjusted * 1.2, 2),
    }


@router.get("/status")
def billing_status(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id)
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT subscription_plan, subscription_status, billing_email, vat_number, max_employees,
                       payroll_plan_id, payroll_enabled, trial_ends_at
                FROM tenants WHERE id = %s
                """,
                (tenant_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Business not found")
            plan, status, email, vat, max_employees, payroll_plan_id, payroll_enabled, trial_ends_at = row
        trial = trial_snapshot(tenant_id=tenant_id, conn=conn)
        license_info = license_snapshot(tenant_id=tenant_id, conn=conn)
        with conn.cursor() as cur:
            mandate = fetch_tenant_mandate(cur, tenant_id)
    finally:
        conn.close()
    settings = stripe_settings()
    return {
        "tenant_id": tenant_id,
        "subscription_plan": plan,
        "subscription_status": status,
        "billing_email": email,
        "vat_number": vat,
        "max_employees": max_employees,
        "payroll_plan_id": payroll_plan_id,
        "payroll_enabled": payroll_enabled,
        "trial_ends_at": trial.get("trial_ends_at"),
        "days_remaining": trial.get("days_remaining"),
        "trial_days_default": trial.get("trial_days_default"),
        "upgrade_required": trial.get("upgrade_required"),
        "access_allowed": license_info.get("access_allowed"),
        "upgrade_url": trial.get("upgrade_url"),
        "license_state": license_info.get("license_state"),
        "license_warning": license_info.get("license_warning"),
        "license_on_hold": license_info.get("license_on_hold"),
        "warning_message": license_info.get("warning_message"),
        "hold_message": license_info.get("hold_message"),
        "payment_failed_at": license_info.get("payment_failed_at"),
        "license_hold_at": license_info.get("license_hold_at"),
        "grace_days_total": license_info.get("grace_days_total"),
        "grace_days_remaining": license_info.get("grace_days_remaining"),
        "update_payment_url": license_info.get("update_payment_url"),
        "mandate_status": mandate.get("mandate_status", "none"),
        "direct_debit_active": mandate.get("direct_debit_active", False),
        "direct_debit_pending": mandate.get("direct_debit_pending", False),
        "mandate_sort_code": mandate.get("mandate_sort_code"),
        "mandate_account_last4": mandate.get("mandate_account_last4"),
        "mandate_confirmed_at": mandate.get("mandate_confirmed_at"),
        "stripe_configured": settings["configured"],
        "stripe_tax_enabled": settings["tax_enabled"],
        "direct_debit_enabled": settings.get("direct_debit_enabled", False),
    }


@router.post("/upgrade")
def upgrade_subscription(
    payload: UpgradeRequest,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from config import load_settings

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=load_settings())
    _require_billing_access(current_user, tenant_id)
    conn = _db_conn()
    try:
        result = create_upgrade_checkout(
            conn=conn,
            tenant_id=tenant_id,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
        )
    finally:
        conn.close()
    return result


@router.post("/direct-debit/mandate")
def setup_direct_debit_mandate(
    payload: MandateSetupRequest,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from config import load_settings

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=load_settings())
    _require_billing_access(current_user, tenant_id)
    settings = stripe_settings()
    if not settings["secret_key"]:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    if not settings.get("direct_debit_enabled"):
        raise HTTPException(status_code=503, detail="Direct Debit not enabled — set STRIPE_PAYMENT_METHODS=bacs_debit,card")

    conn = _db_conn()
    try:
        result = create_mandate_checkout_for_tenant(
            conn=conn,
            tenant_id=tenant_id,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
        )
    finally:
        conn.close()
    if not result.get("checkout_url"):
        raise HTTPException(status_code=400, detail=result.get("message", "Direct Debit setup unavailable"))
    return result


@router.post("/checkout-session")
def create_checkout_session(
    payload: CheckoutRequest,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, str]:
    _require_billing_access(current_user, payload.tenant_id)
    plan = get_plan(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Unknown plan")

    payroll_plan = None
    if payload.payroll_plan_id:
        payroll_plan = get_payroll_plan(payload.payroll_plan_id)
        if not payroll_plan:
            raise HTTPException(status_code=404, detail="Unknown payroll plan")
        if payroll_plan.max_employees < plan.max_employees:
            raise HTTPException(
                status_code=400,
                detail="Payroll plan must cover at least as many employees as your platform plan.",
            )

    settings = stripe_settings()
    if not settings["secret_key"]:
        raise HTTPException(
            status_code=503,
            detail="Stripe not configured. Set STRIPE_SECRET_KEY and price IDs in environment.",
        )

    price_id = resolve_stripe_price_id(plan)
    if not price_id:
        raise HTTPException(
            status_code=503,
            detail=f"Missing env var {plan.stripe_price_id_env} for plan {plan.id}",
        )

    import stripe

    stripe.api_key = settings["secret_key"]

    conn = _db_conn()
    stripe_customer_id = None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT stripe_customer_id FROM tenants WHERE id = %s", (payload.tenant_id,))
            row = cur.fetchone()
            stripe_customer_id = row[0] if row else None

        line_items = build_platform_subscription_items(
            plan=plan, conn=conn, tenant_id=payload.tenant_id
        )
        if payroll_plan:
            payroll_price_id = resolve_payroll_stripe_price_id(payroll_plan)
            if not payroll_price_id:
                raise HTTPException(
                    status_code=503,
                    detail=f"Missing env var {payroll_plan.stripe_price_id_env} for payroll plan {payroll_plan.id}",
                )
            line_items.append({"price": payroll_price_id, "quantity": 1})
    finally:
        conn.close()

    try:
        session = create_subscription_checkout_session(
            tenant_id=payload.tenant_id,
            line_items=line_items,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
            metadata={
                "tenant_id": str(payload.tenant_id),
                "plan_id": plan.id,
                "payroll_plan_id": payroll_plan.id if payroll_plan else "",
            },
            customer_id=stripe_customer_id,
            customer_email=str(payload.billing_email) if not stripe_customer_id else None,
        )
    except Exception as exc:  # noqa: BLE001 — surface Stripe error safely
        raise HTTPException(status_code=502, detail="Stripe checkout failed") from exc

    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tenants
                SET billing_email = %s,
                    vat_number = COALESCE(%s, vat_number),
                    subscription_plan = %s,
                    payroll_plan_id = %s,
                    payroll_enabled = %s
                WHERE id = %s
                """,
                (
                    payload.billing_email,
                    payload.vat_number,
                    plan.id,
                    payroll_plan.id if payroll_plan else None,
                    bool(payroll_plan),
                    payload.tenant_id,
                ),
            )
        conn.commit()
    finally:
        conn.close()

    return {"checkout_url": session.url or "", "session_id": session.id}


@router.post("/webhook")
async def stripe_webhook(request: Request) -> dict[str, str]:
    settings = stripe_settings()
    if not settings["webhook_secret"] or not settings["secret_key"]:
        raise HTTPException(status_code=503, detail="Stripe webhook not configured")

    import stripe

    stripe.api_key = settings["secret_key"]
    payload = await request.body()
    signature = request.headers.get("Stripe-Signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, signature, settings["webhook_secret"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook") from exc

    tenant_id = None
    data = event.get("data", {}).get("object", {})
    metadata = data.get("metadata") or {}
    if metadata.get("tenant_id"):
        tenant_id = int(metadata["tenant_id"])
    elif data.get("client_reference_id"):
        tenant_id = int(data["client_reference_id"])

    event_payload = event.to_dict() if hasattr(event, "to_dict") else dict(event)
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO billing_events (tenant_id, stripe_event_id, event_type, payload)
                VALUES (%s, %s, %s, %s::jsonb)
                ON CONFLICT (stripe_event_id) DO NOTHING
                """,
                (tenant_id, event.get("id"), event.get("type"), json.dumps(event_payload)),
            )

        event_type = event.get("type")

        if tenant_id and event_type == "checkout.session.completed":
            mode = data.get("mode")
            if mode == "setup" and data.get("setup_intent"):
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT stripe_subscription_id FROM tenants WHERE id = %s",
                        (tenant_id,),
                    )
                    sub_row = cur.fetchone()
                sync_mandate_from_setup_intent(
                    conn=conn,
                    tenant_id=tenant_id,
                    setup_intent_id=data["setup_intent"],
                    subscription_id=sub_row[0] if sub_row else None,
                )
            elif mode == "subscription":
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE tenants
                        SET subscription_status = 'active',
                            stripe_customer_id = COALESCE(%s, stripe_customer_id),
                            stripe_subscription_id = COALESCE(%s, stripe_subscription_id),
                            trial_ends_at = NULL
                        WHERE id = %s
                        """,
                        (data.get("customer"), data.get("subscription"), tenant_id),
                    )

        if event_type == "setup_intent.succeeded":
            setup_intent_id = data.get("id")
            customer_id = data.get("customer")
            resolved_tenant = tenant_id
            subscription_id = None
            if not resolved_tenant and customer_id:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT id, stripe_subscription_id FROM tenants WHERE stripe_customer_id = %s",
                        (customer_id,),
                    )
                    row = cur.fetchone()
                if row:
                    resolved_tenant, subscription_id = int(row[0]), row[1]
            if resolved_tenant and setup_intent_id:
                sync_mandate_from_setup_intent(
                    conn=conn,
                    tenant_id=resolved_tenant,
                    setup_intent_id=setup_intent_id,
                    subscription_id=subscription_id,
                )

        if event_type == "mandate.updated":
            mandate_id = data.get("id")
            status = data.get("status")
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM tenants WHERE stripe_mandate_id = %s", (mandate_id,))
                tenant_row = cur.fetchone()
            if tenant_row and status:
                sync_mandate_status(
                    conn=conn,
                    tenant_id=int(tenant_row[0]),
                    mandate_id=mandate_id,
                    status=status,
                )

        if tenant_id and event_type in {"customer.subscription.updated", "customer.subscription.created"}:
            sub_status = data.get("status")
            if sub_status in {"active", "trialing", "past_due", "canceled", "unpaid"}:
                mapped = "cancelled" if sub_status == "canceled" else sub_status
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE tenants
                        SET subscription_status = %s,
                            stripe_subscription_id = COALESCE(%s, stripe_subscription_id),
                            trial_ends_at = CASE WHEN %s = 'active' THEN NULL ELSE trial_ends_at END
                        WHERE id = %s
                        """,
                        (mapped, data.get("id"), mapped, tenant_id),
                    )
                if sub_status in {"past_due", "unpaid"}:
                    record_payment_failure(
                        conn=conn,
                        tenant_id=tenant_id,
                        subscription_status=mapped,
                    )
                elif sub_status == "active":
                    clear_payment_failure(conn=conn, tenant_id=tenant_id)

        if event_type == "invoice.payment_failed":
            customer_id = data.get("customer")
            with conn.cursor() as cur:
                resolved = tenant_id or resolve_tenant_by_stripe_customer(cur, customer_id)
            if resolved:
                record_payment_failure(conn=conn, tenant_id=resolved, subscription_status="past_due")

        if event_type == "invoice.paid":
            customer_id = data.get("customer")
            with conn.cursor() as cur:
                resolved = tenant_id or resolve_tenant_by_stripe_customer(cur, customer_id)
            if resolved:
                clear_payment_failure(conn=conn, tenant_id=resolved)

        if tenant_id and event_type == "customer.subscription.deleted":
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE tenants SET subscription_status = 'cancelled' WHERE id = %s",
                    (tenant_id,),
                )

        conn.commit()
    finally:
        conn.close()

    return {"status": "ok"}
