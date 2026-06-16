"""Time punch HTTP routes — employee clock in/out and HR site management."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import client_ip, get_employee_user, get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.time_punch import service as punch_service
from modules.time_punch import kiosk as kiosk_service
from modules.time_punch import timesheet as timesheet_service
from modules.time_punch.qr import punch_qr_data_uri, punch_qr_png_bytes

PunchAction = Literal["in", "out", "break_start", "break_end"]

settings = load_settings()

employee_router = APIRouter(prefix="/time-punch", tags=["Time punch"])
admin_router = APIRouter(
    prefix="/admin/time-punch",
    tags=["Time punch admin"],
    dependencies=[Depends(require_tenant_subscription)],
)


class PunchRequest(BaseModel):
    punch_type: PunchAction
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)


class GeofencePreviewRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float | None = Field(default=None, ge=0)


class SiteScanRequest(BaseModel):
    clock_token: str = Field(min_length=8, max_length=200)


class SiteTokenPunchRequest(BaseModel):
    punch_type: PunchAction
    clock_token: str = Field(min_length=8, max_length=200)


class PunchSiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    radius_meters: int | None = Field(default=None, ge=25, le=2000)
    is_active: bool | None = None
    permitted_roles: str | None = Field(default=None, max_length=200)


class PunchSiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=3, max_length=500)
    radius_meters: int = Field(default=150, ge=25, le=2000)
    is_primary: bool = False
    permitted_roles: str = Field(default="all", max_length=200)


class AdminPunchRequest(BaseModel):
    employee_id: int
    punch_site_id: int
    punch_type: PunchAction
    punched_at: str | None = None
    admin_note: str | None = Field(default=None, max_length=500)


class TimesheetApprovalRequest(BaseModel):
    week_start: str
    employee_id: int
    status: Literal["pending", "approved", "rejected"]
    note: str | None = Field(default=None, max_length=500)


class TimesheetBulkApprovalRequest(BaseModel):
    week_start: str
    status: Literal["approved", "rejected"]


class KioskPinRequest(BaseModel):
    pin: str | None = Field(default=None, max_length=6)


class KioskSessionRequest(BaseModel):
    clock_token: str = Field(min_length=8, max_length=200)
    employee_id: int
    pin: str = Field(min_length=4, max_length=6)


class KioskPunchRequest(BaseModel):
    session_token: str = Field(min_length=8, max_length=200)
    punch_type: PunchAction


def _parse_optional_date(value: str | None, field_name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} — use YYYY-MM-DD") from exc


def _punch_filters(
    *,
    employee_id: int | None = None,
    site_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    punch_type: PunchAction | None = None,
) -> dict[str, Any]:
    return {
        "employee_id": employee_id,
        "punch_site_id": site_id,
        "date_from": _parse_optional_date(date_from, "date_from"),
        "date_to": _parse_optional_date(date_to, "date_to"),
        "punch_type": punch_type,
    }


def _employee_for_user(*, tenant_id: int, user: AuthUser, conn: Any) -> dict[str, Any]:
    employee = punch_service.resolve_employee(tenant_id=tenant_id, username=user.username, conn=conn)
    if not employee:
        raise HTTPException(
            status_code=404,
            detail="No employee record linked to this login — ask HR to add your email to the employee register.",
        )
    return employee


@employee_router.get("/status")
def punch_status(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return punch_service.employee_punch_status(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            conn=conn,
        )
    finally:
        conn.close()


@employee_router.post("/preview")
def punch_preview(
    payload: GeofencePreviewRequest,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    """Re-run geofence distance on the server before the employee taps Clock in/out."""
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return punch_service.preview_geofence(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy_meters=payload.accuracy_meters,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@employee_router.post("/punch")
def punch(
    payload: PunchRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return punch_service.record_punch(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            username=current_user.username,
            punch_type=payload.punch_type,
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy_meters=payload.accuracy_meters,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@employee_router.post("/scan")
def punch_scan_site(
    payload: SiteScanRequest,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    """Validate a premises QR token so the employee can punch without GPS."""
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return punch_service.scan_site_token(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            clock_token=payload.clock_token,
            conn=conn,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@employee_router.post("/punch-site")
def punch_via_site_token(
    payload: SiteTokenPunchRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        return punch_service.record_punch_via_site_token(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            username=current_user.username,
            punch_type=payload.punch_type,
            clock_token=payload.clock_token,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.get("/sites")
def list_sites(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = punch_service.list_punch_sites(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@admin_router.post("/sites/sync-from-address")
def sync_site_from_address(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        try:
            site = punch_service.sync_primary_site_from_tenant_address(tenant_id=tenant_id, conn=conn)
        except punch_service.PunchSyncError as exc:
            raise HTTPException(
                status_code=400,
                detail={"message": str(exc), "code": exc.code},
            ) from exc
    finally:
        conn.close()
    return site


@admin_router.post("/sites")
def create_site(
    payload: PunchSiteCreate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        return punch_service.create_punch_site(
            tenant_id=tenant_id,
            name=payload.name,
            address=payload.address,
            radius_meters=payload.radius_meters,
            is_primary=payload.is_primary,
            permitted_roles=payload.permitted_roles,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.patch("/sites/{site_id}")
def patch_site(
    site_id: int,
    payload: PunchSiteUpdate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    conn = get_connection()
    try:
        sets = ", ".join(f"{key} = %s" for key in updates)
        values = list(updates.values()) + [site_id, tenant_id]
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE punch_sites SET {sets}, updated_at = NOW()
                WHERE id = %s AND tenant_id = %s
                RETURNING id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                          COALESCE(permitted_roles, 'all')
                """,
                values,
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punch site not found")
        conn.commit()
        return punch_service._site_row(row)
    finally:
        conn.close()


def _clock_qr_payload(*, site_id: int, site_name: str, clock_token: str) -> dict[str, object]:
    clock_url = punch_service.site_clock_url(clock_token=clock_token)
    qr_data_uri = punch_qr_data_uri(clock_url, box_size=10, border=2)
    return {
        "site_id": site_id,
        "site_name": site_name,
        "clock_token": clock_token,
        "clock_url": clock_url,
        "kiosk_url": punch_service.site_kiosk_url(clock_token=clock_token),
        "qr_image_data_uri": qr_data_uri,
        "qr_image_url": qr_data_uri,
    }


@admin_router.get("/sites/{site_id}/clock-qr")
def site_clock_qr(
    site_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        token = punch_service.ensure_site_clock_token(tenant_id=tenant_id, site_id=site_id, conn=conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                       COALESCE(permitted_roles, 'all')
                FROM punch_sites
                WHERE id = %s AND tenant_id = %s
                """,
                (site_id, tenant_id),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punch site not found")
        site = punch_service._site_row(row)
        return _clock_qr_payload(site_id=site_id, site_name=site["name"], clock_token=token)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.get("/sites/{site_id}/clock-qr.png")
def site_clock_qr_png(
    site_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Response:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        token = punch_service.ensure_site_clock_token(tenant_id=tenant_id, site_id=site_id, conn=conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM punch_sites WHERE id = %s AND tenant_id = %s",
                (site_id, tenant_id),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punch site not found")
        clock_url = punch_service.site_clock_url(clock_token=token)
        png = punch_qr_png_bytes(clock_url, box_size=10, border=2)
        safe_name = str(row[0] or "work-site").replace('"', "").replace("/", "-")
        filename = f"premises-clock-qr-{safe_name}.png"
        return Response(
            content=png,
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.post("/sites/{site_id}/rotate-clock-token")
def rotate_site_clock_token(
    site_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        token = punch_service.rotate_site_clock_token(tenant_id=tenant_id, site_id=site_id, conn=conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM punch_sites WHERE id = %s AND tenant_id = %s",
                (site_id, tenant_id),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punch site not found")
        return _clock_qr_payload(site_id=site_id, site_name=str(row[0]), clock_token=token)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.get("/punches")
def list_punches(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    limit: int = 100,
    employee_id: int | None = None,
    site_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    punch_type: PunchAction | None = None,
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    filters = _punch_filters(
        employee_id=employee_id,
        site_id=site_id,
        date_from=date_from,
        date_to=date_to,
        punch_type=punch_type,
    )
    conn = get_connection()
    try:
        items = punch_service.list_recent_punches(
            tenant_id=tenant_id,
            conn=conn,
            limit=min(limit, 500),
            **filters,
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@admin_router.get("/punches/export.csv")
def export_punches_csv(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    employee_id: int | None = None,
    site_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    punch_type: PunchAction | None = None,
) -> Response:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    filters = _punch_filters(
        employee_id=employee_id,
        site_id=site_id,
        date_from=date_from,
        date_to=date_to,
        punch_type=punch_type,
    )
    conn = get_connection()
    try:
        csv_data = punch_service.export_punches_csv(tenant_id=tenant_id, conn=conn, **filters)
    finally:
        conn.close()
    filename = f"time-punches-{date.today().isoformat()}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@admin_router.get("/hours-report.pdf")
def export_hours_report_pdf(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    date_from: str | None = None,
    date_to: str | None = None,
) -> Response:
    from modules.payroll_export.hours_pdf import hours_report_pdf_bytes

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    filters = _punch_filters(date_from=date_from, date_to=date_to)
    conn = get_connection()
    try:
        pdf_bytes = hours_report_pdf_bytes(
            tenant_id=tenant_id,
            conn=conn,
            from_date=filters.get("date_from"),
            to_date=filters.get("date_to"),
        )
    finally:
        conn.close()
    period = filters.get("date_from") or date.today().replace(day=1).isoformat()
    filename = f"working-hours-{period}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@admin_router.post("/punches/admin")
def admin_punch(
    payload: AdminPunchRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    punched_at = None
    if payload.punched_at:
        try:
            punched_at = datetime.fromisoformat(payload.punched_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid punched_at timestamp") from exc
    conn = get_connection()
    try:
        return punch_service.record_admin_punch(
            tenant_id=tenant_id,
            employee_id=payload.employee_id,
            punch_site_id=payload.punch_site_id,
            punch_type=payload.punch_type,
            punched_at=punched_at,
            admin_note=payload.admin_note,
            recorded_by=current_user.username,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


kiosk_router = APIRouter(prefix="/time-punch/kiosk", tags=["Time punch kiosk"])


@kiosk_router.get("/site")
def kiosk_site(clock: str) -> dict[str, object]:
    conn = get_connection()
    try:
        return kiosk_service.kiosk_site_bootstrap(clock_token=clock, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@kiosk_router.post("/session")
def kiosk_session(payload: KioskSessionRequest) -> dict[str, object]:
    conn = get_connection()
    try:
        return kiosk_service.create_kiosk_session(
            clock_token=payload.clock_token,
            employee_id=payload.employee_id,
            pin=payload.pin,
            conn=conn,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@kiosk_router.post("/punch")
def kiosk_punch(payload: KioskPunchRequest) -> dict[str, object]:
    conn = get_connection()
    try:
        return kiosk_service.record_kiosk_punch(
            session_token=payload.session_token,
            punch_type=payload.punch_type,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.get("/timesheet")
def get_timesheet(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    week_start: str | None = None,
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    parsed = _parse_optional_date(week_start, "week_start") if week_start else None
    conn = get_connection()
    try:
        return timesheet_service.weekly_timesheet(
            tenant_id=tenant_id,
            week_start=parsed,
            conn=conn,
        )
    finally:
        conn.close()


@admin_router.post("/timesheet/approve")
def approve_timesheet_row(
    payload: TimesheetApprovalRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    week_start = _parse_optional_date(payload.week_start, "week_start")
    if not week_start:
        raise HTTPException(status_code=400, detail="week_start is required")
    conn = get_connection()
    try:
        return timesheet_service.set_timesheet_approval(
            tenant_id=tenant_id,
            week_start=week_start,
            employee_id=payload.employee_id,
            status=payload.status,
            note=payload.note,
            decided_by=current_user.username,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.post("/timesheet/approve-all")
def approve_all_timesheets(
    payload: TimesheetBulkApprovalRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    week_start = _parse_optional_date(payload.week_start, "week_start")
    if not week_start:
        raise HTTPException(status_code=400, detail="week_start is required")
    conn = get_connection()
    try:
        return timesheet_service.approve_all_timesheets(
            tenant_id=tenant_id,
            week_start=week_start,
            status=payload.status,
            decided_by=current_user.username,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@admin_router.put("/employees/{employee_id}/kiosk-pin")
def set_kiosk_pin(
    employee_id: int,
    payload: KioskPinRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        kiosk_service.set_employee_kiosk_pin(
            tenant_id=tenant_id,
            employee_id=employee_id,
            pin=payload.pin,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"employee_id": employee_id, "kiosk_pin_set": bool(payload.pin)}


@admin_router.get("/employees/{employee_id}/kiosk-pin")
def get_kiosk_pin_status(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT kiosk_pin_hash IS NOT NULL
                FROM employees
                WHERE id = %s AND tenant_id = %s
                """,
                (employee_id, tenant_id),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Employee not found")
        return {"employee_id": employee_id, "kiosk_pin_set": bool(row[0])}
    finally:
        conn.close()
