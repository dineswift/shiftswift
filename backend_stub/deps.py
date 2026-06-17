"""FastAPI dependencies for authenticated routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from auth_service import AuthUser, decode_token
from config import Settings, load_settings

HR_ROLES = {"hr", "admin"}
ADMIN_ROLES = {"admin"}


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return token


def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> AuthUser:
    settings = load_settings()
    token = _extract_bearer(authorization)
    try:
        return decode_token(settings, token, expected_type="access")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def get_hr_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> AuthUser:
    user = get_current_user(authorization=authorization)
    if user.role not in HR_ROLES:
        raise HTTPException(status_code=403, detail="HR or admin role required")
    return user


def get_employee_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> AuthUser:
    user = get_current_user(authorization=authorization)
    if user.role != "employee":
        raise HTTPException(status_code=403, detail="Employee role required")
    return user


def get_admin_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> AuthUser:
    user = get_current_user(authorization=authorization)
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def get_master_user(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> AuthUser:
    """Platform master admin — tenant 999 + optional IP allowlist."""
    from modules.master.security import assert_master_ip, assert_master_tenant

    settings = load_settings()
    user = get_current_user(authorization=authorization)
    if user.role not in ADMIN_ROLES:
        if user.impersonated_by:
            raise HTTPException(
                status_code=403,
                detail="Exit impersonation and return to the master console before running platform actions",
            )
        raise HTTPException(status_code=403, detail="Master admin sign-in required")
    assert_master_tenant(user.tenant_id, settings)
    assert_master_ip(request, settings)
    return user


def resolve_tenant_id(
    user: AuthUser,
    x_tenant_id: str | None,
    *,
    settings: Settings | None = None,
) -> int:
    if not x_tenant_id:
        raise HTTPException(status_code=400, detail="X-Tenant-Id header required")
    requested = str(x_tenant_id)
    if user.role == "admin":
        return int(requested)
    if requested != user.tenant_id:
        raise HTTPException(status_code=403, detail="Business access denied")
    return int(requested)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def require_tenant_subscription(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> AuthUser:
    """Block workspace when trial expired or Direct Debit hold is active."""
    settings = load_settings()
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    if current_user.impersonated_by:
        return current_user
    if not settings.use_db or not settings.database_url:
        return current_user

    import psycopg2

    conn = psycopg2.connect(settings.database_url)
    try:
        from license_service import assert_tenant_access

        assert_tenant_access(
            tenant_id=tenant_id,
            conn=conn,
            master_tenant_id=settings.master_customer_id,
        )
    finally:
        conn.close()
    return current_user
