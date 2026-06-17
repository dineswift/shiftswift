"""Authentication routes — separate Master / Business login with optional TOTP 2FA."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_mfa import (
    MFA_ENROLLMENT_MINUTES,
    begin_mfa_setup,
    confirm_mfa_setup,
    create_mfa_challenge_token,
    create_mfa_enrollment_token,
    decode_mfa_challenge_token,
    decode_mfa_enrollment_token,
    disable_mfa,
    fetch_user_mfa,
    portal_allows_user,
    verify_user_mfa_code,
)
from auth_password_reset import complete_password_reset, request_password_reset
from auth_service import (
    AuthUser,
    authenticate_user,
    clear_login_attempts,
    create_token_pair,
    decode_token,
    is_login_rate_limited,
    log_security_event,
    login_portal_mismatch_message,
    record_login_attempt,
)
from config import load_settings
from deps import client_ip, get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = load_settings()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)
    tenant_id: str | None = Field(default=None, max_length=32)
    email: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class MfaVerifyRequest(BaseModel):
    challenge_token: str = Field(min_length=10)
    code: str = Field(min_length=6, max_length=8)


class MfaEnableRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class MfaDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    code: str = Field(min_length=6, max_length=8)

class EmployeeGdprConsentRequest(BaseModel):
    accept_employee_gdpr: bool = False


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: Literal["hr", "employee", "any"] = "any"


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)
    accept_employee_gdpr: bool = False


def _db_conn():
    import os

    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return token


def _resolve_mfa_setup_user(
    authorization: str | None,
) -> tuple[AuthUser, Literal["session", "enrollment"]]:
    token = _extract_bearer(authorization)
    try:
        enrollment = decode_mfa_enrollment_token(settings, token)
        return (
            AuthUser(
                username=str(enrollment["sub"]),
                role=str(enrollment["role"]),
                tenant_id=str(enrollment["tenant_id"]),
            ),
            "enrollment",
        )
    except ValueError:
        pass
    try:
        user = decode_token(settings, token, expected_type="access")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return user, "session"


def get_mfa_setup_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> tuple[AuthUser, Literal["session", "enrollment"]]:
    return _resolve_mfa_setup_user(authorization)


def _login_response(
    request: Request,
    payload: LoginRequest,
    *,
    portal: Literal["master", "business"],
    business_role: Literal["hr", "employee"] | None = None,
    enforce_master_mfa: bool = False,
    require_mfa_enrollment: bool = False,
) -> dict[str, object]:
    ip = client_ip(request)
    user_agent = request.headers.get("User-Agent")
    require_admin = portal == "master"
    require_role: str | None = "admin" if require_admin else business_role

    if is_login_rate_limited(settings, ip, payload.username):
        log_security_event(
            settings,
            event_type="login_rate_limited",
            username=payload.username,
            tenant_id=payload.tenant_id,
            ip_address=ip,
            user_agent=user_agent,
            success=False,
            detail=f"portal={portal}",
        )
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")

    user = authenticate_user(
        settings,
        payload.username,
        payload.password,
        require_role=require_role,
        portal=portal,
    )
    if not user:
        record_login_attempt(settings, ip, payload.username)
        mismatch = login_portal_mismatch_message(
            settings,
            payload.username,
            payload.password,
            require_role=require_role,
            portal=portal,
        )
        log_security_event(
            settings,
            event_type="login_failed",
            username=payload.username,
            tenant_id=payload.tenant_id,
            ip_address=ip,
            user_agent=user_agent,
            success=False,
            detail=f"portal={portal}",
        )
        raise HTTPException(
            status_code=401,
            detail=mismatch or "Invalid credentials for this login type",
        )

    if portal == "business":
        tenant_id = str(user.tenant_id)
    else:
        tenant_id = str(payload.tenant_id or user.tenant_id)

    mfa_required = False
    mfa_enabled = False
    if settings.use_db and settings.database_url:
        conn = _db_conn()
        try:
            with conn.cursor() as cur:
                row = fetch_user_mfa(cur, user.username)
            mfa_enabled = bool(row and row.get("mfa_enabled"))
            mfa_required = mfa_enabled
        finally:
            conn.close()

    enrollment_portal: Literal["master", "business"] = portal
    must_enroll = False
    if portal == "master" and enforce_master_mfa and not mfa_enabled:
        must_enroll = True
        enrollment_portal = "master"
    elif portal == "business" and require_mfa_enrollment and not mfa_enabled:
        must_enroll = True
        enrollment_portal = "business"

    if must_enroll:
        clear_login_attempts(ip, payload.username)
        enrollment = create_mfa_enrollment_token(
            settings,
            username=user.username,
            role=user.role,
            tenant_id=tenant_id,
            portal=enrollment_portal,
        )
        event_type = "master_mfa_enrollment_started" if enrollment_portal == "master" else "business_mfa_enrollment_started"
        log_security_event(
            settings,
            event_type=event_type,
            username=user.username,
            tenant_id=tenant_id,
            ip_address=ip,
            user_agent=user_agent,
            success=True,
            detail=f"MFA enrollment required ({enrollment_portal})",
        )
        return {
            "mfa_enrollment_required": True,
            "enrollment_token": enrollment,
            "portal": enrollment_portal,
            "username": user.username,
            "tenant_id": tenant_id,
            "role": user.role,
            "expires_in": MFA_ENROLLMENT_MINUTES * 60,
            "message": "Set up your authenticator app to continue.",
        }

    if mfa_required:
        challenge = create_mfa_challenge_token(
            settings,
            username=user.username,
            role=user.role,
            tenant_id=tenant_id,
            portal=portal,
        )
        log_security_event(
            settings,
            event_type="mfa_challenge_issued",
            username=user.username,
            tenant_id=tenant_id,
            ip_address=ip,
            user_agent=user_agent,
            success=True,
            detail=f"portal={portal}",
        )
        return {
            "mfa_required": True,
            "challenge_token": challenge,
            "portal": portal,
            "username": user.username,
            "tenant_id": tenant_id,
            "message": "Enter the 6-digit code from your authenticator app.",
        }

    clear_login_attempts(ip, payload.username)
    tokens = create_token_pair(settings, AuthUser(user.username, user.role, tenant_id))
    log_security_event(
        settings,
        event_type="login_success",
        username=user.username,
        tenant_id=tenant_id,
        ip_address=ip,
        user_agent=user_agent,
        success=True,
        detail=f"portal={portal}",
    )
    return {**tokens.__dict__, "portal": portal, "role": user.role, "mfa_required": False}


@router.post("/login")
def auth_login(request: Request, payload: LoginRequest) -> dict[str, object]:
    from auth_policy import business_require_mfa_hr

    return _login_response(
        request,
        payload,
        portal="business",
        business_role="hr",
        require_mfa_enrollment=business_require_mfa_hr(settings),
    )


@router.post("/tenant-login")
def tenant_login(request: Request, payload: LoginRequest) -> dict[str, object]:
    """Business HR login — legacy alias for /auth/business-login."""
    from auth_policy import business_require_mfa_hr

    return _login_response(
        request,
        payload,
        portal="business",
        business_role="hr",
        require_mfa_enrollment=business_require_mfa_hr(settings),
    )


@router.post("/business-login")
def business_login(request: Request, payload: LoginRequest) -> dict[str, object]:
    """Business HR login — same as tenant-login."""
    from auth_policy import business_require_mfa_hr

    return _login_response(
        request,
        payload,
        portal="business",
        business_role="hr",
        require_mfa_enrollment=business_require_mfa_hr(settings),
    )


@router.post("/employee-login")
def employee_login(request: Request, payload: LoginRequest) -> dict[str, object]:
    """Employee self-service login — not for HR or master admins."""
    from auth_policy import employee_require_mfa

    return _login_response(
        request,
        payload,
        portal="business",
        business_role="employee",
        require_mfa_enrollment=employee_require_mfa(settings),
    )


@router.post("/master-login")
def master_login(request: Request, payload: LoginRequest) -> dict[str, object]:
    """Master platform admin login — isolated from business accounts."""
    from modules.master.security import assert_master_ip, master_require_mfa

    assert_master_ip(request, settings)
    return _login_response(request, payload, portal="master", enforce_master_mfa=master_require_mfa(settings))


@router.post("/mfa/verify")
def verify_mfa_login(request: Request, payload: MfaVerifyRequest) -> dict[str, object]:
    ip = client_ip(request)
    user_agent = request.headers.get("User-Agent")
    try:
        challenge = decode_mfa_challenge_token(settings, payload.challenge_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    if not settings.use_db or not settings.database_url:
        raise HTTPException(status_code=503, detail="MFA requires database")

    conn = _db_conn()
    try:
        if not verify_user_mfa_code(conn=conn, username=challenge["sub"], code=payload.code):
            log_security_event(
                settings,
                event_type="mfa_verify_failed",
                username=challenge["sub"],
                tenant_id=challenge["tenant_id"],
                ip_address=ip,
                user_agent=user_agent,
                success=False,
            )
            raise HTTPException(status_code=401, detail="Invalid authentication code")

        with conn.cursor() as cur:
            user = fetch_user_mfa(cur, challenge["sub"])
        if not user or not portal_allows_user(
            portal=challenge["portal"],
            role=user["role"],
            login_portal=user.get("login_portal"),
        ):
            raise HTTPException(status_code=403, detail="Portal access denied")
    finally:
        conn.close()

    clear_login_attempts(ip, challenge["sub"])
    user_obj = AuthUser(
        username=challenge["sub"],
        role=challenge["role"],
        tenant_id=str(challenge["tenant_id"]),
    )
    tokens = create_token_pair(settings, user_obj)
    log_security_event(
        settings,
        event_type="login_success",
        username=user_obj.username,
        tenant_id=user_obj.tenant_id,
        ip_address=ip,
        user_agent=user_agent,
        success=True,
        detail=f"portal={challenge['portal']};mfa=1",
    )
    return {**tokens.__dict__, "portal": challenge["portal"], "mfa_required": False}


@router.post("/mfa/setup")
def mfa_setup(
    identity: Annotated[tuple[AuthUser, Literal["session", "enrollment"]], Depends(get_mfa_setup_user)],
) -> dict[str, object]:
    current_user, mode = identity
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            user = fetch_user_mfa(cur, current_user.username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if mode == "enrollment" and not user.get("mfa_enabled"):
            pass
        elif user.get("mfa_enabled"):
            raise HTTPException(status_code=400, detail="MFA is already enabled")
        result = begin_mfa_setup(conn=conn, username=current_user.username)
    finally:
        conn.close()
    return {
        "otpauth_uri": result["otpauth_uri"],
        "portal": result["portal"],
        "manual_secret": result["secret"],
        "message": "Scan the URI in Google Authenticator, Authy, or Microsoft Authenticator, then confirm with a code.",
    }


@router.post("/mfa/enable")
def mfa_enable(
    payload: MfaEnableRequest,
    request: Request,
    identity: Annotated[tuple[AuthUser, Literal["session", "enrollment"]], Depends(get_mfa_setup_user)],
) -> dict[str, object]:
    current_user, mode = identity
    conn = _db_conn()
    try:
        confirm_mfa_setup(conn=conn, username=current_user.username, code=payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()

    if mode == "enrollment":
        ip = client_ip(request)
        user_agent = request.headers.get("User-Agent")
        tokens = create_token_pair(settings, current_user)
        portal = "master" if current_user.role == "admin" else "business"
        log_security_event(
            settings,
            event_type="login_success",
            username=current_user.username,
            tenant_id=current_user.tenant_id,
            ip_address=ip,
            user_agent=user_agent,
            success=True,
            detail=f"portal={portal};mfa_enrollment=1",
        )
        if portal == "master":
            log_security_event(
                settings,
                event_type="master_mfa_enrollment_completed",
                username=current_user.username,
                tenant_id=current_user.tenant_id,
                ip_address=ip,
                user_agent=user_agent,
                success=True,
                detail="Master MFA enabled",
            )
            message = "Two-factor authentication is active. Opening master console…"
            redirect_hint = "./master.html"
        elif current_user.role == "employee":
            message = "Two-factor authentication is active. Opening employee portal…"
            redirect_hint = "./employee.html"
        else:
            log_security_event(
                settings,
                event_type="business_mfa_enrollment_completed",
                username=current_user.username,
                tenant_id=current_user.tenant_id,
                ip_address=ip,
                user_agent=user_agent,
                success=True,
                detail="Business MFA enabled",
            )
            message = "Two-factor authentication is active. Opening HR dashboard…"
            redirect_hint = "./admin.html"
        return {
            **tokens.__dict__,
            "portal": portal,
            "role": current_user.role,
            "mfa_required": False,
            "status": "enabled",
            "message": message,
            "redirect_url": redirect_hint,
        }

    return {"status": "enabled", "message": "Two-factor authentication is now active on your account."}


@router.post("/mfa/disable")
def mfa_disable(
    payload: MfaDisableRequest,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, str]:
    from auth_policy import business_require_mfa_hr, employee_require_mfa

    user = authenticate_user(settings, current_user.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid password")
    if current_user.role == "admin" and str(current_user.tenant_id) == str(settings.master_customer_id):
        from modules.master.security import master_require_mfa

        if master_require_mfa(settings):
            raise HTTPException(status_code=400, detail="Master MFA is required and cannot be disabled here.")
    elif current_user.role == "hr" and business_require_mfa_hr(settings):
        raise HTTPException(status_code=400, detail="Two-factor authentication is required for HR accounts.")
    elif current_user.role == "employee" and employee_require_mfa(settings):
        raise HTTPException(status_code=400, detail="Two-factor authentication is required for employee accounts.")
    conn = _db_conn()
    try:
        if not verify_user_mfa_code(conn=conn, username=current_user.username, code=payload.code):
            raise HTTPException(status_code=401, detail="Invalid authentication code")
        disable_mfa(conn=conn, username=current_user.username)
    finally:
        conn.close()
    return {"status": "disabled", "message": "Two-factor authentication has been turned off."}


@router.get("/mfa/status")
def mfa_status(current_user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, object]:
    from auth_policy import business_require_mfa_hr, employee_require_mfa

    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            user = fetch_user_mfa(cur, current_user.username)
    finally:
        conn.close()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    policy_required = False
    if user["role"] == "hr":
        policy_required = business_require_mfa_hr(settings)
    elif user["role"] == "employee":
        policy_required = employee_require_mfa(settings)
    elif user["role"] == "admin":
        from modules.master.security import master_require_mfa

        policy_required = master_require_mfa(settings)
    return {
        "username": user["username"],
        "portal": user.get("login_portal"),
        "mfa_enabled": bool(user.get("mfa_enabled")),
        "role": user["role"],
        "policy_required": policy_required,
    }


@router.post("/forgot-password")
def forgot_password(request: Request, payload: ForgotPasswordRequest) -> dict[str, str]:
    if not settings.use_db or not settings.database_url:
        raise HTTPException(status_code=503, detail="Password reset requires database")
    conn = _db_conn()
    try:
        return request_password_reset(
            settings=settings,
            conn=conn,
            email=payload.email.strip(),
            role_hint=payload.role,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
        )
    finally:
        conn.close()


@router.post("/reset-password")
def reset_password(request: Request, payload: ResetPasswordRequest) -> dict[str, str]:
    if not settings.use_db or not settings.database_url:
        raise HTTPException(status_code=503, detail="Password reset requires database")
    conn = _db_conn()
    try:
        return complete_password_reset(
            settings=settings,
            conn=conn,
            raw_token=payload.token,
            new_password=payload.new_password,
            accept_employee_gdpr=payload.accept_employee_gdpr,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/reset-password/context")
def reset_password_context(token: str) -> dict[str, object]:
    if not settings.use_db or not settings.database_url:
        raise HTTPException(status_code=503, detail="Password reset requires database")
    conn = _db_conn()
    try:
        from employee_portal_consent import get_password_reset_context

        return get_password_reset_context(settings=settings, conn=conn, raw_token=token)
    except LookupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/employee/gdpr-consent")
def accept_employee_gdpr_consent(
    request: Request,
    payload: EmployeeGdprConsentRequest,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, str]:
    if current_user.role != "employee":
        raise HTTPException(status_code=403, detail="Employee portal access only")
    if not settings.use_db or not settings.database_url:
        raise HTTPException(status_code=503, detail="Consent recording requires database")
    from employee_portal_consent import (
        has_employee_gdpr_consent,
        record_employee_gdpr_consent,
        tenant_display_name,
        validate_employee_gdpr_acceptance,
    )

    tenant_id = int(current_user.tenant_id)
    conn = _db_conn()
    try:
        if has_employee_gdpr_consent(tenant_id=tenant_id, username=current_user.username, conn=conn):
            return {"message": "Privacy notice already accepted."}
        validate_employee_gdpr_acceptance(accept_employee_gdpr=payload.accept_employee_gdpr)
        record_employee_gdpr_consent(
            tenant_id=tenant_id,
            username=current_user.username,
            employer_name=tenant_display_name(tenant_id=tenant_id, conn=conn),
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
        conn.commit()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return {"message": "Privacy notice accepted."}


@router.post("/refresh")
def refresh_token(payload: RefreshRequest) -> dict[str, object]:
    try:
        user = decode_token(settings, payload.refresh_token, expected_type="refresh")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    tokens = create_token_pair(settings, user)
    return tokens.__dict__


@router.get("/verify")
def verify_auth(current_user: Annotated[AuthUser, Depends(get_current_user)]) -> dict[str, object]:
    result: dict[str, object] = {
        "status": "ok",
        "username": current_user.username,
        "role": current_user.role,
        "tenant_id": current_user.tenant_id,
    }
    if current_user.impersonated_by:
        result["impersonating"] = True
        result["impersonated_by"] = current_user.impersonated_by
    if current_user.role != "employee" or not settings.use_db or not settings.database_url:
        return result
    from employee_portal_consent import has_employee_gdpr_consent, tenant_display_name
    from modules.time_punch.service import employee_time_clock_enabled

    tenant_id = int(current_user.tenant_id)
    conn = _db_conn()
    try:
        result["employer_name"] = tenant_display_name(tenant_id=tenant_id, conn=conn)
        result["time_clock_enabled"] = employee_time_clock_enabled(
            tenant_id=tenant_id,
            username=current_user.username,
            conn=conn,
        )
        requires = not has_employee_gdpr_consent(
            tenant_id=tenant_id,
            username=current_user.username,
            conn=conn,
        )
        result["gdpr_consent_required"] = requires
    finally:
        conn.close()
    return result
