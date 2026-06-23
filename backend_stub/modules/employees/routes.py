"""Employee workspace HTTP routes — sectioned profile editing."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import client_ip, get_hr_user, require_tenant_subscription, resolve_tenant_id
from employee_audit import log_employee_data_event
from modules.employees.constants import DOCUMENT_SECTIONS, LINK_ONLY_SECTIONS, SECTION_ORDER
from modules.employees.repository import fetch_employee
from modules.documents.service import (
    create_employee_document,
    delete_employee_document,
    get_employee_document,
    list_employee_documents,
    requirements_status,
    update_employee_document,
)
from modules.employees.workspace import build_workspace, patch_section

router = APIRouter(
    prefix="/admin/employees",
    tags=["Employee Workspace"],
    dependencies=[Depends(require_tenant_subscription)],
)
settings = load_settings()

VALID_SECTIONS = frozenset(SECTION_ORDER) - LINK_ONLY_SECTIONS - DOCUMENT_SECTIONS


class SectionPatch(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: EmailStr | None = None
    status: str | None = Field(
        default=None,
        pattern="^(active|inactive|onboarding|suspended|terminated)$",
    )
    start_date: date | None = None
    worker_type: str | None = Field(default=None, pattern="^(standard|sponsored)$")
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    employment_type: str | None = Field(
        default=None,
        pattern="^(full_time|part_time|zero_hours|fixed_term|casual)$",
    )
    contract_hours_weekly: float | None = Field(default=None, ge=0, le=168)
    salary: float | None = Field(default=None, ge=0)
    work_location: str | None = Field(default=None, max_length=200)
    probation_end_date: date | None = None
    phone: str | None = Field(default=None, max_length=32)
    date_of_birth: date | None = None
    home_address: str | None = Field(default=None, max_length=500)
    ni_number: str | None = Field(default=None, max_length=16)
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    emergency_contact_relationship: str | None = Field(default=None, max_length=80)
    visa_type: str | None = Field(default=None, max_length=80)
    visa_expiry_date: date | None = None
    share_code: str | None = Field(default=None, max_length=32)
    cos_reference: str | None = Field(default=None, max_length=64)
    rtw_status: str | None = Field(
        default=None,
        pattern="^(pending|verified|time_limited|failed)$",
    )
    termination_date: date | None = None
    termination_reason: str | None = Field(default=None, max_length=500)


class EmployeeDocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="general", max_length=64)
    lifecycle_stage: str = Field(default="document_store", max_length=64)
    document_url: str | None = Field(default=None, max_length=2048)
    notes: str | None = Field(default=None, max_length=4000)
    expires_at: date | None = None
    original_filename: str | None = Field(default=None, max_length=255)


class EmployeeDocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=64)
    lifecycle_stage: str | None = Field(default=None, max_length=64)
    document_url: str | None = Field(default=None, max_length=2048)
    notes: str | None = Field(default=None, max_length=4000)
    expires_at: date | None = None
    original_filename: str | None = Field(default=None, max_length=255)


class BulkPortalInviteRequest(BaseModel):
    resend_existing: bool = Field(default=False)


class EmployeeNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    visibility: str = Field(default="hr_internal", pattern="^(hr_internal|employee_visible)$")


@router.post("/invite-portal")
def bulk_invite_employees_to_portal(
    payload: BulkPortalInviteRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.employees.portal_invites import invite_missing_portal_accounts

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return invite_missing_portal_accounts(
            tenant_id=tenant_id,
            conn=conn,
            settings=settings,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            resend_existing=payload.resend_existing,
        )
    finally:
        conn.close()


@router.get("/{employee_id}")
def read_employee(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    finally:
        conn.close()
    if not employee:
        raise HTTPException(status_code=404, detail="employee not found")
    return employee


@router.get("/{employee_id}/workspace")
def read_employee_workspace(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return build_workspace(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/{employee_id}/history")
def read_employee_history(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.employees.entity_history import list_employee_versions

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
        if not employee:
            raise HTTPException(status_code=404, detail="employee not found")
        versions = list_employee_versions(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
        return {"employee_id": employee_id, "versions": versions}
    finally:
        conn.close()


@router.patch("/{employee_id}/sections/{section}")
def patch_employee_section(
    employee_id: int,
    section: str,
    payload: SectionPatch,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    if section not in VALID_SECTIONS:
        raise HTTPException(status_code=404, detail="unknown section")
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        workspace = patch_section(
            tenant_id=tenant_id,
            employee_id=employee_id,
            section=section,
            updates=updates,
            actor_username=current_user.username,
            actor_role=current_user.role,
            conn=conn,
        )
        log_employee_data_event(
            tenant_id=tenant_id,
            actor_username=current_user.username,
            actor_role=current_user.role,
            action="update",
            entity_type="employee_section",
            entity_id=employee_id,
            field_name=f"{section}:{','.join(updates.keys())}",
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
    return workspace


@router.post("/{employee_id}/invite-portal")
def invite_employee_to_portal_route(
    employee_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.employees.portal_invites import invite_employee_to_portal

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return invite_employee_to_portal(
            tenant_id=tenant_id,
            employee_id=employee_id,
            conn=conn,
            settings=settings,
            actor_username=current_user.username,
            actor_role=current_user.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            resend_if_exists=True,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/{employee_id}/documents/requirements")
def read_employee_document_requirements(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
        if not employee:
            raise HTTPException(status_code=404, detail="employee not found")
        documents = list_employee_documents(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
        return requirements_status(is_sponsored=bool(employee.get("is_sponsored")), documents=documents)
    finally:
        conn.close()


@router.get("/{employee_id}/documents")
def read_employee_documents(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        if not fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn):
            raise HTTPException(status_code=404, detail="employee not found")
        items = list_employee_documents(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/{employee_id}/documents/upload")
async def upload_employee_document(
    employee_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(default="general"),
    lifecycle_stage: str = Form(default="document_store"),
    notes: str | None = Form(default=None),
    expires_at: date | None = Form(default=None),
    pay_period: str | None = Form(default=None),
    notify_employee: bool = Form(default=True),
    send_email: bool = Form(default=True),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.documents.notifications import load_document_notification_targets, notify_document_recipients
    from modules.documents.service import (
        create_employee_document,
        delete_employee_document,
        update_employee_document,
    )
    from modules.documents.storage import read_validated_upload, write_document_file

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    file_bytes, content_type, ext = await read_validated_upload(file, max_bytes=settings.max_upload_bytes)
    normalized_pay_period = (pay_period or "").strip() or None
    if category == "payslip" and not normalized_pay_period:
        raise HTTPException(status_code=400, detail="Pay period is required for payslip uploads (e.g. 2026-04 or April 2026)")
    conn = get_connection()
    notifications: dict[str, int] | None = None
    doc: dict[str, object] | None = None
    try:
        if not fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn):
            raise HTTPException(status_code=404, detail="employee not found")
        doc = create_employee_document(
            tenant_id=tenant_id,
            employee_id=employee_id,
            data={
                "title": title.strip(),
                "category": category,
                "lifecycle_stage": lifecycle_stage,
                "notes": notes or "File stored on ShiftSwift HR",
                "expires_at": expires_at,
                "original_filename": file.filename,
                "pay_period": normalized_pay_period,
            },
            uploaded_by=current_user.username,
            conn=conn,
        )
        file_saved = False
        try:
            storage_path, content_sha256, file_size = write_document_file(
                tenant_id=tenant_id,
                document_id=int(doc["id"]),
                title=title.strip(),
                original_filename=file.filename,
                data=file_bytes,
                content_type=content_type,
                ext=ext,
                scope="employee",
                employee_id=employee_id,
            )
            doc = update_employee_document(
                tenant_id=tenant_id,
                employee_id=employee_id,
                document_id=int(doc["id"]),
                updates={
                    "storage_path": storage_path,
                    "content_sha256": content_sha256,
                    "content_type": content_type,
                    "file_size_bytes": file_size,
                    "original_filename": file.filename,
                },
                conn=conn,
            )
            file_saved = True
        except Exception:
            if not file_saved and doc.get("id") is not None:
                try:
                    delete_employee_document(
                        tenant_id=tenant_id,
                        employee_id=employee_id,
                        document_id=int(doc["id"]),
                        conn=conn,
                    )
                except Exception:
                    pass
            raise
        log_employee_data_event(
            tenant_id=tenant_id,
            actor_username=current_user.username,
            actor_role=current_user.role,
            action="upload",
            entity_type="employee_document",
            entity_id=doc["id"],
            field_name=f"employee_id={employee_id}",
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
        if notify_employee:
            targets = load_document_notification_targets(
                tenant_id=tenant_id,
                employee_id=employee_id,
                conn=conn,
            )
            if targets:
                notifications = notify_document_recipients(
                    tenant_id=tenant_id,
                    employees=targets,
                    document_id=int(doc["id"]),
                    document_scope="employee",
                    document_title=title.strip(),
                    category=category,
                    pay_period=normalized_pay_period,
                    send_email=send_email,
                    conn=conn,
                    commit=False,
                )
        conn.commit()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    if notifications is not None:
        return {**doc, "notifications": notifications}
    return doc


@router.get("/{employee_id}/documents/{document_id}/file")
def download_employee_document_file(
    employee_id: int,
    document_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    from fastapi.responses import FileResponse

    from modules.documents.storage import download_filename, resolve_stored_file

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        doc = get_employee_document(
            tenant_id=tenant_id,
            employee_id=employee_id,
            document_id=document_id,
            conn=conn,
        )
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


@router.post("/{employee_id}/documents")
def add_employee_document(
    employee_id: int,
    payload: EmployeeDocumentCreate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        if not fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn):
            raise HTTPException(status_code=404, detail="employee not found")
        doc = create_employee_document(
            tenant_id=tenant_id,
            employee_id=employee_id,
            data=payload.model_dump(),
            uploaded_by=current_user.username,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return doc


@router.patch("/{employee_id}/documents/{document_id}")
def patch_employee_document(
    employee_id: int,
    document_id: int,
    payload: EmployeeDocumentUpdate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        if not fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn):
            raise HTTPException(status_code=404, detail="employee not found")
        return update_employee_document(
            tenant_id=tenant_id,
            employee_id=employee_id,
            document_id=document_id,
            updates=updates,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.delete("/{employee_id}/documents/{document_id}")
def remove_employee_document(
    employee_id: int,
    document_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, str]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        delete_employee_document(
            tenant_id=tenant_id,
            employee_id=employee_id,
            document_id=document_id,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"status": "deleted"}


@router.get("/{employee_id}/notes")
def list_employee_notes(
    employee_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.employee_notes.service import list_notes_for_hr

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = list_notes_for_hr(
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
    return {"items": items, "count": len(items)}


@router.post("/{employee_id}/notes")
def create_employee_note(
    employee_id: int,
    payload: EmployeeNoteCreate,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.employee_notes.service import create_note

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return create_note(
            tenant_id=tenant_id,
            employee_id=employee_id,
            body=payload.body,
            visibility=payload.visibility,
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
