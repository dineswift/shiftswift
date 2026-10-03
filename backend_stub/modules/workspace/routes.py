"""Workspace user management routes."""

from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth_service import AuthUser
from config import load_settings
from core.permissions import check_permission
from deps import client_ip, get_hr_user, require_tenant_subscription, resolve_tenant_id
from modules.workspace.service import (
    invite_workspace_user,
    list_workspace_users,
    sync_workspace_users_from_logins,
    update_workspace_user,
)
from rbac import WORKSPACE_ROLE_LABELS, WORKSPACE_ROLES, effective_role, has_permission

router = APIRouter(prefix="/admin/workspace", tags=["Workspace users"])
settings = load_settings()


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


class WorkspaceUserInvite(BaseModel):
    email: EmailStr
    role: str = Field(min_length=3, max_length=32)
    display_name: str | None = Field(default=None, max_length=120)


class WorkspaceUserUpdate(BaseModel):
    role: str | None = Field(default=None, max_length=32)
    display_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


@router.get("/users")
def get_workspace_users(
    request: Request,
    current_user: Annotated[AuthUser, Depends(require_tenant_subscription)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "settings.read")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        sync_workspace_users_from_logins(tenant_id=tenant_id, conn=conn)
        users = list_workspace_users(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    can_manage = has_permission(effective_role(current_user), "workspace.users.manage")
    if not can_manage and current_user.role == "admin" and not current_user.workspace_role:
        can_manage = True
    return {
        "users": users,
        "roles": [
            {"id": role, "label": WORKSPACE_ROLE_LABELS.get(role, role)}
            for role in WORKSPACE_ROLES
            if role != "owner"
        ],
        "current_user": current_user.username,
        "current_workspace_role": current_user.workspace_role or "hr_manager",
        "can_manage_users": can_manage,
    }


@router.post("/users/invite")
def post_workspace_user_invite(
    request: Request,
    payload: WorkspaceUserInvite,
    current_user: Annotated[AuthUser, Depends(require_tenant_subscription)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "workspace.users.manage")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    actor_workspace_role = current_user.workspace_role or "hr_manager"
    conn = _db_conn()
    try:
        result = invite_workspace_user(
            tenant_id=tenant_id,
            email=str(payload.email),
            role=payload.role,
            display_name=payload.display_name,
            actor_username=current_user.username,
            actor_workspace_role=actor_workspace_role,
            actor_role=current_user.workspace_role or current_user.role,
            conn=conn,
            settings=settings,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        conn.close()
    return result


@router.patch("/users/{username}")
def patch_workspace_user(
    username: str,
    request: Request,
    payload: WorkspaceUserUpdate,
    current_user: Annotated[AuthUser, Depends(require_tenant_subscription)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    check_permission(current_user, "workspace.users.manage")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    actor_workspace_role = current_user.workspace_role or "hr_manager"
    conn = _db_conn()
    try:
        result = update_workspace_user(
            tenant_id=tenant_id,
            username=username,
            role=payload.role,
            display_name=payload.display_name,
            is_active=payload.is_active,
            actor_username=current_user.username,
            actor_workspace_role=actor_workspace_role,
            actor_role=current_user.workspace_role or current_user.role,
            conn=conn,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return result
