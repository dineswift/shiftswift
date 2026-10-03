"""Authentication, JWT sessions, and login rate limiting."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import bcrypt
import jwt

from config import Settings
from dev_credentials import development_fallback_users

Portal = Literal["master", "business"]

_login_attempts: dict[str, deque[float]] = defaultdict(deque)


@dataclass
class AuthUser:
    username: str
    role: str
    tenant_id: str
    impersonated_by: str | None = None
    workspace_role: str | None = None


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str
    role: str
    tenant_id: str
    username: str
    expires_in: int
    workspace_role: str | None = None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _rate_limit_key(ip: str, username: str) -> str:
    return f"{ip}:{username.lower()}"


def is_login_rate_limited(settings: Settings, ip: str, username: str) -> bool:
    key = _rate_limit_key(ip, username)
    now = time.time()
    window = settings.login_rate_window_seconds
    attempts = _login_attempts[key]
    while attempts and attempts[0] < now - window:
        attempts.popleft()
    return len(attempts) >= settings.login_rate_limit


def record_login_attempt(settings: Settings, ip: str, username: str) -> None:
    _login_attempts[_rate_limit_key(ip, username)].append(time.time())


def clear_login_attempts(ip: str, username: str) -> None:
    _login_attempts.pop(_rate_limit_key(ip, username), None)


def lookup_workspace_role(settings: Settings, *, username: str, tenant_id: str) -> str | None:
    """Resolve workspace RBAC role from tenant_users (business HR logins only)."""
    if not settings.use_db or not settings.database_url:
        return "owner" if settings.is_development else None
    import psycopg2

    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role
                FROM tenant_users
                WHERE tenant_id = %s
                  AND lower(username) = lower(%s)
                  AND is_active = TRUE
                LIMIT 1
                """,
                (int(tenant_id), username),
            )
            row = cur.fetchone()
            return str(row[0]) if row else None
    finally:
        conn.close()


def auth_user_with_workspace_role(settings: Settings, user: AuthUser) -> AuthUser:
    if user.workspace_role or user.role != "hr":
        return user
    workspace_role = lookup_workspace_role(
        settings,
        username=user.username,
        tenant_id=user.tenant_id,
    )
    if not workspace_role:
        workspace_role = "hr_manager"
    return AuthUser(
        username=user.username,
        role=user.role,
        tenant_id=user.tenant_id,
        impersonated_by=user.impersonated_by,
        workspace_role=workspace_role,
    )


def create_token_pair(settings: Settings, user: AuthUser) -> TokenPair:
    user = auth_user_with_workspace_role(settings, user)
    now = datetime.now(timezone.utc)
    access_exp = now + timedelta(minutes=settings.jwt_access_minutes)
    refresh_exp = now + timedelta(days=settings.jwt_refresh_days)
    access_payload = {
        "sub": user.username,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(access_exp.timestamp()),
    }
    if user.workspace_role:
        access_payload["workspace_role"] = user.workspace_role
    refresh_payload = {
        "sub": user.username,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int(refresh_exp.timestamp()),
    }
    if user.workspace_role:
        refresh_payload["workspace_role"] = user.workspace_role
    access_token = jwt.encode(access_payload, settings.jwt_secret, algorithm="HS256")
    refresh_token = jwt.encode(refresh_payload, settings.jwt_secret, algorithm="HS256")
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        role=user.role,
        tenant_id=user.tenant_id,
        username=user.username,
        expires_in=settings.jwt_access_minutes * 60,
        workspace_role=user.workspace_role,
    )


def create_impersonation_access_token(
    settings: Settings,
    *,
    master_username: str,
    tenant_id: int,
    expires_minutes: int | None = None,
) -> tuple[str, int]:
    """Short-lived HR access token for platform master impersonation."""
    minutes = expires_minutes or int(os.getenv("MASTER_IMPERSONATION_MINUTES", "60"))
    now = datetime.now(timezone.utc)
    access_exp = now + timedelta(minutes=minutes)
    access_payload = {
        "sub": master_username,
        "role": "hr",
        "tenant_id": str(tenant_id),
        "type": "access",
        "impersonation": True,
        "impersonated_by": master_username,
        "iat": int(now.timestamp()),
        "exp": int(access_exp.timestamp()),
    }
    access_token = jwt.encode(access_payload, settings.jwt_secret, algorithm="HS256")
    return access_token, minutes * 60


def decode_access_payload(settings: Settings, token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired token") from exc
    if payload.get("type") != "access":
        raise ValueError("Invalid token type")
    return payload


def decode_token(settings: Settings, token: str, expected_type: str = "access") -> AuthUser:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired token") from exc
    if payload.get("type") != expected_type:
        raise ValueError("Invalid token type")
    username = payload.get("sub")
    role = payload.get("role")
    tenant_id = str(payload.get("tenant_id", ""))
    if not username or not role or not tenant_id:
        raise ValueError("Malformed token")
    impersonated_by = payload.get("impersonated_by") if payload.get("impersonation") else None
    workspace_role = payload.get("workspace_role")
    return AuthUser(
        username=username,
        role=role,
        tenant_id=tenant_id,
        impersonated_by=str(impersonated_by) if impersonated_by else None,
        workspace_role=str(workspace_role) if workspace_role else None,
    )


def fetch_user_from_db(settings: Settings, username: str) -> dict[str, Any] | None:
    if not settings.use_db or not settings.database_url:
        return None
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT username, password_hash, role, tenant_id::text AS tenant_id, is_active,
                       locked_until, login_portal, mfa_enabled
                FROM app_users
                WHERE lower(username) = lower(%s)
                LIMIT 1
                """,
                (username,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def authenticate_user_lookup(settings: Settings, username: str) -> AuthUser | None:
    """Resolve an active user by username — no password (e.g. passkey login)."""
    row = fetch_user_from_db(settings, username)
    if row:
        if not row.get("is_active"):
            return None
        locked_until = row.get("locked_until")
        if locked_until and locked_until > datetime.now(timezone.utc):
            return None
        return AuthUser(
            username=row["username"],
            role=row["role"],
            tenant_id=str(row["tenant_id"]),
        )
    if settings.is_production:
        return None
    fallback_users = development_fallback_users(master_tenant_id=settings.master_customer_id)
    fallback = fallback_users.get(username)
    if not fallback:
        for key, value in fallback_users.items():
            if key.lower() == username.lower():
                fallback = value
                break
    if not fallback:
        return None
    return AuthUser(
        username=username,
        role=fallback["role"],
        tenant_id=str(fallback["tenant_id"]),
    )


def authenticate_user(
    settings: Settings,
    username: str,
    password: str,
    *,
    require_role: str | None = None,
    portal: Portal | None = None,
) -> AuthUser | None:
    row = fetch_user_from_db(settings, username)
    if row:
        if not row.get("is_active"):
            return None
        locked_until = row.get("locked_until")
        if locked_until and locked_until > datetime.now(timezone.utc):
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        user = AuthUser(
            username=row["username"],
            role=row["role"],
            tenant_id=str(row["tenant_id"]),
        )
        if require_role and user.role != require_role:
            return None
        if portal == "master" and (user.role != "admin" or row.get("login_portal", "master") != "master"):
            return None
        if portal == "business" and (
            user.role == "admin" or row.get("login_portal", "business") != "business"
        ):
            return None
        return user

    if settings.is_production:
        return None

    fallback_users = development_fallback_users(master_tenant_id=settings.master_customer_id)
    fallback = fallback_users.get(username)
    if not fallback:
        for key, value in fallback_users.items():
            if key.lower() == username.lower():
                fallback = value
                break
    if not fallback or fallback["password"] != password:
        return None
    user = AuthUser(
        username=username,
        role=fallback["role"],
        tenant_id=str(fallback["tenant_id"]),
    )
    if require_role and user.role != require_role:
        return None
    if portal == "master" and user.role != "admin":
        return None
    if portal == "business" and user.role == "admin":
        return None
    return user


def _lookup_user_row(settings: Settings, username: str) -> dict[str, Any] | None:
    row = fetch_user_from_db(settings, username)
    if row:
        return row
    if settings.is_production:
        return None
    normalized = username.strip().lower()
    fallbacks = development_fallback_users(master_tenant_id=settings.master_customer_id)
    for key, fallback in fallbacks.items():
        if key.lower() == normalized:
            return {
                "username": key,
                "role": fallback["role"],
                "tenant_id": str(fallback["tenant_id"]),
                "is_active": True,
                "login_portal": "master" if fallback["role"] == "admin" else "business",
            }
    return None


def resolve_login_portal(settings: Settings, username: str) -> dict[str, str]:
    """Return a non-sensitive portal hint for unified sign-in (email-first step)."""
    normalized = username.strip()
    if not normalized:
        return _unknown_login_portal_response()

    row = _lookup_user_row(settings, normalized)
    if not row or not row.get("is_active"):
        return _unknown_login_portal_response()

    role = str(row["role"])
    login_portal = row.get("login_portal") or ("master" if role == "admin" else "business")
    if role == "admin" or login_portal == "master":
        return {
            "portal": "master",
            "lead": "Platform master console — tenants, billing, and platform settings.",
            "pill": "Platform",
            "endpoint": "/auth/master-login",
            "redirect_path": "master.html",
            "forgot_path": "ops-9x7k2.html",
        }
    if role == "employee":
        return {
            "portal": "employee",
            "lead": "Staff portal — payslips, shifts, and clock-in.",
            "pill": "Staff",
            "endpoint": "/auth/employee-login",
            "redirect_path": "employee.html",
            "forgot_path": "employee-forgot-password.html",
        }
    return {
        "portal": "hr",
        "lead": "HR admin — manage employees, rotas, and compliance.",
        "pill": "Managers",
        "endpoint": "/auth/business-login",
        "redirect_path": "admin.html",
        "forgot_path": "forgot-password.html",
    }


def _unknown_login_portal_response() -> dict[str, str]:
    return {
        "portal": "unknown",
        "lead": "Enter your password — we'll open the right portal for you.",
        "pill": "Sign in",
        "endpoint": "/auth/unified-login",
        "redirect_path": "",
        "forgot_path": "employee-forgot-password.html",
    }


def resolve_unified_authentication(
    settings: Settings,
    username: str,
    password: str,
) -> tuple[AuthUser | None, Literal["hr", "employee"] | None, str | None]:
    """Authenticate once for unified sign-in and pick the business portal role."""
    row = fetch_user_from_db(settings, username)
    if row:
        if not row.get("is_active"):
            return None, None, "Invalid username or password"
        locked_until = row.get("locked_until")
        if locked_until and locked_until > datetime.now(timezone.utc):
            return None, None, "Invalid username or password"
        if not verify_password(password, row["password_hash"]):
            return None, None, "Invalid username or password"
        role = str(row["role"])
        login_portal = row.get("login_portal") or ("master" if role == "admin" else "business")
        if role == "admin" or login_portal == "master":
            return None, None, "Platform master admin uses a separate sign-in page."
        if role == "employee":
            return (
                AuthUser(username=row["username"], role=role, tenant_id=str(row["tenant_id"])),
                "employee",
                None,
            )
        if role == "hr":
            return (
                AuthUser(username=row["username"], role=role, tenant_id=str(row["tenant_id"])),
                "hr",
                None,
            )
        return None, None, "Invalid username or password"

    if settings.is_production:
        return None, None, "Invalid username or password"

    fallback_users = development_fallback_users(master_tenant_id=settings.master_customer_id)
    fallback = fallback_users.get(username)
    if not fallback:
        for key, value in fallback_users.items():
            if key.lower() == username.lower():
                fallback = value
                break
    if not fallback or fallback["password"] != password:
        return None, None, "Invalid username or password"
    role = str(fallback["role"])
    if role == "admin":
        return None, None, "Platform master admin uses a separate sign-in page."
    business_role: Literal["hr", "employee"] = "employee" if role == "employee" else "hr"
    return (
        AuthUser(username=username, role=role, tenant_id=str(fallback["tenant_id"])),
        business_role,
        None,
    )


def login_portal_mismatch_message(
    settings: Settings,
    username: str,
    password: str,
    *,
    require_role: str | None = None,
    portal: Portal | None = None,
) -> str | None:
    """When password is valid but role/portal does not match, return a clearer sign-in hint."""
    row = fetch_user_from_db(settings, username)
    if not row or not row.get("is_active"):
        return None
    locked_until = row.get("locked_until")
    if locked_until and locked_until > datetime.now(timezone.utc):
        return None
    if not verify_password(password, row["password_hash"]):
        return None

    role = row["role"]
    if require_role == "hr" and role == "employee":
        return "This is an employee account. Use the employee sign-in page instead."
    if require_role == "employee" and role == "hr":
        return "This is an HR admin account. Use the business sign-in page instead."
    if portal == "master" and role != "admin":
        return "Platform master admin uses a separate sign-in page."
    if portal == "business" and role == "admin":
        return "Platform master admin uses a separate sign-in page."
    return None


def log_security_event(
    settings: Settings,
    *,
    event_type: str,
    username: str | None,
    tenant_id: str | None,
    ip_address: str | None,
    user_agent: str | None,
    success: bool,
    detail: str | None = None,
) -> None:
    if not settings.use_db or not settings.database_url:
        return
    import psycopg2

    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO security_audit_events
                  (event_type, username, tenant_id, ip_address, user_agent, success, detail)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event_type,
                    username,
                    int(tenant_id) if tenant_id and tenant_id.isdigit() else None,
                    ip_address,
                    user_agent,
                    success,
                    detail,
                ),
            )
        conn.commit()
    finally:
        conn.close()
