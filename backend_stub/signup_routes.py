"""Public signup flow — create tenant and auto-provision billing."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser, create_token_pair, hash_password, log_security_event
from brand import EMAIL_SUPPORT
from billing_plans import get_plan
from billing_pricing import calculate_monthly_quote, estimate_monthly_total
from billing_promotions import validate_promotions
from billing_stripe_service import provision_tenant_billing
from config import load_settings
from contracts_service import generate_contract_pack, send_contract_for_signature
from deps import client_ip
from legal_acceptance import record_signup_acceptance, validate_signup_legal_acceptances
from payroll_plans import get_payroll_plan

router = APIRouter(prefix="/signup", tags=["Signup"])


class SignupStartRequest(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    billing_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=256)
    plan_id: str
    payroll_plan_id: str | None = Field(default=None, max_length=64)
    vat_number: str | None = Field(default=None, max_length=32)
    start_trial: bool = True
    discount_code: str | None = Field(default=None, max_length=64)
    referral_code: str | None = Field(default=None, max_length=64)
    holds_sponsor_licence: bool = False
    sponsor_licence_acknowledged: bool = False
    accept_service_scope: bool = False
    accept_eula: bool = False
    accept_payment_terms: bool = False
    accept_dpa: bool = False
    expected_active_employees: int = Field(default=0, ge=0, le=10000)


def _validate_payroll_for_platform(platform_plan, payroll_plan_id: str | None):
    if not payroll_plan_id:
        return None
    payroll_plan = get_payroll_plan(payroll_plan_id)
    if not payroll_plan:
        raise HTTPException(status_code=404, detail="Unknown payroll plan")
    if payroll_plan.max_employees < platform_plan.max_employees:
        raise HTTPException(
            status_code=400,
            detail="Payroll plan must cover at least as many employees as your platform plan.",
        )
    return payroll_plan


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


def _business_email_registered(conn: Any, email: str) -> bool:
    """True when email already owns a workspace (one email, one HR account)."""
    email_norm = email.strip().lower()
    master_tenant_id = int(os.getenv("MASTER_CUSTOMER_ID", "999"))
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM app_users
            WHERE lower(username) = %s
              AND is_active = TRUE
              AND COALESCE(login_portal, 'business') = 'business'
            LIMIT 1
            """,
            (email_norm,),
        )
        if cur.fetchone():
            return True
        cur.execute(
            """
            SELECT 1
            FROM tenants
            WHERE lower(trim(billing_email)) = %s
              AND deleted_at IS NULL
              AND id != %s
            LIMIT 1
            """,
            (email_norm, master_tenant_id),
        )
        return cur.fetchone() is not None


_SIGNUP_ACK_MESSAGE = (
    "If this email is eligible for a workspace, check your inbox for sign-in instructions."
)


def _create_hr_admin_user(conn: Any, tenant_id: int, username: str, password: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_users (username, password_hash, role, tenant_id, login_portal)
            VALUES (%s, %s, 'hr', %s, 'business')
            ON CONFLICT (username) DO UPDATE SET
              password_hash = EXCLUDED.password_hash,
              role = EXCLUDED.role,
              tenant_id = EXCLUDED.tenant_id,
              login_portal = EXCLUDED.login_portal,
              is_active = TRUE,
              updated_at = NOW()
            """,
            (username.lower(), hash_password(password), tenant_id),
        )
    from modules.workspace.service import ensure_workspace_owner

    ensure_workspace_owner(conn=conn, tenant_id=tenant_id, username=username)


def _send_signup_welcome_email(
    *,
    tenant_id: int,
    business_name: str,
    billing_email: str,
    plan_name: str,
    trial_days: int,
) -> None:
    from core.email_templates import welcome_trial_email
    from core.notifications import send_email_content

    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    content = welcome_trial_email(
        business_name=business_name,
        billing_email=billing_email,
        plan_name=plan_name,
        trial_days=trial_days,
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
    except Exception:
        logger.exception("Welcome email failed for tenant %s", tenant_id)
    finally:
        conn.close()


def _send_signup_platform_guide_email(
    *,
    tenant_id: int,
    business_name: str,
    billing_email: str,
) -> None:
    from core.email_templates import signup_platform_guide_email
    from core.notifications import send_email_content

    content = signup_platform_guide_email(
        business_name=business_name,
        billing_email=billing_email,
    )
    conn = _db_conn()
    try:
        send_email_content(
            conn=conn,
            tenant_id=tenant_id,
            content=content,
            purpose="general",
            to=billing_email,
            audience="hr",
            deliver_now=True,
        )
    except Exception:
        logger.exception("Platform guide email failed for tenant %s", tenant_id)
    finally:
        conn.close()


def _send_signup_contract_email(
    *,
    tenant_id: int,
    contract_id: int,
    billing_email: str,
) -> dict[str, object] | None:
    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    conn = _db_conn()
    try:
        result = send_contract_for_signature(
            conn,
            contract_id=contract_id,
            tenant_id=tenant_id,
            actor="signup",
            frontend_base=app_url,
        )
        from core.notifications import process_queued_notifications

        process_queued_notifications(conn=conn)
        conn.commit()
        return result
    except Exception:
        logger.exception("MSA signing email failed for tenant %s", tenant_id)
        conn.rollback()
        return None
    finally:
        conn.close()


@router.post("/start")
def signup_start(payload: SignupStartRequest, request: Request) -> dict[str, object]:
    settings = load_settings()
    plan = get_plan(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Unknown subscription plan")

    payroll_plan = _validate_payroll_for_platform(plan, payload.payroll_plan_id)

    expected_headcount = max(0, int(payload.expected_active_employees))
    if expected_headcount > plan.max_employees:
        raise HTTPException(
            status_code=400,
            detail=f"This plan supports up to {plan.max_employees} active employees. Choose a higher plan or reduce headcount.",
        )

    monthly_total = estimate_monthly_total(plan, active_employees=expected_headcount)
    quote = calculate_monthly_quote(plan, active_employees=expected_headcount)

    promotion = validate_promotions(
        plan_id=plan.id,
        base_price_gbp=monthly_total,
        discount_code=payload.discount_code,
        referral_code=payload.referral_code,
    )
    if not promotion.valid:
        raise HTTPException(status_code=400, detail=promotion.message)

    validate_signup_legal_acceptances(
        accept_eula=payload.accept_eula,
        accept_payment_terms=payload.accept_payment_terms,
        accept_dpa=payload.accept_dpa,
        accept_service_scope=payload.accept_service_scope,
        holds_sponsor_licence=payload.holds_sponsor_licence,
        sponsor_licence_acknowledged=payload.sponsor_licence_acknowledged,
    )

    ip = client_ip(request)
    user_agent = request.headers.get("User-Agent")

    conn = _db_conn()
    tenant_id: int
    billing_info: dict[str, object]
    contracts_created: list[dict[str, Any]] = []
    email_norm = str(payload.billing_email).strip().lower()
    try:
        if _business_email_registered(conn, email_norm):
            log_security_event(
                settings,
                event_type="signup_duplicate_email",
                username=email_norm,
                tenant_id=None,
                ip_address=ip,
                user_agent=user_agent,
                success=False,
                detail="email_already_registered",
            )
            return {"message": _SIGNUP_ACK_MESSAGE}

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tenants (
                  name, billing_email, vat_number, subscription_plan,
                  subscription_status, max_employees, platform,
                  discount_code, referral_code, payroll_plan_id, payroll_enabled
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'hr', %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    payload.business_name.strip(),
                    payload.billing_email,
                    payload.vat_number,
                    plan.id,
                    "provisioning",
                    plan.max_employees,
                    promotion.discount_code,
                    promotion.referral_code,
                    payroll_plan.id if payroll_plan else None,
                    bool(payroll_plan),
                ),
            )
            tenant_id = int(cur.fetchone()[0])

        admin_username = str(payload.billing_email).strip().lower()
        _create_hr_admin_user(conn, tenant_id, admin_username, payload.admin_password)

        billing_info = provision_tenant_billing(
            conn=conn,
            tenant_id=tenant_id,
            business_name=payload.business_name.strip(),
            billing_email=payload.billing_email,
            plan=plan,
            start_trial=payload.start_trial,
            promotion=promotion,
            vat_number=payload.vat_number,
            payroll_plan=payroll_plan,
            expected_active_employees=expected_headcount,
        )
        try:
            contracts_created = generate_contract_pack(
                conn,
                tenant_id=tenant_id,
                customer_legal_name=payload.business_name.strip(),
                signatory_email=str(payload.billing_email),
                vat_number=payload.vat_number,
                plan_id=plan.id,
                plan_name=plan.name,
                plan_price_gbp_ex_vat=plan.price_gbp_ex_vat,
                max_employees=plan.max_employees,
                billing_interval=plan.billing_interval,
                payroll_plan_id=payroll_plan.id if payroll_plan else None,
                payroll_plan_name=payroll_plan.name if payroll_plan else None,
                payroll_price_gbp_ex_vat=payroll_plan.price_gbp_ex_vat if payroll_plan else None,
                created_by="signup",
            )
        except Exception:
            logger.exception("Contract pack generation failed during signup for tenant %s", tenant_id)
        record_signup_acceptance(
            conn=conn,
            tenant_id=tenant_id,
            accept_eula=payload.accept_eula,
            accept_payment_terms=payload.accept_payment_terms,
            accept_dpa=payload.accept_dpa,
            accept_service_scope=payload.accept_service_scope,
            holds_sponsor_licence=payload.holds_sponsor_licence,
            sponsor_licence_acknowledged=payload.sponsor_licence_acknowledged,
            ip_address=ip,
            user_agent=user_agent,
        )
        if payload.holds_sponsor_licence and payload.sponsor_licence_acknowledged:
            from sponsor_licence_ack import acknowledge_sponsor_licence

            acknowledge_sponsor_licence(
                tenant_id=tenant_id,
                acknowledged_by=admin_username,
                holds_sponsor_licence=True,
                conn=conn,
            )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Signup failed for %s", payload.billing_email)
        raise HTTPException(
            status_code=503,
            detail=f"Could not finish setting up your workspace. Please try again or email {EMAIL_SUPPORT}.",
        ) from exc
    finally:
        conn.close()

    contracts_count = len(contracts_created)

    _send_signup_welcome_email(
        tenant_id=tenant_id,
        business_name=payload.business_name.strip(),
        billing_email=str(payload.billing_email).strip().lower(),
        plan_name=plan.name,
        trial_days=int(billing_info.get("trial_days") or 14),
    )

    _send_signup_platform_guide_email(
        tenant_id=tenant_id,
        business_name=payload.business_name.strip(),
        billing_email=str(payload.billing_email).strip().lower(),
    )

    msa_contract = next((item for item in contracts_created if item.get("template_id") == "msa"), None)
    contract_email_sent = False
    if msa_contract:
        send_result = _send_signup_contract_email(
            tenant_id=tenant_id,
            contract_id=int(msa_contract["id"]),
            billing_email=str(payload.billing_email).strip().lower(),
        )
        contract_email_sent = bool(send_result)

    log_security_event(
        settings,
        event_type="signup_started",
        username=payload.billing_email,
        tenant_id=str(tenant_id),
        ip_address=ip,
        user_agent=user_agent,
        success=True,
        detail=f"plan={plan.id} payroll={payroll_plan.id if payroll_plan else 'none'} billing_auto=1",
    )

    trial_user = AuthUser(
        username=str(payload.billing_email).strip().lower(),
        role="hr",
        tenant_id=str(tenant_id),
    )
    tokens = create_token_pair(settings, trial_user)

    adjusted_price = round(monthly_total - promotion.discount_amount_gbp, 2)
    payroll_price = payroll_plan.price_gbp_ex_vat if payroll_plan else 0
    total_price = round(max(adjusted_price, 0) + payroll_price, 2)

    return {
        "tenant_id": tenant_id,
        "plan_id": plan.id,
        "plan_name": plan.name,
        "expected_active_employees": expected_headcount,
        "billing_quote": quote,
        "payroll_plan_id": payroll_plan.id if payroll_plan else None,
        "payroll_plan_name": payroll_plan.name if payroll_plan else None,
        "payroll_enabled": bool(payroll_plan),
        "subscription_status": billing_info.get("subscription_status"),
        "billing_auto_created": billing_info.get("billing_auto_created", True),
        "stripe_customer_id": billing_info.get("stripe_customer_id"),
        "stripe_subscription_id": billing_info.get("stripe_subscription_id"),
        "trial_days": billing_info.get("trial_days"),
        "trial_ends_at": billing_info.get("trial_ends_at"),
        "checkout_url": billing_info.get("checkout_url"),
        "promotion_message": promotion.message,
        "discount_applied_gbp": promotion.discount_amount_gbp,
        "price_gbp_ex_vat": monthly_total,
        "payroll_price_gbp_ex_vat": payroll_price if payroll_plan else None,
        "adjusted_price_gbp_ex_vat": max(adjusted_price, 0),
        "total_price_gbp_ex_vat": total_price,
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "tenant_id_token": tokens.tenant_id,
        "contracts_generated": contracts_count,
        "contract_signing_email_sent": contract_email_sent,
        "platform_guide_email_sent": True,
        "message": "Workspace, billing, and legal contract drafts created automatically."
        + " Welcome and getting-started emails sent."
        + (" Signing email sent for your Master Services Agreement." if contract_email_sent else ""),
    }
