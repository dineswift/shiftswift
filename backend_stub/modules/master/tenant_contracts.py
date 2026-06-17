"""Platform master — B2B service agreement (MSA/DPA) management for tenants."""

from __future__ import annotations

from datetime import date
from typing import Any

from admin_service import get_tenant_profile
from billing_plans import get_plan
from contracts_service import (
    generate_contract_pack,
    create_contract,
    get_contract_detail,
    list_contracts,
    send_contract_for_signature,
)


def contract_prefill(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    plan = get_plan(profile.get("subscription_plan") or "")
    return {
        "customer_legal_name": profile.get("name") or "",
        "customer_trading_name": profile.get("trading_name") or "",
        "company_number": profile.get("company_number") or "",
        "vat_number": profile.get("vat_number") or "",
        "registered_address": profile.get("registered_address") or "",
        "signatory_email": profile.get("signatory_email") or profile.get("billing_email") or "",
        "signatory_name": profile.get("signatory_name") or "",
        "signatory_title": profile.get("signatory_title") or "Director",
        "plan_id": profile.get("subscription_plan") or "",
        "plan_name": plan.name if plan else None,
        "effective_date": date.today().isoformat(),
        "template_id": "pack",
    }


def _plan_fields(plan_id: str | None) -> dict[str, Any]:
    if not plan_id:
        return {}
    plan = get_plan(plan_id)
    if not plan:
        return {}
    return {
        "plan_id": plan.id,
        "plan_name": plan.name,
        "plan_price_gbp_ex_vat": plan.price_gbp_ex_vat,
        "max_employees": plan.max_employees,
        "billing_interval": plan.billing_interval,
    }


def generate_for_tenant(
    conn: Any,
    *,
    tenant_id: int,
    payload: dict[str, Any],
    actor: str,
) -> dict[str, Any]:
    plan_fields = _plan_fields(payload.get("plan_id"))
    effective = payload.get("effective_date")
    if isinstance(effective, str) and effective:
        effective_date = date.fromisoformat(effective)
    elif isinstance(effective, date):
        effective_date = effective
    else:
        effective_date = date.today()

    common = {
        "customer_legal_name": payload["customer_legal_name"],
        "signatory_email": payload["signatory_email"],
        "signatory_name": payload.get("signatory_name"),
        "signatory_title": payload.get("signatory_title") or "Director",
        "customer_trading_name": payload.get("customer_trading_name"),
        "company_number": payload.get("company_number"),
        "registered_address": payload.get("registered_address"),
        "vat_number": payload.get("vat_number"),
        "effective_date": effective_date,
        "created_by": actor,
        **plan_fields,
    }
    template_id = payload.get("template_id") or "pack"
    if template_id == "pack":
        created = generate_contract_pack(conn, tenant_id=tenant_id, **common)
        return {"generated": len(created), "contracts": created}
    created = create_contract(conn, tenant_id=tenant_id, template_id=template_id, **common)
    return {"contract": created}
