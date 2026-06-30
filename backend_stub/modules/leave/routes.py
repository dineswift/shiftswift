"""Leave routes — HR admin and employee self-service."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import get_employee_user, get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.leave import service as leave_service
from modules.time_punch.service import resolve_employee

settings = load_settings()

admin_router = APIRouter(
    prefix="/admin/leave",
    tags=["Leave"],
    dependencies=[Depends(require_tenant_subscription)],
)

employee_router = APIRouter(
    prefix="/employee/me/leave",
    tags=["Leave employee"],
    dependencies=[Depends(require_tenant_subscription)],
)


class LeaveRequestCreate(BaseModel):
    leave_type: str = Field(min_length=1, max_length=20)
    start_date: date
    end_date: date
    reason: str | None = Field(default=None, max_length=2000)


class LeaveReviewRequest(BaseModel):
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


@admin_router.get("/employees/{employee_id}/balance")
def admin_employee_leave_balance(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        balance = leave_service.leave_balance(
            tenant_id=tenant_id,
            employee_id=employee_id,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
    return balance


@admin_router.get("/requests")
def list_admin_leave_requests(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    status: str | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = leave_service.list_leave_requests(
            tenant_id=tenant_id,
            conn=conn,
            status=status,
            employee_id=employee_id,
        )
        pending = leave_service.count_pending_leave_requests(tenant_id=tenant_id, conn=conn)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"items": items, "count": len(items), "pending_count": pending}


@admin_router.post("/requests/{request_id}/review")
def review_admin_leave_request(
    request_id: int,
    payload: LeaveReviewRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        item = leave_service.review_leave_request(
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


@employee_router.get("/balance")
def my_leave_balance(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        balance = leave_service.leave_balance(
            tenant_id=tenant_id,
            employee_id=int(employee["id"]),
            conn=conn,
        )
    finally:
        conn.close()
    return balance


@employee_router.get("/requests")
def my_leave_requests(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        items = leave_service.list_leave_requests(
            tenant_id=tenant_id,
            conn=conn,
            employee_id=int(employee["id"]),
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@employee_router.post("/requests")
def create_my_leave_request(
    payload: LeaveRequestCreate,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        item = leave_service.create_leave_request(
            tenant_id=tenant_id,
            employee_id=int(employee["id"]),
            leave_type=payload.leave_type,
            start_date=payload.start_date,
            end_date=payload.end_date,
            reason=payload.reason,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        try:
            from admin_service import get_notification_preferences
            from modules.push.hr_notify import notify_hr_leave_request

            pref_row = get_notification_preferences(tenant_id=tenant_id, conn=conn)
            employee_name = f"{employee.get('first_name', '')} {employee.get('last_name', '')}".strip() or "Employee"
            notify_hr_leave_request(
                tenant_id=tenant_id,
                employee_name=employee_name,
                leave_type=item.get("leave_type") or payload.leave_type,
                start_date=str(item.get("start_date") or payload.start_date),
                end_date=str(item.get("end_date") or payload.end_date),
                request_id=int(item["id"]),
                preferences=pref_row["preferences"],
                conn=conn,
            )
        except Exception:
            pass
    finally:
        conn.close()
    return item


@employee_router.post("/requests/{request_id}/cancel")
def cancel_my_leave_request(
    request_id: int,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        item = leave_service.cancel_leave_request(
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
