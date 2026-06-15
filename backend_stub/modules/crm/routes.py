"""CRM add-on HTTP routes — accounts, contacts, deals pipeline."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.crm.constants import ACTIVITY_TYPES
from modules.crm import repository
from modules.crm.service import (
    build_account_detail,
    build_contact_detail,
    build_pipeline_board,
    require_crm_addon,
    validate_account,
    validate_contact,
    validate_stage,
)

router = APIRouter(
    prefix="/admin/crm",
    tags=["CRM"],
    dependencies=[Depends(require_tenant_subscription)],
)
settings = load_settings()


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=4000)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=4000)


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    account_id: int | None = None
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=4000)


class ContactPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    account_id: int | None = None
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=4000)


class DealCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    stage_id: int | None = None
    account_id: int | None = None
    contact_id: int | None = None
    value_gbp: float | None = Field(default=None, ge=0)
    expected_close_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)


class DealPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    stage_id: int | None = None
    account_id: int | None = None
    contact_id: int | None = None
    value_gbp: float | None = Field(default=None, ge=0)
    expected_close_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)


class ActivityCreate(BaseModel):
    activity_type: str = Field(default="note", pattern="^(note|call|email|meeting)$")
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=4000)


def _crm_context(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> tuple[int, AuthUser, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    require_crm_addon(tenant_id=tenant_id, conn=conn)
    return tenant_id, current_user, conn


@router.get("/summary")
def crm_summary(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        summary = repository.count_summary(tenant_id=tenant_id, conn=conn)
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn)
        conn.commit()
        return {
            **summary,
            "pipeline_name": board["pipeline"]["name"],
            "open_deals": board["deal_count"] - summary.get("deals_won", 0),
        }
    finally:
        conn.close()


@router.get("/pipeline")
def crm_pipeline(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    q: str | None = Query(default=None, max_length=120),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn, q=q)
        conn.commit()
        return board
    finally:
        conn.close()


@router.get("/accounts")
def crm_accounts(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    q: str | None = Query(default=None, max_length=120),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        items = repository.list_accounts(tenant_id=tenant_id, conn=conn, q=q)
        return {"items": items, "count": len(items)}
    finally:
        conn.close()


@router.get("/accounts/{account_id}")
def crm_account_detail(
    account_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        detail = build_account_detail(tenant_id=tenant_id, account_id=account_id, conn=conn)
        if not detail:
            raise HTTPException(status_code=404, detail="Company not found")
        return detail
    finally:
        conn.close()


@router.post("/accounts")
def crm_create_account(
    payload: AccountCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        item = repository.create_account(
            tenant_id=tenant_id,
            name=payload.name.strip(),
            email=str(payload.email) if payload.email else None,
            phone=payload.phone,
            website=payload.website,
            notes=payload.notes,
            owner_username=current_user.username,
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.patch("/accounts/{account_id}")
def crm_patch_account(
    account_id: int,
    payload: AccountPatch,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        updates = payload.model_dump(exclude_unset=True)
        if "email" in updates and updates["email"] is not None:
            updates["email"] = str(updates["email"])
        if not updates:
            item = repository.fetch_account(tenant_id=tenant_id, account_id=account_id, conn=conn)
        else:
            item = repository.update_account(
                tenant_id=tenant_id,
                account_id=account_id,
                updates=updates,
                conn=conn,
            )
        if not item:
            raise HTTPException(status_code=404, detail="Company not found")
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.delete("/accounts/{account_id}")
def crm_delete_account(
    account_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        deleted = repository.delete_account(tenant_id=tenant_id, account_id=account_id, conn=conn)
        if not deleted:
            raise HTTPException(status_code=404, detail="Company not found")
        conn.commit()
        return {"deleted": True, "id": account_id}
    finally:
        conn.close()


@router.post("/accounts/{account_id}/activities")
def crm_account_activity(
    account_id: int,
    payload: ActivityCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        if payload.activity_type not in ACTIVITY_TYPES:
            raise HTTPException(status_code=400, detail="Invalid activity type")
        if not repository.fetch_account(tenant_id=tenant_id, account_id=account_id, conn=conn):
            raise HTTPException(status_code=404, detail="Company not found")
        item = repository.create_activity(
            tenant_id=tenant_id,
            deal_id=None,
            activity_type=payload.activity_type,
            subject=payload.subject,
            body=payload.body,
            created_by=current_user.username,
            account_id=account_id,
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.get("/contacts")
def crm_contacts(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    q: str | None = Query(default=None, max_length=120),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        items = repository.list_contacts(tenant_id=tenant_id, conn=conn, q=q)
        return {"items": items, "count": len(items)}
    finally:
        conn.close()


@router.get("/contacts/{contact_id}")
def crm_contact_detail(
    contact_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        detail = build_contact_detail(tenant_id=tenant_id, contact_id=contact_id, conn=conn)
        if not detail:
            raise HTTPException(status_code=404, detail="Contact not found")
        return detail
    finally:
        conn.close()


@router.post("/contacts")
def crm_create_contact(
    payload: ContactCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        validate_account(tenant_id=tenant_id, account_id=payload.account_id, conn=conn)
        item = repository.create_contact(
            tenant_id=tenant_id,
            name=payload.name.strip(),
            account_id=payload.account_id,
            email=str(payload.email) if payload.email else None,
            phone=payload.phone,
            job_title=payload.job_title,
            notes=payload.notes,
            owner_username=current_user.username,
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.patch("/contacts/{contact_id}")
def crm_patch_contact(
    contact_id: int,
    payload: ContactPatch,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        updates = payload.model_dump(exclude_unset=True)
        if "email" in updates and updates["email"] is not None:
            updates["email"] = str(updates["email"])
        if "account_id" in updates:
            validate_account(tenant_id=tenant_id, account_id=updates.get("account_id"), conn=conn)
        if not updates:
            item = repository.fetch_contact(tenant_id=tenant_id, contact_id=contact_id, conn=conn)
        else:
            item = repository.update_contact(
                tenant_id=tenant_id,
                contact_id=contact_id,
                updates=updates,
                conn=conn,
            )
        if not item:
            raise HTTPException(status_code=404, detail="Contact not found")
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.delete("/contacts/{contact_id}")
def crm_delete_contact(
    contact_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        deleted = repository.delete_contact(tenant_id=tenant_id, contact_id=contact_id, conn=conn)
        if not deleted:
            raise HTTPException(status_code=404, detail="Contact not found")
        conn.commit()
        return {"deleted": True, "id": contact_id}
    finally:
        conn.close()


@router.post("/contacts/{contact_id}/activities")
def crm_contact_activity(
    contact_id: int,
    payload: ActivityCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        if payload.activity_type not in ACTIVITY_TYPES:
            raise HTTPException(status_code=400, detail="Invalid activity type")
        if not repository.fetch_contact(tenant_id=tenant_id, contact_id=contact_id, conn=conn):
            raise HTTPException(status_code=404, detail="Contact not found")
        item = repository.create_activity(
            tenant_id=tenant_id,
            deal_id=None,
            activity_type=payload.activity_type,
            subject=payload.subject,
            body=payload.body,
            created_by=current_user.username,
            contact_id=contact_id,
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.post("/deals")
def crm_create_deal(
    payload: DealCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn)
        pipeline_id = board["pipeline"]["id"]
        stage_id = payload.stage_id
        if stage_id is None:
            first_stage = board["stages"][0] if board["stages"] else None
            if not first_stage:
                raise HTTPException(status_code=500, detail="CRM pipeline is not configured")
            stage_id = first_stage["id"]
        validate_stage(
            tenant_id=tenant_id,
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            conn=conn,
        )
        validate_account(tenant_id=tenant_id, account_id=payload.account_id, conn=conn)
        validate_contact(tenant_id=tenant_id, contact_id=payload.contact_id, conn=conn)
        item = repository.create_deal(
            tenant_id=tenant_id,
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            title=payload.title.strip(),
            account_id=payload.account_id,
            contact_id=payload.contact_id,
            value_gbp=payload.value_gbp,
            expected_close_date=payload.expected_close_date,
            notes=payload.notes,
            owner_username=current_user.username,
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.get("/deals/{deal_id}")
def crm_get_deal(
    deal_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        deal = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        activities = repository.list_activities(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        return {"deal": deal, "activities": activities}
    finally:
        conn.close()


@router.patch("/deals/{deal_id}")
def crm_patch_deal(
    deal_id: int,
    payload: DealPatch,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        existing = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        if not existing:
            raise HTTPException(status_code=404, detail="Deal not found")

        updates = payload.model_dump(exclude_unset=True)
        if "stage_id" in updates and updates["stage_id"] is not None:
            validate_stage(
                tenant_id=tenant_id,
                pipeline_id=existing["pipeline_id"],
                stage_id=updates["stage_id"],
                conn=conn,
            )
        if "account_id" in updates:
            validate_account(tenant_id=tenant_id, account_id=updates.get("account_id"), conn=conn)
        if "contact_id" in updates:
            validate_contact(tenant_id=tenant_id, contact_id=updates.get("contact_id"), conn=conn)
        if not updates:
            return {"item": existing}

        item = repository.update_deal(
            tenant_id=tenant_id,
            deal_id=deal_id,
            updates=updates,
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.delete("/deals/{deal_id}")
def crm_delete_deal(
    deal_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        deleted = repository.delete_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        if not deleted:
            raise HTTPException(status_code=404, detail="Deal not found")
        conn.commit()
        return {"deleted": True, "id": deal_id}
    finally:
        conn.close()


@router.get("/deals/{deal_id}/activities")
def crm_deal_activities(
    deal_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        deal = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        items = repository.list_activities(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        return {"items": items, "count": len(items), "deal": deal}
    finally:
        conn.close()


@router.post("/deals/{deal_id}/activities")
def crm_create_activity(
    deal_id: int,
    payload: ActivityCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        if payload.activity_type not in ACTIVITY_TYPES:
            raise HTTPException(status_code=400, detail="Invalid activity type")
        deal = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        item = repository.create_activity(
            tenant_id=tenant_id,
            deal_id=deal_id,
            activity_type=payload.activity_type,
            subject=payload.subject,
            body=payload.body,
            created_by=current_user.username,
            account_id=deal.get("account_id"),
            contact_id=deal.get("contact_id"),
            conn=conn,
        )
        conn.commit()
        return {"item": item}
    finally:
        conn.close()
