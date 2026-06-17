"""Admin workspace API — shared metadata, tenant profile, employees, documents."""

from __future__ import annotations

import os
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field

from modules.documents.constants import (
    DOCUMENT_FORM_LIFECYCLE_STAGES,
    DOCUMENT_LIFECYCLE_STAGES,
    EXPIRY_ALERT_DAY_OPTIONS,
)
from modules.employees.constants import (
    EMPLOYEE_DOCUMENT_CATEGORIES,
    EMPLOYMENT_TYPES,
    RTW_STATUSES,
    SECTION_BRANCHES as EMPLOYEE_SECTION_BRANCHES,
    SECTION_DESCRIPTIONS as EMPLOYEE_SECTION_DESCRIPTIONS,
    SECTION_LABELS as EMPLOYEE_SECTION_LABELS,
    SECTION_ORDER as EMPLOYEE_SECTION_ORDER,
    SECTION_STEPS as EMPLOYEE_SECTION_STEPS,
    WORKER_TYPES,
)
from modules.grievance.constants import ALLEGATION_TYPES, SEVERITY_LEVELS, STATUS_WORKFLOW
from modules.disciplinary.constants import (
    CLOSE_OUTCOMES,
    MISCONDUCT_TYPES,
    SEVERITY_LEVELS as DISCIPLINARY_SEVERITY_LEVELS,
    STATUS_WORKFLOW as DISCIPLINARY_STATUS_WORKFLOW,
)
from modules.recruitment.constants import (
    HIRING_DECISIONS,
    OFFER_STATUSES,
    POSTING_PLATFORMS,
    SECTION_BRANCHES as RECRUITMENT_SECTION_BRANCHES,
    SECTION_DESCRIPTIONS as RECRUITMENT_SECTION_DESCRIPTIONS,
    SECTION_LABELS as RECRUITMENT_SECTION_LABELS,
    SECTION_ORDER as RECRUITMENT_SECTION_ORDER,
    RECRUITMENT_DEPARTMENTS,
    SECTION_STEPS as RECRUITMENT_SECTION_STEPS,
)
from admin_service import (
    ADVERT_PLATFORMS,
    DOCUMENT_CATEGORIES,
    EMPLOYEE_STATUSES,
    admin_overview,
    create_document,
    create_employee,
    delete_document,
    delete_employee,
    get_tenant_profile,
    list_documents,
    list_employees,
    get_notification_preferences,
    update_notification_preferences,
    update_document,
    update_employee,
    update_tenant_profile,
)
from auth_service import AuthUser
from billing_plans import list_plans
from billing_promotions import list_discount_codes, list_referral_codes
from partner_commission_service import (
    build_introducer_commission_csv,
    fetch_introducer_commission_rows,
    introducer_export_filename,
)
from payroll_plans import list_payroll_plans
from contracts_service import TEMPLATE_REGISTRY
from deps import client_ip, get_admin_user, get_hr_user, require_tenant_subscription, resolve_tenant_id
from config import load_settings
from employee_audit import log_employee_data_event
from sponsor_licence_compliance import absence_type_catalog
from brand import brand_payload

router = APIRouter(
    prefix="/admin",
    tags=["Admin Workspace"],
    dependencies=[Depends(require_tenant_subscription)],
)
settings = load_settings()


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


class TenantProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    trading_name: str | None = Field(default=None, max_length=200)
    company_number: str | None = Field(default=None, max_length=32)
    registered_address: str | None = Field(default=None, max_length=500)
    registered_latitude: float | None = Field(default=None, ge=49.0, le=61.5)
    registered_longitude: float | None = Field(default=None, ge=-9.0, le=2.5)
    phone: str | None = Field(default=None, max_length=32)
    billing_email: str | None = Field(default=None, max_length=254)
    vat_number: str | None = Field(default=None, max_length=32)
    signatory_name: str | None = Field(default=None, max_length=120)
    signatory_title: str | None = Field(default=None, max_length=120)
    signatory_email: str | None = Field(default=None, max_length=254)
    payroll_accountant_email: str | None = Field(default=None, max_length=254)
    payroll_hours_report_enabled: bool | None = None
    rota_mode: str | None = Field(default=None, pattern="^(basic|advanced|multi_site)$")
    rota_week_start_day: int | None = Field(default=None, ge=0, le=6)


class PayrollHoursEmailRequest(BaseModel):
    accountant_email: str | None = Field(default=None, max_length=254)
    use_previous_month: bool = True


class NotificationPreferencesUpdate(BaseModel):
    preferences: dict[str, str] | None = None
    employee_display_name: str | None = Field(default=None, max_length=120)


class EmployeeCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: EmailStr | None = None
    job_title: str | None = Field(default=None, max_length=120)
    salary: float | None = Field(default=None, ge=0)
    work_location: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    status: str = Field(
        default="active",
        pattern="^(active|inactive|onboarding|suspended|terminated)$",
    )
    is_sponsored: bool = False
    visa_type: str | None = Field(default=None, max_length=80)
    visa_expiry_date: date | None = None
    share_code: str | None = Field(default=None, max_length=32)


class EmployeeUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: EmailStr | None = None
    job_title: str | None = Field(default=None, max_length=120)
    salary: float | None = Field(default=None, ge=0)
    work_location: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    status: str | None = Field(
        default=None,
        pattern="^(active|inactive|onboarding|suspended|terminated)$",
    )
    is_sponsored: bool | None = None
    status_reason: str | None = Field(default=None, max_length=500)


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="general", max_length=64)
    lifecycle_stage: str = Field(default="general", max_length=64)
    document_url: str | None = Field(default=None, max_length=2048)
    notes: str | None = Field(default=None, max_length=4000)
    expires_at: date | None = None
    expiry_alert_days: int = Field(default=30, ge=30, le=90)
    original_filename: str | None = Field(default=None, max_length=255)
    employee_id: int | None = None
    employee_visible: bool = False


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=64)
    lifecycle_stage: str | None = Field(default=None, max_length=64)
    document_url: str | None = Field(default=None, max_length=2048)
    notes: str | None = Field(default=None, max_length=4000)
    expires_at: date | None = None
    expiry_alert_days: int | None = Field(default=None, ge=30, le=90)
    original_filename: str | None = Field(default=None, max_length=255)
    employee_id: int | None = None
    employee_visible: bool | None = None


@router.get("/metadata")
def admin_metadata() -> dict[str, object]:
    platform_plans = [
        {"value": p.id, "label": f"{p.name} — £{p.price_gbp_ex_vat:.2f}/mo ex VAT"}
        for p in list_plans()
    ]
    payroll_plans = [
        {"value": p.id, "label": f"{p.name} — £{p.price_gbp_ex_vat:.2f}/mo ex VAT"}
        for p in list_payroll_plans()
    ]
    templates = [
        {"value": tid, "label": meta["name"]}
        for tid, meta in TEMPLATE_REGISTRY.items()
    ]
    templates.append({"value": "pack", "label": "Full pack (MSA + DPA + Order)"})
    from plan_features import ROTA_MODE_LABELS, ROTA_MODES, UPGRADE_MESSAGES
    from modules.documents.storage import document_upload_policy

    return {
        "brand": brand_payload(),
        "advert_platforms": ADVERT_PLATFORMS,
        "document_categories": DOCUMENT_CATEGORIES,
        "document_upload": document_upload_policy(max_bytes=settings.max_upload_bytes),
        "document_lifecycle_stages": DOCUMENT_LIFECYCLE_STAGES,
        "document_form_lifecycle_stages": DOCUMENT_FORM_LIFECYCLE_STAGES,
        "document_expiry_alert_days": EXPIRY_ALERT_DAY_OPTIONS,
        "employee_statuses": EMPLOYEE_STATUSES,
        "employment_types": EMPLOYMENT_TYPES,
        "worker_types": WORKER_TYPES,
        "employee_sections": [
            {
                "value": key,
                "step": EMPLOYEE_SECTION_STEPS[key],
                "label": EMPLOYEE_SECTION_LABELS[key],
                "description": EMPLOYEE_SECTION_DESCRIPTIONS[key],
                "branch": EMPLOYEE_SECTION_BRANCHES.get(key),
            }
            for key in EMPLOYEE_SECTION_ORDER
        ],
        "employee_lifecycle": [
            {
                "value": key,
                "step": EMPLOYEE_SECTION_STEPS[key],
                "label": EMPLOYEE_SECTION_LABELS[key],
                "description": EMPLOYEE_SECTION_DESCRIPTIONS[key],
            }
            for key in EMPLOYEE_SECTION_ORDER
        ],
        "recruitment_pipeline": [
            {
                "value": key,
                "step": RECRUITMENT_SECTION_STEPS[key],
                "label": RECRUITMENT_SECTION_LABELS[key],
                "description": RECRUITMENT_SECTION_DESCRIPTIONS[key],
                "branch": RECRUITMENT_SECTION_BRANCHES.get(key),
            }
            for key in RECRUITMENT_SECTION_ORDER
        ],
        "recruitment_posting_platforms": POSTING_PLATFORMS,
        "recruitment_departments": RECRUITMENT_DEPARTMENTS,
        "hiring_decisions": HIRING_DECISIONS,
        "offer_statuses": OFFER_STATUSES,
        "grievance_allegation_types": ALLEGATION_TYPES,
        "grievance_severities": SEVERITY_LEVELS,
        "grievance_status_workflow": STATUS_WORKFLOW,
        "disciplinary_misconduct_types": MISCONDUCT_TYPES,
        "disciplinary_severities": DISCIPLINARY_SEVERITY_LEVELS,
        "disciplinary_status_workflow": DISCIPLINARY_STATUS_WORKFLOW,
        "disciplinary_close_outcomes": CLOSE_OUTCOMES,
        "employee_document_categories": EMPLOYEE_DOCUMENT_CATEGORIES,
        "rtw_statuses": RTW_STATUSES,
        "absence_excuse_types": [
            {"value": item["value"], "label": item["label"]}
            for item in absence_type_catalog()
        ],
        "platform_plans": platform_plans,
        "payroll_plans": payroll_plans,
        "contract_templates": templates,
        "rota_mode_labels": ROTA_MODE_LABELS,
        "rota_modes_all": list(ROTA_MODES),
        "upgrade_messages": UPGRADE_MESSAGES,
    }


@router.get("/overview")
def get_overview(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return admin_overview(tenant_id=tenant_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/tenant-profile")
def read_tenant_profile(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return get_tenant_profile(tenant_id=tenant_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/address-search")
def search_business_addresses(
    q: Annotated[str, Query(min_length=3, max_length=200)],
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    limit: Annotated[int, Query(ge=1, le=8)] = 5,
) -> dict[str, object]:
    _ = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    from modules.time_punch.geocode import search_nominatim_addresses

    items = search_nominatim_addresses(q, limit=limit)
    return {"items": items, "count": len(items)}


@router.patch("/tenant-profile")
def patch_tenant_profile(
    payload: TenantProfileUpdate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    updates = payload.model_dump(exclude_unset=True)
    updates = {key: (None if value == "" else value) for key, value in updates.items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    conn = _db_conn()
    try:
        return update_tenant_profile(
            tenant_id=tenant_id,
            updates=updates,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/employees")
def read_employees(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        items = list_employees(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/employees")
def add_employee(
    payload: EmployeeCreate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return create_employee(
            tenant_id=tenant_id,
            data=payload.model_dump(),
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except ValueError as exc:
        from modules.employees.duplicates import DuplicateEmployeeError

        if isinstance(exc, DuplicateEmployeeError):
            raise HTTPException(status_code=409, detail=exc.as_detail()) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.patch("/employees/{employee_id}")
def patch_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    conn = _db_conn()
    try:
        return update_employee(
            tenant_id=tenant_id,
            employee_id=employee_id,
            updates=updates,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        from modules.employees.duplicates import DuplicateEmployeeError

        if isinstance(exc, DuplicateEmployeeError):
            raise HTTPException(status_code=409, detail=exc.as_detail()) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.delete("/employees/{employee_id}")
def remove_employee(
    employee_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, str]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        delete_employee(
            tenant_id=tenant_id,
            employee_id=employee_id,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"status": "deleted"}


@router.get("/documents/expiring")
def read_expiring_documents(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    import logging

    from modules.documents.service import list_expiring_documents

    logger = logging.getLogger(__name__)
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return list_expiring_documents(tenant_id=tenant_id, conn=conn)
    except Exception as exc:
        logger.exception("Failed to load expiring documents for tenant %s", tenant_id)
        raise HTTPException(
            status_code=503,
            detail="Document expiry list is unavailable. Run database migrations and try again.",
        ) from exc
    finally:
        conn.close()


@router.get("/documents")
def read_documents(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    category: str | None = None,
    lifecycle_stage: str | None = None,
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        items = list_documents(
            tenant_id=tenant_id,
            conn=conn,
            category=category,
            lifecycle_stage=lifecycle_stage,
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.get("/documents/export")
def export_documents(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    format: str = "csv",
    category: str | None = None,
    lifecycle_stage: str | None = None,
    employee_id: int | None = None,
    include_employee_documents: bool = True,
    include_rtw: bool = False,
):
    from fastapi.responses import Response

    from modules.documents.export import build_documents_csv, build_documents_zip
    from modules.documents.service import list_all_employee_documents, list_tenant_documents

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        tenant_docs = list_tenant_documents(
            tenant_id=tenant_id,
            conn=conn,
            category=category,
            lifecycle_stage=lifecycle_stage,
            employee_id=employee_id,
            limit=500,
        )
        employee_docs: list[dict[str, Any]] = []
        if include_employee_documents:
            employee_docs = list_all_employee_documents(
                tenant_id=tenant_id,
                conn=conn,
                employee_id=employee_id,
                category=category,
                lifecycle_stage=lifecycle_stage,
                limit=500,
            )
        rtw_checks: list[dict[str, Any]] = []
        if include_rtw:
            with conn.cursor() as cur:
                query = """
                    SELECT id, employee_id, check_date, content_sha256, storage_path
                    FROM right_to_work_checks
                    WHERE tenant_id = %s
                """
                params: list[Any] = [tenant_id]
                if employee_id is not None:
                    query += " AND employee_id = %s"
                    params.append(employee_id)
                query += " ORDER BY check_date DESC LIMIT 500"
                cur.execute(query, params)
                rtw_checks = [
                    {
                        "id": row[0],
                        "employee_id": row[1],
                        "check_date": row[2].isoformat() if row[2] else None,
                        "content_sha256": row[3],
                        "storage_path": row[4],
                    }
                    for row in cur.fetchall()
                ]
    finally:
        conn.close()

    if format.lower() == "zip":
        payload = build_documents_zip(
            tenant_id=tenant_id,
            tenant_documents=tenant_docs,
            employee_documents=employee_docs,
            rtw_checks=rtw_checks if include_rtw else None,
        )
        filename = f"shiftswift-documents-tenant-{tenant_id}.zip"
        return Response(
            content=payload,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    csv_body = build_documents_csv(
        tenant_id=tenant_id,
        tenant_documents=tenant_docs,
        employee_documents=employee_docs,
    )
    filename = f"shiftswift-documents-tenant-{tenant_id}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/documents/upload")
async def upload_tenant_document(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(default="general"),
    lifecycle_stage: str = Form(default="general"),
    notes: str | None = Form(default=None),
    expires_at: date | None = Form(default=None),
    expiry_alert_days: int = Form(default=30),
    employee_id: int | None = Form(default=None),
    employee_visible: bool = Form(default=False),
    notify_employees: bool = Form(default=False),
    notify_employee_ids: str | None = Form(default=None),
    send_email: bool = Form(default=True),
    pay_period: str | None = Form(default=None),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.documents.notifications import (
        load_document_notification_targets,
        notify_document_recipients,
        parse_employee_id_list,
    )
    import logging

    from modules.documents.errors import _rollback_quietly, document_service_error_message
    from modules.documents.service import create_tenant_document, update_tenant_document
    from modules.documents.storage import read_validated_upload, write_document_file

    logger = logging.getLogger(__name__)
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    file_bytes, content_type, ext = await read_validated_upload(file, max_bytes=settings.max_upload_bytes)
    conn = _db_conn()
    notifications: dict[str, int] | None = None
    doc: dict[str, object] | None = None
    try:
        doc = create_tenant_document(
            tenant_id=tenant_id,
            data={
                "title": title.strip(),
                "category": category,
                "lifecycle_stage": lifecycle_stage,
                "notes": notes or "File stored on ShiftSwift HR",
                "expires_at": expires_at,
                "expiry_alert_days": expiry_alert_days,
                "employee_visible": employee_visible,
                "original_filename": file.filename,
                "employee_id": employee_id,
            },
            uploaded_by=current_user.username,
            conn=conn,
        )
        storage_path, content_sha256, file_size = write_document_file(
            tenant_id=tenant_id,
            document_id=int(doc["id"]),
            title=title.strip(),
            original_filename=file.filename,
            data=file_bytes,
            content_type=content_type,
            ext=ext,
            scope="tenant",
        )
        doc = update_tenant_document(
            tenant_id=tenant_id,
            document_id=int(doc["id"]),
            updates={
                "storage_path": storage_path,
                "content_sha256": content_sha256,
                "content_type": content_type,
                "file_size_bytes": file_size,
                "original_filename": file.filename,
                "employee_id": employee_id,
            },
            conn=conn,
        )
        try:
            log_employee_data_event(
                tenant_id=tenant_id,
                actor_username=current_user.username,
                actor_role=current_user.role,
                action="upload",
                entity_type="tenant_document",
                entity_id=doc["id"],
                ip_address=client_ip(request),
                user_agent=request.headers.get("User-Agent"),
                conn=conn,
            )
        except Exception:
            logger.warning("Document upload audit log failed for tenant %s", tenant_id, exc_info=True)
            _rollback_quietly(conn)
        if employee_visible and notify_employees:
            selected_ids = parse_employee_id_list(notify_employee_ids)
            targets = load_document_notification_targets(
                tenant_id=tenant_id,
                employee_id=employee_id if selected_ids is None and employee_id is not None else None,
                employee_ids=selected_ids,
                conn=conn,
            )
            if not targets:
                raise ValueError("No employees selected to notify")
            try:
                notifications = notify_document_recipients(
                    tenant_id=tenant_id,
                    employees=targets,
                    document_id=int(doc["id"]),
                    document_scope="tenant",
                    document_title=title.strip(),
                    category=category,
                    pay_period=(pay_period or "").strip() or None,
                    send_email=send_email,
                    conn=conn,
                    commit=False,
                )
            except Exception:
                logger.exception("Document upload notifications failed for tenant %s", tenant_id)
                _rollback_quietly(conn)
        try:
            conn.commit()
        except Exception:
            _rollback_quietly(conn)
            raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=document_service_error_message(exc),
        ) from exc
    finally:
        conn.close()
    if notifications is not None:
        return {**doc, "notifications": notifications}
    return doc


@router.post("/documents/distribute")
async def distribute_document_route(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(default="payslip"),
    pay_period: str | None = Form(default=None),
    notes: str | None = Form(default=None),
    employee_id: int | None = Form(default=None),
    send_email: bool = Form(default=True),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    import logging

    from modules.documents.distribute import distribute_document
    from modules.documents.errors import _rollback_quietly
    from modules.documents.storage import read_validated_upload

    logger = logging.getLogger(__name__)
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    file_bytes, content_type, ext = await read_validated_upload(file, max_bytes=settings.max_upload_bytes)
    conn = _db_conn()
    try:
        result = distribute_document(
            tenant_id=tenant_id,
            file_bytes=file_bytes,
            content_type=content_type,
            ext=ext,
            original_filename=file.filename,
            title=title.strip(),
            category=category,
            pay_period=(pay_period or "").strip() or None,
            notes=notes,
            employee_id=employee_id,
            send_email=send_email,
            uploaded_by=current_user.username,
            conn=conn,
        )
        try:
            log_employee_data_event(
                tenant_id=tenant_id,
                actor_username=current_user.username,
                actor_role=current_user.role,
                action="distribute",
                entity_type="employee_document",
                entity_id=0,
                field_name=f"count={result['distributed_count']}",
                ip_address=client_ip(request),
                user_agent=request.headers.get("User-Agent"),
                conn=conn,
            )
        except Exception:
            logger.warning("Document distribute audit log failed for tenant %s", tenant_id, exc_info=True)
            _rollback_quietly(conn)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        from modules.documents.errors import document_service_error_message

        logger.exception("Document distribute failed for tenant %s", tenant_id)
        raise HTTPException(
            status_code=503,
            detail=document_service_error_message(exc),
        ) from exc
    finally:
        conn.close()
    return result


@router.get("/notification-preferences")
def read_notification_preferences(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return get_notification_preferences(tenant_id=tenant_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.patch("/notification-preferences")
def patch_notification_preferences(
    payload: NotificationPreferencesUpdate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    if payload.preferences is None and payload.employee_display_name is None:
        raise HTTPException(status_code=400, detail="No preferences to update")
    conn = _db_conn()
    try:
        return update_notification_preferences(
            tenant_id=tenant_id,
            preferences=payload.preferences,
            employee_display_name=payload.employee_display_name,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/documents/{document_id}/file")
def download_tenant_document_file(
    document_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    from fastapi.responses import FileResponse

    from modules.documents.service import get_tenant_document
    from modules.documents.storage import download_filename, resolve_stored_file

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        doc = get_tenant_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
    finally:
        conn.close()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = resolve_stored_file(tenant_id=tenant_id, storage_path=doc.get("storage_path"))
    filename = download_filename(
        title=str(doc.get("title") or "document"),
        original_filename=doc.get("original_filename"),
        storage_path=doc.get("storage_path"),
    )
    return FileResponse(
        path,
        media_type=doc.get("content_type") or "application/octet-stream",
        filename=filename,
    )


@router.post("/documents")
def add_document(
    payload: DocumentCreate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return create_document(
            tenant_id=tenant_id,
            data=payload.model_dump(),
            uploaded_by=current_user.username,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.patch("/documents/{document_id}")
def patch_document(
    document_id: int,
    payload: DocumentUpdate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        return update_document(
            tenant_id=tenant_id,
            document_id=document_id,
            updates=updates,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.delete("/documents/{document_id}")
def remove_document(
    document_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, str]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        delete_document(
            tenant_id=tenant_id,
            document_id=document_id,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"status": "deleted"}


@router.get("/billing/discount-codes")
def read_discount_codes(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        items = list_discount_codes(conn=conn)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.get("/billing/referral-codes")
def read_referral_codes(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        items = list_referral_codes(conn=conn)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.get("/billing/introducer-commission.csv")
def export_introducer_commission_csv(
    current_user: Annotated[AuthUser, Depends(get_admin_user)],
    referral_code: str | None = None,
):
    """Platform admin only — estimated introducer commissions for manual payout."""
    from fastapi.responses import Response

    conn = _db_conn()
    try:
        rows = fetch_introducer_commission_rows(conn=conn, referral_code=referral_code)
    finally:
        conn.close()
    csv_body = build_introducer_commission_csv(rows)
    filename = introducer_export_filename(referral_code=referral_code)
    return Response(
        content=csv_body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll-export/info")
def payroll_export_metadata(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.payroll_export.service import payroll_export_info
    from plan_features import assert_tenant_feature

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        assert_tenant_feature(tenant_id=tenant_id, feature="payroll", conn=conn)
        return payroll_export_info()
    finally:
        conn.close()


@router.get("/payroll-export/employees.csv")
def payroll_export_employees_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    from fastapi.responses import Response

    from modules.payroll_export.service import build_employees_csv
    from plan_features import assert_tenant_feature

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        assert_tenant_feature(tenant_id=tenant_id, feature="payroll", conn=conn)
        csv_body = build_employees_csv(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    filename = f"shiftswift-employees-tenant-{tenant_id}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll-export/hours.csv")
def payroll_export_hours_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    from_date: date | None = None,
    to_date: date | None = None,
):
    from fastapi.responses import Response

    from modules.payroll_export.service import build_hours_csv
    from plan_features import assert_tenant_feature

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        assert_tenant_feature(tenant_id=tenant_id, feature="payroll", conn=conn)
        csv_body = build_hours_csv(
            tenant_id=tenant_id,
            conn=conn,
            from_date=from_date,
            to_date=to_date,
        )
    finally:
        conn.close()
    filename = f"shiftswift-hours-tenant-{tenant_id}.csv"
    return Response(
        content=csv_body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll-export/hours.pdf")
def payroll_export_hours_pdf(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    from_date: date | None = None,
    to_date: date | None = None,
):
    from fastapi.responses import Response

    from modules.payroll_export.hours_pdf import hours_report_pdf_bytes
    from plan_features import assert_tenant_feature

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        assert_tenant_feature(tenant_id=tenant_id, feature="payroll", conn=conn)
        pdf_bytes = hours_report_pdf_bytes(
            tenant_id=tenant_id,
            conn=conn,
            from_date=from_date,
            to_date=to_date,
        )
    finally:
        conn.close()
    filename = f"shiftswift-hours-{from_date or 'month'}-{tenant_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/payroll-export/hours/email-now")
def email_payroll_hours_report_now(
    payload: PayrollHoursEmailRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.payroll_export.monthly_report import _previous_calendar_month, send_payroll_hours_report

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
        recipient = (payload.accountant_email or profile.get("payroll_accountant_email") or "").strip()
        if not recipient:
            raise HTTPException(
                status_code=400,
                detail="Add your accountant email in Time Clock settings before sending.",
            )
        today = date.today()
        if payload.use_previous_month:
            period_start, period_end = _previous_calendar_month(today)
        else:
            period_start = today.replace(day=1)
            period_end = today
        return send_payroll_hours_report(
            settings=settings,
            tenant_id=tenant_id,
            recipient_email=recipient,
            period_start=period_start,
            period_end=period_end,
            conn=conn,
            cc_hr_email=profile.get("billing_email"),
            allow_resend=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
