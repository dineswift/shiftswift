"""Employee Web Push subscription routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import client_ip, get_employee_user, resolve_tenant_id
from modules.push import service as push_service
from modules.push import native_push as native_push_service
from modules.time_punch.service import resolve_employee

settings = load_settings()

router = APIRouter(prefix="/employee/push", tags=["Push notifications"])


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=8)
    keys: PushKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=8)


class NativePushSubscribeRequest(BaseModel):
    platform: str = Field(pattern=r"^(android|ios)$")
    device_token: str = Field(min_length=8, max_length=4096)


class NativePushUnsubscribeRequest(BaseModel):
    platform: str = Field(pattern=r"^(android|ios)$")
    device_token: str = Field(min_length=8, max_length=4096)


def _employee_for_user(*, tenant_id: int, user: AuthUser, conn: Any) -> dict[str, Any]:
    employee = resolve_employee(tenant_id=tenant_id, username=user.username, conn=conn)
    if not employee:
        raise HTTPException(
            status_code=404,
            detail="No employee record linked to this login.",
        )
    return employee


@router.get("/config")
def push_config(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    payload = push_service.push_config_payload()
    payload["native_enabled"] = native_push_service.native_push_configured()
    return payload


@router.post("/subscribe")
def push_subscribe(
    payload: PushSubscribeRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    if not push_service.push_configured():
        raise HTTPException(
            status_code=503,
            detail="Push notifications are not configured on this server.",
        )
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        row = push_service.upsert_subscription(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            endpoint=payload.endpoint.strip(),
            p256dh=payload.keys.p256dh.strip(),
            auth=payload.keys.auth.strip(),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, **row}


@router.post("/unsubscribe")
def push_unsubscribe(
    payload: PushUnsubscribeRequest,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        removed = push_service.delete_subscription(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            endpoint=payload.endpoint.strip(),
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, "removed": removed}


@router.post("/native-subscribe")
def native_push_subscribe(
    payload: NativePushSubscribeRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        row = native_push_service.upsert_native_device(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            platform=payload.platform.strip(),
            device_token=payload.device_token.strip(),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, **row}


@router.post("/native-unsubscribe")
def native_push_unsubscribe(
    payload: NativePushUnsubscribeRequest,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        employee = _employee_for_user(tenant_id=tenant_id, user=current_user, conn=conn)
        removed = native_push_service.delete_native_device(
            tenant_id=tenant_id,
            employee_id=employee["id"],
            platform=payload.platform.strip(),
            device_token=payload.device_token.strip(),
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, "removed": removed}


@router.get("/notifications")
def list_employee_notifications(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    unread_only: bool = False,
    limit: int = 40,
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = push_service.list_in_app_notifications(
            tenant_id=tenant_id,
            audience="employee",
            recipient_username=current_user.username,
            conn=conn,
            limit=min(max(limit, 1), 100),
            unread_only=unread_only,
        )
        unread = push_service.count_unread_in_app(
            tenant_id=tenant_id,
            audience="employee",
            recipient_username=current_user.username,
            conn=conn,
        )
    finally:
        conn.close()
    return {"items": items, "unread_count": unread}


@router.post("/notifications/{notification_id}/read")
def mark_employee_notification_read(
    notification_id: int,
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        ok = push_service.mark_in_app_read(
            tenant_id=tenant_id,
            audience="employee",
            recipient_username=current_user.username,
            notification_id=notification_id,
            conn=conn,
        )
    finally:
        conn.close()
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_employee_notifications_read(
    current_user: Annotated[AuthUser, Depends(get_employee_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        count = push_service.mark_all_in_app_read(
            tenant_id=tenant_id,
            audience="employee",
            recipient_username=current_user.username,
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, "marked": count}
