"""Sales-led tenant provisioning — create workspace without self-serve signup."""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from billing_plans import get_plan
from billing_promotions import PromotionResult
from billing_stripe_service import cancel_stripe_subscription, provision_tenant_billing
from signup_routes import _business_email_registered, _create_hr_admin_user
from trial_service import DEFAULT_TRIAL_DAYS

AccessMode = Literal["active", "trialing"]
BillingMode = Literal["offline", "stripe"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_notes(notes: str | None) -> str:
    return (notes or "").strip()[:2000]


def resolve_trial_end(
    *,
    now: datetime,
    status: AccessMode,
    trial_days: int | None,
    existing_trial_end: datetime | None,
) -> datetime | None:
    if status != "trialing":
        return None
    if trial_days is not None:
        if trial_days < 1:
            raise ValueError("Trial days must be at least 1")
        return now + timedelta(days=trial_days)
    if isinstance(existing_trial_end, datetime):
        end = existing_trial_end
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if end > now:
            return end
    return now + timedelta(days=DEFAULT_TRIAL_DAYS)


def create_tenant_manually(
    *,
    conn: Any,
    master_tenant_id: int,
    business_name: str,
    billing_email: str,
    admin_password: str,
    plan_id: str,
    billing_mode: BillingMode = "offline",
    access: AccessMode = "active",
    trial_days: int = DEFAULT_TRIAL_DAYS,
    max_employees: int | None = None,
    billing_notes: str | None = None,
    send_welcome_email: bool = True,
) -> dict[str, Any]:
    plan = get_plan(plan_id)
    if not plan:
        raise ValueError("Unknown subscription plan")

    email_norm = billing_email.strip().lower()
    if _business_email_registered(conn, email_norm):
        raise ValueError("That billing email already has a ShiftSwift HR workspace")

    if access == "trialing" and trial_days < 1:
        raise ValueError("Trial days must be at least 1 when access is trialing")
    if billing_mode == "stripe" and access == "active":
        raise ValueError("Stripe billing requires trialing or pending payment — use offline for immediate active access")

    staff_limit = int(max_employees or plan.max_employees)
    now = _utcnow()
    trial_end = None
    subscription_status = "active"
    if access == "trialing":
        subscription_status = "trialing"
        trial_end = now + timedelta(days=trial_days)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tenants (
              name, billing_email, subscription_plan, subscription_status,
              max_employees, platform, trial_ends_at, license_state,
              billing_mode, billing_notes
            )
            VALUES (%s, %s, %s, %s, %s, 'hr', %s, 'active', %s, %s)
            RETURNING id
            """,
            (
                business_name.strip(),
                email_norm,
                plan.id,
                subscription_status,
                staff_limit,
                trial_end,
                billing_mode,
                _normalize_notes(billing_notes),
            ),
        )
        tenant_id = int(cur.fetchone()[0])

    _create_hr_admin_user(conn, tenant_id, email_norm, admin_password)

    stripe_info: dict[str, object] = {}
    if billing_mode == "stripe":
        promotion = PromotionResult(valid=True, message="Manual provisioning")
        stripe_info = provision_tenant_billing(
            conn=conn,
            tenant_id=tenant_id,
            business_name=business_name.strip(),
            billing_email=email_norm,
            plan=plan,
            start_trial=access == "trialing",
            promotion=promotion,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tenants
                SET billing_mode = 'stripe',
                    subscription_status = COALESCE(%s, subscription_status),
                    trial_ends_at = COALESCE(%s, trial_ends_at)
                WHERE id = %s
                """,
                (
                    stripe_info.get("subscription_status"),
                    stripe_info.get("trial_ends_at"),
                    tenant_id,
                ),
            )

    if send_welcome_email:
        _send_manual_welcome_email(
            tenant_id=tenant_id,
            business_name=business_name.strip(),
            billing_email=email_norm,
            plan_name=plan.name,
            access=access,
            trial_days=trial_days if access == "trialing" else 0,
        )

    return {
        "tenant_id": tenant_id,
        "business_name": business_name.strip(),
        "billing_email": email_norm,
        "plan_id": plan.id,
        "billing_mode": billing_mode,
        "subscription_status": stripe_info.get("subscription_status") or subscription_status,
        "access": access,
        "trial_ends_at": stripe_info.get("trial_ends_at") or (trial_end.isoformat() if trial_end else None),
        "max_employees": staff_limit,
        "welcome_email_sent": send_welcome_email,
    }


def update_tenant_billing(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    billing_mode: BillingMode,
    subscription_status: AccessMode | None = None,
    plan_id: str | None = None,
    max_employees: int | None = None,
    trial_days: int | None = None,
    billing_notes: str | None = None,
    rota_advanced_addon: bool | None = None,
    rota_multi_site_addon: bool | None = None,
    crm_addon: bool | None = None,
    crm_addon_monthly_gbp: float | None = None,
    crm_addon_billing_notes: str | None = None,
    ai_document_addon: bool | None = None,
    ai_document_addon_monthly_gbp: float | None = None,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, billing_email, deleted_at, subscription_status, subscription_plan,
                   trial_ends_at, stripe_subscription_id
            FROM tenants
            WHERE id = %s AND id != %s
            """,
            (tenant_id, master_tenant_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Tenant not found")
    if row[3]:
        raise ValueError("Cannot update billing for a deleted tenant")

    plan = get_plan(plan_id) if plan_id else get_plan(row[5])
    if plan_id and not plan:
        raise ValueError("Unknown subscription plan")

    now = _utcnow()
    status = subscription_status
    if status is None:
        status = "active" if billing_mode == "offline" else (row[4] or "trialing")
    trial_end = resolve_trial_end(
        now=now,
        status=status,  # type: ignore[arg-type]
        trial_days=trial_days,
        existing_trial_end=row[6],
    )
    if billing_mode == "offline" and status == "active":
        trial_end = None

    if billing_mode == "stripe" and status == "active":
        raise ValueError("Use offline billing for active access without Stripe checkout")

    stripe_cancel: dict[str, object] = {"cancelled": False}
    if billing_mode == "offline" and row[7]:
        stripe_cancel = cancel_stripe_subscription(subscription_id=str(row[7]))

    updates = [
        "billing_mode = %s",
        "subscription_status = %s",
        "trial_ends_at = %s",
        "license_state = 'active'",
        "payment_failed_at = NULL",
        "license_hold_at = NULL",
        "updated_at = NOW()",
    ]
    params: list[Any] = [billing_mode, status, trial_end]
    if billing_mode == "offline" and row[7]:
        updates.append("stripe_subscription_id = NULL")

    if plan:
        updates.append("subscription_plan = %s")
        params.append(plan.id)
    if max_employees is not None:
        updates.append("max_employees = %s")
        params.append(int(max_employees))
    if billing_notes is not None:
        updates.append("billing_notes = %s")
        params.append(_normalize_notes(billing_notes))
    if rota_advanced_addon is not None:
        updates.append("rota_advanced_addon = %s")
        params.append(bool(rota_advanced_addon))
    if rota_multi_site_addon is not None:
        updates.append("rota_multi_site_addon = %s")
        params.append(bool(rota_multi_site_addon))
    if crm_addon is not None:
        updates.append("crm_addon = %s")
        params.append(bool(crm_addon))
    if crm_addon_monthly_gbp is not None:
        updates.append("crm_addon_monthly_gbp = %s")
        params.append(crm_addon_monthly_gbp)
    if crm_addon_billing_notes is not None:
        updates.append("crm_addon_billing_notes = %s")
        params.append(_normalize_notes(crm_addon_billing_notes))
    if ai_document_addon is not None:
        updates.append("ai_document_addon = %s")
        params.append(bool(ai_document_addon))
        updates.append("ai_assistant_enabled = %s")
        params.append(bool(ai_document_addon))
    if ai_document_addon_monthly_gbp is not None:
        updates.append("ai_document_addon_monthly_gbp = %s")
        params.append(ai_document_addon_monthly_gbp)

    params.append(tenant_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE tenants SET {', '.join(updates)} WHERE id = %s",
            params,
        )

    return {
        "tenant_id": tenant_id,
        "billing_mode": billing_mode,
        "subscription_status": status,
        "subscription_plan": plan.id if plan else row[5],
        "trial_ends_at": trial_end.isoformat() if trial_end else None,
        "max_employees": max_employees,
        "billing_notes": _normalize_notes(billing_notes) if billing_notes is not None else None,
        "rota_advanced_addon": rota_advanced_addon,
        "rota_multi_site_addon": rota_multi_site_addon,
        "crm_addon": crm_addon,
        "crm_addon_monthly_gbp": float(crm_addon_monthly_gbp) if crm_addon_monthly_gbp is not None else None,
        "crm_addon_billing_notes": _normalize_notes(crm_addon_billing_notes)
        if crm_addon_billing_notes is not None
        else None,
        "ai_document_addon": ai_document_addon,
        "ai_document_addon_monthly_gbp": float(ai_document_addon_monthly_gbp)
        if ai_document_addon_monthly_gbp is not None
        else None,
        "stripe_subscription_cancelled": bool(stripe_cancel.get("cancelled")),
        "stripe_cancel": stripe_cancel,
    }


def list_provision_plans() -> list[dict[str, object]]:
    from billing_plans import list_plans

    return [
        {
            "id": plan.id,
            "name": plan.name,
            "max_employees": plan.max_employees,
            "price_gbp_ex_vat": plan.price_gbp_ex_vat,
        }
        for plan in list_plans()
    ]


def _send_manual_welcome_email(
    *,
    tenant_id: int,
    business_name: str,
    billing_email: str,
    plan_name: str,
    access: AccessMode,
    trial_days: int,
) -> None:
    import logging

    logger = logging.getLogger(__name__)
    from signup_routes import _db_conn, _send_signup_platform_guide_email, _send_signup_welcome_email

    try:
        if access == "trialing":
            _send_signup_welcome_email(
                tenant_id=tenant_id,
                business_name=business_name,
                billing_email=billing_email,
                plan_name=plan_name,
                trial_days=trial_days,
            )
        else:
            from core.email_templates import welcome_trial_email
            from core.notifications import process_queued_notifications, send_email_content

            app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
            content = welcome_trial_email(
                business_name=business_name,
                billing_email=billing_email,
                plan_name=plan_name,
                trial_days=0,
                admin_url=f"{app_url}/admin.html",
            )
            conn = _db_conn()
            try:
                send_email_content(
                    conn=conn,
                    tenant_id=tenant_id,
                    content=content,
                    purpose="welcome",
                    to=billing_email,
                    audience="hr",
                    deliver_now=True,
                )
                process_queued_notifications(conn=conn)
                conn.commit()
            finally:
                conn.close()
        _send_signup_platform_guide_email(
            tenant_id=tenant_id,
            business_name=business_name,
            billing_email=billing_email,
        )
    except Exception:
        logger.exception("Manual welcome email failed for tenant %s", tenant_id)


def generate_temporary_password() -> str:
    return f"Shift-{secrets.token_urlsafe(9)}"
