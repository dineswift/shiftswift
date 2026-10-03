"""Rota routes — admin planning and employee self-service."""

from __future__ import annotations

from typing import Annotated

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from core.permissions import check_permission
from deps import get_employee_user, get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.rota import attendance as rota_attendance
from modules.rota import insights as rota_insights
from modules.rota import readiness as rota_readiness
from modules.rota import requests as rota_requests
from modules.rota import service as rota_service
from modules.rota import templates as rota_templates
from modules.rota.export_attendance import build_week_attendance_csv, rota_week_attendance_pdf_bytes
from modules.rota.export_pdf import build_rota_week_pdf, rota_week_csv_bytes, rota_week_pdf_bytes
from modules.rota.service import RotaConflictError, RotaValidationError
from modules.time_punch import service as punch_service

settings = load_settings()

admin_router = APIRouter(
    prefix="/admin/rota",
    tags=["Rota admin"],
    dependencies=[Depends(require_tenant_subscription)],
)

employee_router = APIRouter(
    prefix="/rota",
    tags=["Rota employee"],
    dependencies=[Depends(require_tenant_subscription)],
)


class ShiftInput(BaseModel):
    id: int | None = None
    employee_id: int
    shift_date: str = Field(min_length=10, max_length=10)
    start_time: str = Field(min_length=4, max_length=5)
    end_time: str = Field(min_length=4, max_length=5)
    role_label: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=500)


class SaveRotaRequest(BaseModel):
    shifts: list[ShiftInput] = Field(default_factory=list)
    expected_version: int | None = Field(default=None, ge=1)


class PublishRotaRequest(BaseModel):
    expected_version: int = Field(ge=1)
    notify_staff: bool = Field(default=False)


class ResendRotaNotificationsRequest(BaseModel):
    employee_ids: list[int] | None = Field(default=None, max_length=500)


class CopyWeekRequest(BaseModel):
    expected_version: int | None = Field(default=None, ge=1)


class TemplateRequirementInput(BaseModel):
    day_of_week: int = Field(ge=1, le=7)
    start_time: str = Field(min_length=4, max_length=5)
    end_time: str = Field(min_length=4, max_length=5)
    role_label: str = Field(default="", max_length=80)
    min_staff: int = Field(default=1, ge=1, le=50)


class TemplateCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_default: bool = Field(default=False)
    requirements: list[TemplateRequirementInput] = Field(min_length=1)


class TemplateUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_default: bool | None = None
    requirements: list[TemplateRequirementInput] | None = None


class GenerateDraftRequest(BaseModel):
    template_id: int | None = Field(default=None, ge=1)
    expected_version: int | None = Field(default=None, ge=1)


class ReviewRequestBody(BaseModel):
    approve: bool


class EmployeeShiftRequestBody(BaseModel):
    request_type: str = Field(pattern="^(cover|swap)$")
    target_employee_id: int | None = None
    target_shift_id: int | None = None
    note: str = Field(default="", max_length=500)


def _handle_rota_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, RotaConflictError):
        return HTTPException(
            status_code=409,
            detail={"message": str(exc), "code": "version_conflict", "actual_version": exc.actual},
        )
    if isinstance(exc, RotaValidationError):
        return HTTPException(
            status_code=400,
            detail={
                "message": str(exc),
                "code": "validation_error",
                "field": exc.field,
                "index": exc.index,
            },
        )
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    raise exc


def _employee_for_user(*, tenant_id: int, user: AuthUser, conn) -> dict:
    employee = punch_service.resolve_employee(tenant_id=tenant_id, username=user.username, conn=conn)
    if not employee:
        raise HTTPException(status_code=404, detail="No employee record linked to this login")
    return employee


def _tenant_week_start_day(*, tenant_id: int, conn) -> int:
    return rota_service.get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)


def _parse_tenant_week_start(*, tenant_id: int, week_start: str, conn) -> date:
    return rota_service.parse_week_start(
        week_start,
        week_start_day=_tenant_week_start_day(tenant_id=tenant_id, conn=conn),
    )


def _require_rota_advanced(*, tenant_id: int, conn) -> None:
    from admin_service import get_tenant_profile

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    if not profile.get("rota_advanced_addon"):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail="Advanced rota is a paid add-on. Contact support to add it to your subscription.",
        )
    if profile.get("rota_mode") not in ("advanced", "multi_site"):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail="Switch to Advanced scheduling mode in Settings → Rota scheduling to use these tools.",
        )


def _tenant_has_advanced_rota(*, tenant_id: int, conn) -> bool:
    from admin_service import get_tenant_profile

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    return bool(profile.get("rota_advanced_addon")) and profile.get("rota_mode") in ("advanced", "multi_site")


@admin_router.get("/readiness")
def get_rota_readiness(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return rota_readiness.build_rota_readiness(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()


@admin_router.get("/weeks/{week_start}")
def get_week_rota(
    week_start: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    include_attendance: bool = Query(default=True),
    template_id: int | None = Query(default=None, ge=1),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
        except RotaValidationError as exc:
            raise _handle_rota_errors(exc) from exc
        rota_service.get_or_create_week(
            tenant_id=tenant_id,
            week_start=parsed,
            actor_username=current_user.username,
            conn=conn,
        )
        conn.commit()
        week_start_day = _tenant_week_start_day(tenant_id=tenant_id, conn=conn)
        payload = rota_service.get_week_rota(
            tenant_id=tenant_id,
            week_start=parsed,
            conn=conn,
            week_start_day=week_start_day,
        )
        if include_attendance and payload.get("shifts"):
            payload["attendance"] = rota_attendance.build_week_attendance(
                tenant_id=tenant_id,
                week_start=parsed,
                shifts=payload["shifts"],
                conn=conn,
            )
        if _tenant_has_advanced_rota(tenant_id=tenant_id, conn=conn):
            payload["templates"] = rota_templates.list_templates(tenant_id=tenant_id, conn=conn)
            payload["insights"] = rota_insights.build_week_insights(
                tenant_id=tenant_id,
                week_start=parsed,
                shifts=payload.get("shifts") or [],
                template_id=template_id,
                conn=conn,
            )
        return payload
    finally:
        conn.close()


@admin_router.get("/weeks/{week_start}/export.pdf")
def export_week_rota_pdf(
    week_start: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        pdf_bytes = rota_week_pdf_bytes(tenant_id=tenant_id, week_start=week_start, conn=conn)
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()
    filename = f"shiftswift-rota-{week_start}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@admin_router.get("/weeks/{week_start}/export.csv")
def export_week_rota_csv(
    week_start: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        csv_bytes = rota_week_csv_bytes(tenant_id=tenant_id, week_start=week_start, conn=conn)
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()
    filename = f"shiftswift-rota-{week_start}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@admin_router.get("/weeks/{week_start}/attendance/export.csv")
def export_week_attendance_csv(
    week_start: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        csv_data = build_week_attendance_csv(tenant_id=tenant_id, week_start=week_start, conn=conn)
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()
    filename = f"shiftswift-shifts-attendance-{week_start}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@admin_router.get("/weeks/{week_start}/attendance/export.pdf")
def export_week_attendance_pdf(
    week_start: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        pdf_bytes = rota_week_attendance_pdf_bytes(tenant_id=tenant_id, week_start=week_start, conn=conn)
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()
    filename = f"shiftswift-shifts-attendance-{week_start}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@admin_router.get("/weeks/{week_start}/attendance")
def get_week_attendance(
    week_start: str,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
        except RotaValidationError as exc:
            raise _handle_rota_errors(exc) from exc
        _, shifts = rota_service.list_shifts_for_week(tenant_id=tenant_id, week_start=parsed, conn=conn)
        return rota_attendance.build_week_attendance(
            tenant_id=tenant_id,
            week_start=parsed,
            shifts=shifts,
            conn=conn,
        )
    finally:
        conn.close()


@admin_router.put("/weeks/{week_start}")
def save_week_rota(
    week_start: str,
    payload: SaveRotaRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
            return rota_service.save_week_shifts(
                tenant_id=tenant_id,
                week_start=parsed,
                shifts_payload=[item.model_dump() for item in payload.shifts],
                expected_version=payload.expected_version,
                actor_username=current_user.username,
                conn=conn,
            )
        except (RotaValidationError, RotaConflictError, ValueError) as exc:
            raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.post("/weeks/{week_start}/copy-previous")
def copy_previous_week(
    week_start: str,
    payload: CopyWeekRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
            return rota_service.copy_week_from_previous(
                tenant_id=tenant_id,
                week_start=parsed,
                expected_version=payload.expected_version,
                actor_username=current_user.username,
                conn=conn,
            )
        except (RotaValidationError, RotaConflictError, ValueError) as exc:
            raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.post("/weeks/{week_start}/publish")
def publish_week_rota(
    week_start: str,
    payload: PublishRotaRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
            return rota_service.publish_week(
                tenant_id=tenant_id,
                week_start=parsed,
                expected_version=payload.expected_version,
                actor_username=current_user.username,
                conn=conn,
                notify_staff=payload.notify_staff,
            )
        except (RotaValidationError, RotaConflictError, ValueError) as exc:
            raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.post("/weeks/{week_start}/resend-notifications")
def resend_week_rota_notifications(
    week_start: str,
    payload: ResendRotaNotificationsRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
            return rota_service.resend_week_notifications(
                tenant_id=tenant_id,
                week_start=parsed,
                conn=conn,
                employee_ids=payload.employee_ids,
            )
        except (RotaValidationError, RotaConflictError, ValueError) as exc:
            raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.get("/templates")
def list_rota_templates(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        _require_rota_advanced(tenant_id=tenant_id, conn=conn)
        return {"items": rota_templates.list_templates(tenant_id=tenant_id, conn=conn)}
    finally:
        conn.close()


@admin_router.get("/templates/{template_id}")
def get_rota_template(
    template_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        _require_rota_advanced(tenant_id=tenant_id, conn=conn)
        return rota_templates.get_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.post("/templates")
def create_rota_template(
    payload: TemplateCreateRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        _require_rota_advanced(tenant_id=tenant_id, conn=conn)
        return rota_templates.create_template(
            tenant_id=tenant_id,
            name=payload.name,
            is_default=payload.is_default,
            requirements=[item.model_dump() for item in payload.requirements],
            actor_username=current_user.username,
            conn=conn,
        )
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.put("/templates/{template_id}")
def update_rota_template(
    template_id: int,
    payload: TemplateUpdateRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        _require_rota_advanced(tenant_id=tenant_id, conn=conn)
        updates = payload.model_dump(exclude_unset=True)
        requirements = updates.pop("requirements", None)
        return rota_templates.update_template(
            tenant_id=tenant_id,
            template_id=template_id,
            name=updates.get("name"),
            is_default=updates.get("is_default"),
            requirements=requirements,
            actor_username=current_user.username,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.delete("/templates/{template_id}")
def delete_rota_template(
    template_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        _require_rota_advanced(tenant_id=tenant_id, conn=conn)
        rota_templates.delete_template(tenant_id=tenant_id, template_id=template_id, conn=conn)
        return {"message": "Template deleted"}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.post("/weeks/{week_start}/generate-draft")
def generate_week_draft(
    week_start: str,
    payload: GenerateDraftRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            parsed = _parse_tenant_week_start(tenant_id=tenant_id, week_start=week_start, conn=conn)
            _require_rota_advanced(tenant_id=tenant_id, conn=conn)
            return rota_insights.generate_draft_from_template(
                tenant_id=tenant_id,
                week_start=parsed,
                template_id=payload.template_id,
                expected_version=payload.expected_version,
                actor_username=current_user.username,
                conn=conn,
            )
        except (RotaValidationError, RotaConflictError, ValueError) as exc:
            raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@admin_router.get("/shift-requests")
def list_admin_shift_requests(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    status: str | None = Query(default="pending"),
) -> dict[str, object]:
    check_permission(current_user, "employees.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = rota_requests.list_shift_requests(
            tenant_id=tenant_id,
            conn=conn,
            status=status if status in {"pending", "approved", "rejected", "cancelled"} else None,
        )
        return {"items": items}
    finally:
        conn.close()


@admin_router.post("/shift-requests/{request_id}/review")
def review_shift_request_route(
    request_id: int,
    payload: ReviewRequestBody,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "employees.write")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return rota_requests.review_shift_request(
            tenant_id=tenant_id,
            request_id=request_id,
            approve=payload.approve,
            actor_username=current_user.username,
            conn=conn,
        )
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@employee_router.get("/my-shifts")
def my_shifts(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    week_start: str | None = Query(default=None),
) -> dict[str, object]:
    from modules.employees.business_schedule import get_business_schedule

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        schedule = get_business_schedule(tenant_id=tenant_id, conn=conn)
        week_start_day = _tenant_week_start_day(tenant_id=tenant_id, conn=conn)
        if week_start:
            parsed = rota_service.parse_week_start(week_start, week_start_day=week_start_day)
        else:
            parsed = rota_service.week_start_on_or_before(date.today(), week_start_day)
        shifts = rota_attendance.list_employee_week_shifts(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            week_start=parsed,
            conn=conn,
        )
        return {
            "week_start": parsed.isoformat(),
            "week_end": (parsed + timedelta(days=6)).isoformat(),
            "week_start_day": week_start_day,
            "week_start_day_name": rota_service.WEEKDAY_NAMES[week_start_day],
            "shifts": shifts,
            "shift_reminders": {
                "minutes_before_start": schedule.shift_reminder_minutes_before,
                "minutes_before_end": schedule.shift_end_reminder_minutes_before,
            },
        }
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()


@employee_router.post("/shifts/{shift_id}/requests")
def create_my_shift_request(
    shift_id: int,
    payload: EmployeeShiftRequestBody,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return rota_requests.create_shift_request(
            tenant_id=tenant_id,
            shift_id=shift_id,
            requester_employee_id=employee["id"],
            request_type=payload.request_type,  # type: ignore[arg-type]
            target_employee_id=payload.target_employee_id,
            target_shift_id=payload.target_shift_id,
            note=payload.note,
            conn=conn,
        )
    except RotaValidationError as exc:
        raise _handle_rota_errors(exc) from exc
    finally:
        conn.close()
