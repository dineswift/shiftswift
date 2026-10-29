"""Optional MFA enrollment skip for business/HR portal login.

POST /auth/mfa/skip-enrollment accepts the same enrollment Bearer token as
/auth/mfa/setup and /auth/mfa/enable, issues a normal session, and does not
enable MFA. Business and master portals may skip optional enrollment.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from auth_mfa import decode_mfa_enrollment_token
from auth_service import AuthUser, create_token_pair, log_security_event
from config import load_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Auth MFA"])

_SKIP_ALLOWED_PORTALS = frozenset({"business", "master"})
_ATTACHED = False


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid authorization")
    return parts[1].strip()


def _client_ip(request: Request) -> str | None:
    try:
        from deps import client_ip

        return client_ip(request)
    except Exception:  # noqa: BLE001
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else None


def _claims_user(claims: dict[str, Any]) -> AuthUser:
    username = str(claims.get("username") or claims.get("sub") or "").strip()
    if not username:
        raise HTTPException(status_code=401, detail="Invalid enrollment session")

    role = str(claims.get("role") or "hr").strip() or "hr"
    tenant_raw = claims.get("tenant_id")
    try:
        tenant_id = int(tenant_raw) if tenant_raw is not None else None
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid enrollment session") from exc

    candidates: dict[str, Any] = {
        "username": username,
        "role": role,
        "tenant_id": tenant_id,
        "workspace_role": claims.get("workspace_role"),
        "user_id": claims.get("user_id"),
    }
    try:
        params = inspect.signature(AuthUser).parameters
        kwargs = {key: value for key, value in candidates.items() if key in params and value is not None}
        # Ensure required fields are present even when optional ones are omitted.
        for required in ("username", "role", "tenant_id"):
            if required in params and required not in kwargs:
                kwargs[required] = candidates[required]
        return AuthUser(**kwargs)
    except TypeError:
        return AuthUser(username=username, role=role, tenant_id=tenant_id)


def _session_payload(user: AuthUser, tokens: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "access_token": tokens.get("access_token") or tokens.get("token"),
        "refresh_token": tokens.get("refresh_token"),
        "token_type": tokens.get("token_type", "bearer"),
        "role": getattr(user, "role", None),
        "tenant_id": getattr(user, "tenant_id", None),
        "username": getattr(user, "username", None),
    }
    workspace_role = getattr(user, "workspace_role", None)
    if workspace_role:
        payload["workspace_role"] = workspace_role
    role = str(payload.get("role") or "")
    if role == "employee":
        payload["redirect_url"] = "./employee.html"
    elif role in ("hr", "admin"):
        payload["redirect_url"] = "./admin.html"
    return payload


def _log_skip(*, username: str, tenant_id: int | None, portal: str, role: str, request: Request) -> None:
    settings = load_settings()
    ip_address = _client_ip(request)
    attempts = (
        {
            "event_type": "business_mfa_enrollment_skipped",
            "username": username,
            "tenant_id": tenant_id,
            "ip_address": ip_address,
            "detail": {"portal": portal, "role": role},
            "settings": settings,
        },
        {
            "event": "business_mfa_enrollment_skipped",
            "username": username,
            "tenant_id": tenant_id,
            "ip": ip_address,
            "meta": {"portal": portal, "role": role},
        },
        ("business_mfa_enrollment_skipped", username),
    )
    for attempt in attempts:
        try:
            if isinstance(attempt, tuple):
                log_security_event(*attempt)
            else:
                params = inspect.signature(log_security_event).parameters
                kwargs = {key: value for key, value in attempt.items() if key in params}
                if not kwargs and attempt:
                    # Positional-style fallback: event name first when signature is opaque.
                    first = next(iter(attempt.values()))
                    log_security_event(first, username=username)
                else:
                    log_security_event(**kwargs)
            return
        except Exception:  # noqa: BLE001
            continue
    logger.info(
        "business_mfa_enrollment_skipped username=%s tenant_id=%s portal=%s",
        username,
        tenant_id,
        portal,
    )


@router.post("/auth/mfa/skip-enrollment")
def mfa_skip_enrollment(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Issue session tokens without enabling MFA (business or master portal)."""
    settings = load_settings()
    token = _bearer_token(authorization)
    try:
        claims = decode_mfa_enrollment_token(settings, token)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid or expired enrollment session") from exc

    if not isinstance(claims, dict):
        raise HTTPException(status_code=401, detail="Invalid or expired enrollment session")

    portal = str(claims.get("portal") or claims.get("enrollment_portal") or "").strip().lower()
    if portal not in _SKIP_ALLOWED_PORTALS:
        raise HTTPException(
            status_code=403,
            detail="MFA enrollment is required for this account and cannot be skipped",
        )

    user = _claims_user(claims)
    tokens = create_token_pair(settings, user)
    if not isinstance(tokens, dict):
        # Some implementations return a model/object.
        tokens = {
            "access_token": getattr(tokens, "access_token", None),
            "refresh_token": getattr(tokens, "refresh_token", None),
            "token_type": getattr(tokens, "token_type", "bearer"),
        }

    _log_skip(
        username=str(user.username),
        tenant_id=getattr(user, "tenant_id", None),
        portal=portal,
        role=str(getattr(user, "role", "")),
        request=request,
    )
    return _session_payload(user, tokens)


def _route_paths(target: Any) -> set[str | None]:
    return {getattr(route, "path", None) for route in getattr(target, "routes", [])}


def _append_routes(target: Any) -> bool:
    if "/auth/mfa/skip-enrollment" in _route_paths(target):
        return True
    for route in router.routes:
        target.routes.append(route)
    return "/auth/mfa/skip-enrollment" in _route_paths(target)


def _find_app() -> Any | None:
    import sys

    for mod_name in ("main", "app", "api", "server"):
        mod = sys.modules.get(mod_name)
        if mod is None:
            try:
                mod = __import__(mod_name)
            except Exception:  # noqa: BLE001
                mod = None
        candidate = getattr(mod, "app", None) if mod is not None else None
        if candidate is not None and hasattr(candidate, "include_router"):
            return candidate

    # Fallback: any loaded module that already exposes a FastAPI-like app.
    for mod in list(sys.modules.values()):
        candidate = getattr(mod, "app", None)
        if candidate is None or not hasattr(candidate, "include_router"):
            continue
        routes = getattr(candidate, "routes", None)
        if routes is None:
            continue
        # Prefer the app that already serves auth routes.
        paths = _route_paths(candidate)
        if any(isinstance(path, str) and path.startswith("/auth/") for path in paths):
            return candidate
    return None


def _install_on_app(app: Any) -> bool:
    if "/auth/mfa/skip-enrollment" in _route_paths(app):
        return True
    app.include_router(router)
    return "/auth/mfa/skip-enrollment" in _route_paths(app)


def attach_to_auth_routes() -> bool:
    """Attach skip route to the live app and/or auth_routes.router."""
    global _ATTACHED
    if _ATTACHED:
        return True

    attached = False

    # 1) Mutate auth_routes.router (works when this runs before include_router).
    try:
        import auth_routes

        target = getattr(auth_routes, "router", None)
        if target is not None and _append_routes(target):
            attached = True
            logger.info("Attached POST /auth/mfa/skip-enrollment to auth_routes.router")
    except Exception as exc:  # noqa: BLE001
        logger.debug("auth_routes attach skipped: %s", exc)

    # 2) Mount on the FastAPI app when it already exists (works after include_router).
    app = _find_app()
    if app is not None:
        try:
            if _install_on_app(app):
                attached = True
                logger.info("Attached POST /auth/mfa/skip-enrollment to app")
        except Exception as exc:  # noqa: BLE001
            logger.debug("app attach skipped: %s", exc)
    else:
        # 3) Retry on startup once main finishes importing routers.
        try:
            import auth_routes

            auth_app_getter = getattr(auth_routes, "get_app", None)
            if callable(auth_app_getter):
                app = auth_app_getter()
                if app is not None and _install_on_app(app):
                    attached = True
        except Exception:  # noqa: BLE001
            pass

        def _startup_attach() -> None:
            global _ATTACHED
            live_app = _find_app()
            if live_app is None:
                return
            try:
                if _install_on_app(live_app):
                    _ATTACHED = True
                    logger.info("Attached POST /auth/mfa/skip-enrollment on startup")
            except Exception as exc:  # noqa: BLE001
                logger.warning("MFA skip startup attach failed: %s", exc)

        # Best-effort: if auth_routes exposes an app later via module attribute.
        try:
            import auth_routes

            if not hasattr(auth_routes, "_mfa_skip_startup_hook"):
                auth_routes._mfa_skip_startup_hook = _startup_attach  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass

    _ATTACHED = attached
    if not attached:
        logger.warning("MFA skip route not attached yet; will rely on import order/startup")
    return attached
