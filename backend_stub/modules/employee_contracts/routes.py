"""Employment contracts API — employer ↔ employee documents."""

from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_service import AuthUser
from deps import client_ip, get_hr_user, resolve_tenant_id
from config import load_settings
from modules.employee_contracts.service import (
    generate_employment_contract,
    get_contract_by_token,
    get_contract_detail,
    list_contract_templates,
    list_employment_contracts,
    send_for_signature,
    sign_employment_contract,
)

router = APIRouter(prefix="/employment-contracts", tags=["Employment Contracts"])
settings = load_settings()


class GenerateEmploymentContractRequest(BaseModel):
    employee_id: int = Field(ge=1)
    template_id: str = Field(min_length=2, max_length=80)


class SignEmploymentContractRequest(BaseModel):
    signature_name: str = Field(min_length=2, max_length=120)
    signature_title: str | None = Field(default=None, max_length=120)
    accept_terms: bool
    signature_image: str | None = Field(default=None, max_length=400000)


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


@router.get("/templates")
def employment_contract_templates(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        items = list_contract_templates(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return {
        "items": items,
        "count": len(items),
        "sync_note": "Templates are curated from ACAS guidance and UK employment law. Platform updates apply when law changes — run seed on deploy.",
    }


@router.get("")
def get_employment_contracts(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    employee_id: int | None = None,
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        items = list_employment_contracts(tenant_id=tenant_id, conn=conn, employee_id=employee_id)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/generate")
def generate_contract(
    payload: GenerateEmploymentContractRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        try:
            created = generate_employment_contract(
                tenant_id=tenant_id,
                employee_id=payload.employee_id,
                template_id=payload.template_id,
                created_by=current_user.username,
                conn=conn,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"contract": created}


@router.get("/{contract_id}")
def get_contract(
    contract_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        try:
            return get_contract_detail(conn=conn, contract_id=contract_id, tenant_id=tenant_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


class SendEmploymentContractRequest(BaseModel):
    frontend_base: str | None = Field(default=None, max_length=500)


@router.post("/{contract_id}/send")
async def send_contract(
    contract_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    frontend_base = None
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
            if isinstance(body, dict):
                frontend_base = body.get("frontend_base")
        except Exception:
            frontend_base = None
    origin = frontend_base or request.headers.get("Origin") or os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")
    conn = _db_conn()
    try:
        try:
            result = send_for_signature(
                conn=conn,
                contract_id=contract_id,
                tenant_id=tenant_id,
                actor=current_user.username,
                frontend_base=origin,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return result


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
    payload: SignEmploymentContractRequest,
    request: Request,
) -> dict[str, object]:
    if not payload.accept_terms:
        raise HTTPException(status_code=400, detail="You must accept the contract terms")
    conn = _db_conn()
    try:
        try:
            result = sign_employment_contract(
                conn=conn,
                token=token,
                signature_name=payload.signature_name,
                signature_title=payload.signature_title,
                ip_address=client_ip(request),
                signature_image=payload.signature_image,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return result
