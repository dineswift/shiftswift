"""Offboarding HTTP routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from core.permissions import check_permission
from deps import get_hr_user, resolve_tenant_id
from modules.offboarding import service as offboarding_service
from modules.offboarding.errors import ActiveWorkflowExistsError, WorkflowStateError

router = APIRouter(prefix="/offboarding", tags=["Offboarding & Leavers"])
settings = load_settings()


class StartOffboardingRequest(BaseModel):
    employee_id: int
    reason: str = Field(min_length=3, max_length=500)
    grievance_case_id: int | None = None


class CessationReportRequest(BaseModel):
    report_reference: str = Field(min_length=2, max_length=120)


class CancelWorkflowRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


@router.get("/workflows")
def list_workflows(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = offboarding_service.list_workflows(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/workflows")
def start_workflow(
    payload: StartOffboardingRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return offboarding_service.start_offboarding(
            tenant_id=tenant_id,
            employee_id=payload.employee_id,
            reason=payload.reason,
            grievance_case_id=payload.grievance_case_id,
            actor_username=current_user.username,
            actor_role=current_user.role,
            conn=conn,
        )
    except ActiveWorkflowExistsError as exc:
        raise HTTPException(status_code=409, detail=exc.as_detail()) from exc
    finally:
        conn.close()


@router.post("/workflows/{workflow_id}/complete")
def complete_workflow(
    workflow_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return offboarding_service.complete_workflow(
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            actor_username=current_user.username,
            actor_role=current_user.role,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkflowStateError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    finally:
        conn.close()


@router.post("/workflows/{workflow_id}/cancel")
def cancel_workflow(
    workflow_id: int,
    payload: CancelWorkflowRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return offboarding_service.cancel_workflow(
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            reason=payload.reason,
            actor_username=current_user.username,
            actor_role=current_user.role,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkflowStateError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    finally:
        conn.close()


@router.post("/workflows/{workflow_id}/cessation-reported")
def report_cessation(
    workflow_id: int,
    payload: CessationReportRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "compliance.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return offboarding_service.report_sponsorship_cessation(
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            report_reference=payload.report_reference,
            actor_username=current_user.username,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
