"""RBAC permission checks for module routes."""

from __future__ import annotations

from fastapi import HTTPException

from auth_service import AuthUser
from rbac import effective_role, has_permission


def check_permission(user: AuthUser, permission: str) -> None:
    if user.role == "admin" and not user.workspace_role:
        return
    role = effective_role(user)
    if not has_permission(role, permission):
        raise HTTPException(status_code=403, detail=f"Permission required: {permission}")
