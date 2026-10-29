"""Optional MFA enrollment skip for business/HR portal login.

Mounted at POST /auth/mfa/skip-enrollment. Accepts the same enrollment Bearer
token as /auth/mfa/setup and /auth/mfa/enable, but issues a normal session
without enabling MFA. Master portal enrollment remains required.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from auth_mfa import decode_mfa_enrollment_token
from auth_service import AuthUser, create_token_pair, log_security_event
from config import load_settings
from deps import client_ip

router = APIRouter(tags=["Auth MFA"])

# Business/HR only — master enrollment cannot be skipped.
_SKIP_ALLOWED_PORTALS = frozenset({"business"})


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid authorization")
    return parts[1].strip()


def _session_payload(user: AuthUser, tokens: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "token_type": tokens.get("token_type", "bearer"),
        "role": user.role,
        "tenant_id": user.tenant_id,
        "username": user.username,
    }
    if getattr(user, "workspace_role", None):
        payload["workspace_role"] = user.workspace_role
    redirect_url = getattr(user, "redirect_url", None)
    if redirect_url:
        payload["redirect_url"] = redirect_url
    elif user.role == "employee":
        payload["redirect_url"] = "./employee.html"
    elif user.role in ("hr", "admin"):
        payload["redirect_url"] = "./admin.html"
    return payload


@router.post("/auth/mfa/skip-enrollment")
def mfa_skip_enrollment(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Issue session tokens without enabling MFA (business portal only)."""
    settings = load_settings()
    token = _bearer_token(authorization)
    try:
        claims = decode_mfa_enrollment_token(token)
    except Exception as exc:  # noqa: BLE001 — mirror enable endpoint error shape
        raise HTTPException(status_code=401, detail="Invalid or expired enrollment session") from exc

    portal = str(claims.get("portal") or claims.get("enrollment_portal") or "").strip().lower()
    if portal not in _SKIP_ALLOWED_PORTALS:
        raise HTTPException(
            status_code=403,
            detail="MFA enrollment is required for this account and cannot be skipped",
        )

    username = str(claims.get("username") or claims.get("sub") or "").strip()
    if not username:
        raise HTTPException(status_code=401, detail="Invalid enrollment session")

    tenant_id = claims.get("tenant_id")
    role = str(claims.get("role") or "hr")
    try:
        tenant_id_int = int(tenant_id) if tenant_id is not None else None
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid enrollment session") from exc

    user = AuthUser(
        username=username,
        role=role,
        tenant_id=tenant_id_int,
    )
    # Preserve optional fields when AuthUser supports them.
    for attr in ("workspace_role", "redirect_url", "user_id"):
        if attr in claims and hasattr(user, attr):
            try:
                setattr(user, attr, claims[attr])
            except Exception:  # noqa: BLE001
                pass

    tokens = create_token_pair(user)
    log_security_event(
        "business_mfa_enrollment_skipped",
        username=username,
        tenant_id=tenant_id_int,
        ip_address=client_ip(request),
        detail={"portal": portal, "role": role},
        settings=settings,
    )
    return JSONResponse(_session_payload(user, tokens))
