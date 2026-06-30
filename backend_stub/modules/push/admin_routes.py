"""HR admin Web Push + in-app notification feed."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from core.database import get_connection
from deps import get_hr_user, resolve_tenant_id
from modules.push import service as push_service

settings = load_settings()

router = APIRouter(prefix="/admin", tags=["Admin notifications"])


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=8)
    keys: PushKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=8)


@router.get("/push/config")
def admin_push_config(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    return push_service.push_config_payload()


@router.post("/push/subscribe")
def admin_push_subscribe(
    payload: PushSubscribeRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    if not push_service.push_configured():
        raise HTTPException(status_code=503, detail="Push notifications are not configured on this server.")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        row = push_service.upsert_admin_subscription(
            tenant_id=tenant_id,
            username=current_user.username,
            endpoint=payload.endpoint.strip(),
            p256dh=payload.keys.p256dh.strip(),
            auth=payload.keys.auth.strip(),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, **row}


@router.post("/push/unsubscribe")
def admin_push_unsubscribe(
    payload: PushUnsubscribeRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        removed = push_service.delete_admin_subscription(
            tenant_id=tenant_id,
            username=current_user.username,
            endpoint=payload.endpoint.strip(),
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, "removed": removed}


@router.get("/notifications")
def list_admin_notifications(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    unread_only: bool = False,
    limit: int = 40,
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        items = push_service.list_in_app_notifications(
            tenant_id=tenant_id,
            audience="hr",
            recipient_username=current_user.username,
            conn=conn,
            limit=min(max(limit, 1), 100),
            unread_only=unread_only,
        )
        unread = push_service.count_unread_in_app(
            tenant_id=tenant_id,
            audience="hr",
            recipient_username=current_user.username,
            conn=conn,
        )
    finally:
        conn.close()
    return {"items": items, "unread_count": unread}


@router.post("/notifications/{notification_id}/read")
def mark_admin_notification_read(
    notification_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        ok = push_service.mark_in_app_read(
            tenant_id=tenant_id,
            audience="hr",
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
def mark_all_admin_notifications_read(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = get_connection()
    try:
        count = push_service.mark_all_in_app_read(
            tenant_id=tenant_id,
            audience="hr",
            recipient_username=current_user.username,
            conn=conn,
        )
    finally:
        conn.close()
    return {"ok": True, "marked": count}
