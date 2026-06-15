"""CRM add-on HTTP routes — accounts, contacts, deals pipeline."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.crm.constants import (
    ACCOUNT_TYPE_LABELS,
    ACTIVITY_TYPES,
    ACTIVITY_TYPE_LABELS,
    DEAL_CATEGORY_LABELS,
)
from modules.crm.export import build_accounts_csv, build_contacts_csv, build_deals_csv
from modules.crm.import_csv import import_accounts, import_contacts, parse_accounts_csv, parse_contacts_csv
from modules.crm import repository
from modules.crm.storage import resolve_crm_file, validate_upload, write_crm_file
from modules.crm.service import (
    build_account_detail,
    build_contact_detail,
    build_pipeline_board,
    require_crm_addon,
    validate_account,
    validate_account_type,
    validate_contact,
    validate_deal_category,
    validate_stage,
)
from modules.crm import ai_service, email_service, email_templates

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
    industry: str | None = Field(default=None, max_length=120)
    account_type: str = Field(default="prospect", pattern="^(prospect|customer|partner)$")
    notes: str | None = Field(default=None, max_length=4000)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=500)
    industry: str | None = Field(default=None, max_length=120)
    account_type: str | None = Field(default=None, pattern="^(prospect|customer|partner)$")
    notes: str | None = Field(default=None, max_length=4000)


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    account_id: int | None = None
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=4000)


class ContactPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    account_id: int | None = None
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=4000)


class DealCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    stage_id: int | None = None
    account_id: int | None = None
    contact_id: int | None = None
    value_gbp: float | None = Field(default=None, ge=0)
    expected_close_date: date | None = None
    deal_category: str = Field(default="general", pattern="^(general|it_services|hr_software|consulting|support_contract|hospitality|other)$")
    notes: str | None = Field(default=None, max_length=4000)


class DealPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    stage_id: int | None = None
    account_id: int | None = None
    contact_id: int | None = None
    value_gbp: float | None = Field(default=None, ge=0)
    expected_close_date: date | None = None
    deal_category: str | None = Field(
        default=None,
        pattern="^(general|it_services|hr_software|consulting|support_contract|hospitality|other)$",
    )
    notes: str | None = Field(default=None, max_length=4000)


class ActivityCreate(BaseModel):
    activity_type: str = Field(default="note", pattern="^(note|call|email|meeting|demo)$")
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=4000)


class SendDealEmailRequest(BaseModel):
    to_email: EmailStr
    subject: str = Field(min_length=1, max_length=200)
    body_html: str = Field(min_length=1, max_length=20000)
    body_text: str | None = Field(default=None, max_length=20000)
    template_key: str | None = Field(default=None, max_length=64)


class EmailPreviewRequest(BaseModel):
    template_key: str = Field(min_length=1, max_length=64)
    custom_message: str | None = Field(default=None, max_length=2000)


class AiDraftEmailRequest(BaseModel):
    custom_message: str | None = Field(default=None, max_length=2000)


def _crm_context(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> tuple[int, AuthUser, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    require_crm_addon(tenant_id=tenant_id, conn=conn)
    return tenant_id, current_user, conn


@router.get("/meta")
def crm_meta(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    _crm_context(current_user, x_tenant_id)
    return {
        "deal_categories": [
            {"id": key, "label": DEAL_CATEGORY_LABELS[key]}
            for key in ("general", "it_services", "hr_software", "consulting", "support_contract", "hospitality", "other")
        ],
        "account_types": [
            {"id": key, "label": ACCOUNT_TYPE_LABELS[key]} for key in ("prospect", "customer", "partner")
        ],
        "activity_types": [
            {"id": key, "label": ACTIVITY_TYPE_LABELS[key]}
            for key in ("note", "call", "email", "meeting", "demo")
        ],
    }


@router.get("/summary")
def crm_summary(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        dashboard = repository.build_dashboard_stats(tenant_id=tenant_id, conn=conn)
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn)
        conn.commit()
        return {
            **dashboard,
            "pipeline_name": board["pipeline"]["name"],
        }
    finally:
        conn.close()


@router.get("/dashboard")
def crm_dashboard(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn)
        stats = repository.build_dashboard_stats(tenant_id=tenant_id, conn=conn)
        conn.commit()
        return {**stats, "pipeline_name": board["pipeline"]["name"]}
    finally:
        conn.close()


@router.get("/pipeline")
def crm_pipeline(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    q: str | None = Query(default=None, max_length=120),
    category: str | None = Query(default=None, max_length=32),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        if category:
            validate_deal_category(category)
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn, q=q, category=category)
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
            industry=payload.industry,
            account_type=validate_account_type(payload.account_type),
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
        if "account_type" in updates and updates["account_type"] is not None:
            updates["account_type"] = validate_account_type(updates["account_type"])
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
            department=payload.department,
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
            deal_category=validate_deal_category(payload.deal_category),
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
        if "deal_category" in updates and updates["deal_category"] is not None:
            updates["deal_category"] = validate_deal_category(updates["deal_category"])
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
        documents = repository.list_documents(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        return {"items": items, "count": len(items), "deal": deal, "documents": documents}
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


def _business_name(*, tenant_id: int, conn: Any) -> str:
    from admin_service import get_tenant_profile

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    return (profile.get("trading_name") or profile.get("name") or "Our team").strip()


@router.get("/email-templates")
def crm_email_templates(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        items = email_templates.list_templates(tenant_id=tenant_id, conn=conn)
        conn.commit()
        return {"items": items, "count": len(items)}
    finally:
        conn.close()


@router.post("/deals/{deal_id}/email/preview")
def crm_preview_deal_email(
    deal_id: int,
    payload: EmailPreviewRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        deal = repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
        template = email_templates.fetch_template(
            tenant_id=tenant_id,
            template_key=payload.template_key,
            conn=conn,
        )
        if not template:
            raise HTTPException(status_code=404, detail="Email template not found")
        context = email_service.build_email_context(
            deal=deal,
            business_name=_business_name(tenant_id=tenant_id, conn=conn),
            sender_name=current_user.username,
            custom_message=payload.custom_message or "",
        )
        rendered = email_templates.render_template(template, context=context)
        conn.commit()
        return {
            "template_key": payload.template_key,
            "to_email": deal.get("contact_email") or deal.get("account_email"),
            **rendered,
        }
    finally:
        conn.close()


@router.post("/deals/{deal_id}/send-email")
def crm_send_deal_email(
    deal_id: int,
    payload: SendDealEmailRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        result = email_service.send_deal_email(
            tenant_id=tenant_id,
            deal_id=deal_id,
            to_email=str(payload.to_email),
            subject=payload.subject,
            body_html=payload.body_html,
            body_text=payload.body_text,
            sender_name=current_user.username,
            created_by=current_user.username,
            conn=conn,
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/deals/{deal_id}/ai/summary")
def crm_ai_deal_summary(
    deal_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        result = ai_service.summarize_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/deals/{deal_id}/ai/draft-email")
def crm_ai_draft_email(
    deal_id: int,
    payload: AiDraftEmailRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        result = ai_service.draft_follow_up_email(
            tenant_id=tenant_id,
            deal_id=deal_id,
            conn=conn,
            custom_message=payload.custom_message,
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.get("/export/accounts.csv")
def crm_export_accounts_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        items = repository.list_accounts(tenant_id=tenant_id, conn=conn)
        body = build_accounts_csv(items)
        return Response(
            content=body,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="crm-companies-{tenant_id}.csv"'},
        )
    finally:
        conn.close()


@router.get("/export/contacts.csv")
def crm_export_contacts_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        items = repository.list_contacts(tenant_id=tenant_id, conn=conn)
        body = build_contacts_csv(items)
        return Response(
            content=body,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="crm-contacts-{tenant_id}.csv"'},
        )
    finally:
        conn.close()


@router.get("/export/deals.csv")
def crm_export_deals_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        board = build_pipeline_board(tenant_id=tenant_id, conn=conn)
        stage_labels = {stage["id"]: stage["label"] for stage in board.get("stages", [])}
        deals: list[dict[str, object]] = []
        for stage in board.get("stages", []):
            deals.extend(stage.get("deals") or [])
        body = build_deals_csv(deals=deals, stage_labels=stage_labels)
        return Response(
            content=body,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="crm-deals-{tenant_id}.csv"'},
        )
    finally:
        conn.close()


@router.post("/import/accounts")
async def crm_import_accounts_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    file: UploadFile = File(...),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        raw = (await file.read()).decode("utf-8-sig", errors="replace")
        rows = parse_accounts_csv(raw)
        if not rows:
            raise HTTPException(status_code=400, detail="No valid rows found — need a name column")
        result = import_accounts(
            tenant_id=tenant_id,
            rows=rows,
            owner_username=current_user.username,
            conn=conn,
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/import/contacts")
async def crm_import_contacts_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    file: UploadFile = File(...),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        raw = (await file.read()).decode("utf-8-sig", errors="replace")
        rows = parse_contacts_csv(raw)
        if not rows:
            raise HTTPException(status_code=400, detail="No valid rows found — need a name column")
        result = import_contacts(
            tenant_id=tenant_id,
            rows=rows,
            owner_username=current_user.username,
            conn=conn,
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/documents")
async def crm_upload_document(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    account_id: int | None = Form(default=None),
    contact_id: int | None = Form(default=None),
    deal_id: int | None = Form(default=None),
) -> dict[str, object]:
    tenant_id, current_user, conn = _crm_context(current_user, x_tenant_id)
    try:
        targets = sum(1 for value in (account_id, contact_id, deal_id) if value is not None)
        if targets != 1:
            raise HTTPException(status_code=400, detail="Attach to exactly one company, contact, or deal")
        if account_id is not None and not repository.fetch_account(
            tenant_id=tenant_id, account_id=account_id, conn=conn
        ):
            raise HTTPException(status_code=404, detail="Company not found")
        if contact_id is not None and not repository.fetch_contact(
            tenant_id=tenant_id, contact_id=contact_id, conn=conn
        ):
            raise HTTPException(status_code=404, detail="Contact not found")
        if deal_id is not None and not repository.fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn):
            raise HTTPException(status_code=404, detail="Deal not found")

        data = await file.read()
        content_type, ext = validate_upload(
            data=data,
            content_type=file.content_type,
            filename=file.filename,
        )
        doc_title = (title or file.filename or "Attachment").strip()[:200]
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO crm_documents (
                  tenant_id, account_id, contact_id, deal_id, title, original_filename,
                  storage_path, content_type, file_size_bytes, content_sha256, uploaded_by
                ) VALUES (%s, %s, %s, %s, %s, %s, '', %s, 0, '', %s)
                RETURNING id
                """,
                (
                    tenant_id,
                    account_id,
                    contact_id,
                    deal_id,
                    doc_title,
                    file.filename,
                    content_type,
                    current_user.username,
                ),
            )
            document_id = int(cur.fetchone()[0])
        storage_path, digest, size = write_crm_file(
            tenant_id=tenant_id,
            document_id=document_id,
            title=doc_title,
            original_filename=file.filename,
            data=data,
            content_type=content_type,
            ext=ext,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE crm_documents
                SET storage_path = %s, content_sha256 = %s, file_size_bytes = %s
                WHERE tenant_id = %s AND id = %s
                """,
                (storage_path, digest, size, tenant_id, document_id),
            )
        item = repository.fetch_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
        if item:
            item.pop("storage_path", None)
        conn.commit()
        return {"item": item}
    finally:
        conn.close()


@router.get("/documents/{document_id}/download")
def crm_download_document(
    document_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> FileResponse:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        doc = repository.fetch_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        path = resolve_crm_file(tenant_id=tenant_id, storage_path=doc["storage_path"])
        filename = doc.get("original_filename") or doc.get("title") or f"crm-document-{document_id}"
        return FileResponse(
            path,
            media_type=doc.get("content_type") or "application/octet-stream",
            filename=filename,
        )
    finally:
        conn.close()


@router.delete("/documents/{document_id}")
def crm_delete_document(
    document_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id, _, conn = _crm_context(current_user, x_tenant_id)
    try:
        doc = repository.delete_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        try:
            path = resolve_crm_file(tenant_id=tenant_id, storage_path=doc["storage_path"])
            path.unlink(missing_ok=True)
        except HTTPException:
            pass
        conn.commit()
        return {"deleted": True, "id": document_id}
    finally:
        conn.close()
