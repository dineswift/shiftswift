"""Profile change request routes — employee submit and HR review."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import get_employee_user, get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.employees import profile_change_requests as service
from modules.time_punch.service import resolve_employee

settings = load_settings()

admin_router = APIRouter(
    prefix="/admin/profile-changes",
    tags=["Profile changes"],
    dependencies=[Depends(require_tenant_subscription)],
)

employee_router = APIRouter(
    prefix="/employee/me/profile-changes",
    tags=["Profile changes employee"],
    dependencies=[Depends(require_tenant_subscription)],
)


class ProfileChangeCreate(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    home_address: str | None = Field(default=None, max_length=500)
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    emergency_contact_relationship: str | None = Field(default=None, max_length=80)
    employee_note: str | None = Field(default=None, max_length=2000)


class ProfileChangeReview(BaseModel):
    decision: str = Field(min_length=1, max_length=20)
    review_note: str | None = Field(default=None, max_length=2000)


def _employee_for_user(*, tenant_id: int, user: AuthUser, conn: Any) -> dict[str, Any]:
    employee = resolve_employee(tenant_id=tenant_id, username=user.username, conn=conn)
    if not employee:
        raise HTTPException(
            status_code=404,
            detail="No employee record linked to this login — ask HR to add your work email to your employee profile.",
        )
    return employee


@admin_router.get("/requests")
def list_admin_profile_change_requests(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    status: str | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = service.list_profile_change_requests(
            tenant_id=tenant_id,
            conn=conn,
            status=status,
            employee_id=employee_id,
        )
        pending = service.count_pending_profile_change_requests(tenant_id=tenant_id, conn=conn)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"items": items, "count": len(items), "pending_count": pending}


@admin_router.post("/requests/{request_id}/review")
def review_admin_profile_change_request(
    request_id: int,
    payload: ProfileChangeReview,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        item = service.review_profile_change_request(
            tenant_id=tenant_id,
            request_id=request_id,
            decision=payload.decision,
            reviewed_by=current_user.username,
            review_note=payload.review_note,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return item


@employee_router.get("/details")
def my_profile_details(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return service.get_current_details(
            tenant_id=tenant_id,
            employee_id=int(employee["id"]),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@employee_router.get("/requests")
def my_profile_change_requests(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        items = service.list_profile_change_requests(
            tenant_id=tenant_id,
            conn=conn,
            employee_id=int(employee["id"]),
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@employee_router.post("/requests")
def create_my_profile_change_request(
    payload: ProfileChangeCreate,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        updates = payload.model_dump(exclude={"employee_note"}, exclude_none=True)
        item = service.create_profile_change_request(
            tenant_id=tenant_id,
            employee_id=int(employee["id"]),
            updates=updates,
            employee_note=payload.employee_note,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return item


@employee_router.post("/requests/{request_id}/cancel")
def cancel_my_profile_change_request(
    request_id: int,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        item = service.cancel_profile_change_request(
            tenant_id=tenant_id,
            request_id=request_id,
            employee_id=int(employee["id"]),
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
    return item
