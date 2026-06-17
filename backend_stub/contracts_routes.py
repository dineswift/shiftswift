"""Legal contracts API — generate, send, sign, store."""

from __future__ import annotations

import os
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser
from billing_plans import get_plan
from contracts_service import (
    TEMPLATE_REGISTRY,
    create_contract,
    generate_contract_pack,
    get_contract_by_token,
    get_contract_detail,
    list_contracts,
    send_contract_for_signature,
    sign_contract,
)
from deps import client_ip, get_hr_user, resolve_tenant_id
from config import load_settings

router = APIRouter(prefix="/contracts", tags=["Legal Contracts"])
settings = load_settings()


class CustomerContractData(BaseModel):
    customer_legal_name: str = Field(min_length=2, max_length=200)
    signatory_email: EmailStr
    signatory_name: str | None = Field(default=None, max_length=120)
    signatory_title: str | None = Field(default="Director", max_length=120)
    customer_trading_name: str | None = Field(default=None, max_length=200)
    company_number: str | None = Field(default=None, max_length=32)
    registered_address: str | None = Field(default=None, max_length=500)
    vat_number: str | None = Field(default=None, max_length=32)
    plan_id: str | None = None
    effective_date: date | None = None


class GenerateContractRequest(CustomerContractData):
    template_id: str = Field(pattern="^(msa|dpa|subscription_order|pack)$")


class SignContractRequest(BaseModel):
    signature_name: str = Field(min_length=2, max_length=120)
    signature_title: str | None = Field(default=None, max_length=120)
    accept_terms: bool


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


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


@router.get("/templates")
def contract_templates() -> dict[str, object]:
    return {
        "templates": [
            {"id": tid, "name": meta["name"], "description": meta["name"]}
            for tid, meta in TEMPLATE_REGISTRY.items()
        ]
        + [{"id": "pack", "name": "Full legal pack", "description": "MSA + DPA + Subscription Order"}]
    }


@router.get("")
def get_contracts(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        items = list_contracts(conn, tenant_id)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/generate")
def generate_contract(
    payload: GenerateContractRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    raise HTTPException(
        status_code=403,
        detail="Service agreements are issued by ShiftSwift. Contact support if you need a new MSA or DPA pack.",
    )


@router.get("/{contract_id}")
def get_contract(
    contract_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return get_contract_detail(conn, contract_id=contract_id, tenant_id=tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/{contract_id}/send")
def send_contract(
    contract_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    raise HTTPException(
        status_code=403,
        detail="Signing links are sent by ShiftSwift. Check your inbox or contact support.",
    )


@router.get("/sign/view/{token}")
def view_contract_for_signing(token: str) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            contract = get_contract_by_token(conn, token)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return contract


@router.post("/sign/{token}")
def accept_contract_signature(
    token: str,
    payload: SignContractRequest,
    request: Request,
) -> dict[str, object]:
    if not payload.accept_terms:
        raise HTTPException(status_code=400, detail="You must accept the contract terms")
    conn = _db_conn()
    try:
        try:
            result = sign_contract(
                conn,
                token=token,
                signature_name=payload.signature_name,
                signature_title=payload.signature_title,
                ip_address=client_ip(request),
            )
            conn.commit()
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return result


@router.post("/{contract_id}/upload-signed")
async def upload_signed_contract(
    contract_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    signed_pdf: UploadFile = File(...),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    raise HTTPException(
        status_code=403,
        detail="Countersigned PDFs are stored by ShiftSwift. Contact support to upload a signed copy.",
    )
