"""WebAuthn passkeys — Face ID / Touch ID sign-in for PWA and browser."""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    AuthenticationCredential,
    PublicKeyCredentialDescriptor,
    RegistrationCredential,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from auth_service import AuthUser, authenticate_user_lookup, create_token_pair
from config import Settings

PASSKEY_CHALLENGE_MINUTES = int(os.getenv("PASSKEY_CHALLENGE_MINUTES", "5"))
PASSKEY_RP_NAME = os.getenv("PASSKEY_RP_NAME", "ShiftSwift HR")


def _normalize_username(username: str) -> str:
    return username.strip().lower()


def passkey_user_id(username: str) -> bytes:
    return hashlib.sha256(_normalize_username(username).encode("utf-8")).digest()[:32]


def _hostname_from_url(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        from urllib.parse import urlparse

        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        host = (parsed.hostname or "").strip().lower()
        return host or None
    except Exception:
        return None


def _default_app_hostname() -> str:
    app_url = (os.getenv("APP_URL") or "https://app.shiftswifthr.co.uk").rstrip("/")
    return _hostname_from_url(app_url) or "app.shiftswifthr.co.uk"


def passkey_origins() -> list[str]:
    raw = os.getenv("PASSKEY_ORIGINS", "")
    if raw.strip():
        return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]
    origins: set[str] = set()
    for env_name in ("APP_URL", "LOCAL_APP_URL"):
        value = (os.getenv(env_name) or "").strip().rstrip("/")
        if value.startswith("http"):
            origins.add(value)
    for part in os.getenv("CORS_ALLOW_ORIGINS", "").split(","):
        value = part.strip().rstrip("/")
        if value.startswith("http"):
            origins.add(value)
    if not origins:
        origins.add("https://app.shiftswifthr.co.uk")
    origins.update(
        {
            "https://app.shiftswifthr.co.uk",
            "https://shiftswifthr.co.uk",
            "https://www.shiftswifthr.co.uk",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "https://localhost",
            "capacitor://localhost",
            "ionic://localhost",
            "App://localhost",
        }
    )
    return sorted(origins)


def _allowed_passkey_hosts() -> set[str]:
    hosts: set[str] = set()
    for origin in passkey_origins():
        host = _hostname_from_url(origin)
        if host:
            hosts.add(host)
    explicit = (os.getenv("PASSKEY_RP_ID") or "").strip().lower()
    if explicit:
        hosts.add(explicit)
    hosts.add(_default_app_hostname())
    hosts.update({"localhost", "127.0.0.1", "app.shiftswifthr.co.uk", "shiftswifthr.co.uk", "www.shiftswifthr.co.uk"})
    return hosts


def passkey_rp_id(*, request_origin: str | None = None) -> str:
    """
    WebAuthn RP ID must match the browser page host.

    Chrome rejects a parent-domain RP ID (e.g. shiftswifthr.co.uk on
    app.shiftswifthr.co.uk) unless Related Origins are published. Prefer the
    exact Origin hostname from the browser request.
    """
    origin_host = _hostname_from_url(request_origin)
    if origin_host and origin_host in _allowed_passkey_hosts():
        return origin_host

    app_host = _default_app_hostname()
    explicit = (os.getenv("PASSKEY_RP_ID") or "").strip().lower()
    if explicit:
        # Ignore parent-domain overrides that would fail Chrome related-origins checks.
        if app_host != "localhost" and app_host.endswith("." + explicit) and explicit != app_host:
            return app_host
        return explicit

    return "localhost" if app_host == "localhost" else app_host


def resolve_request_origin(request: Any | None, *, client_origin: str | None = None) -> str | None:
    """Prefer an explicit client_origin (page URL), then Origin / Referer headers."""
    candidates = [
        (client_origin or "").strip().rstrip("/"),
    ]
    if request is not None:
        headers = getattr(request, "headers", None)
        if headers is not None:
            candidates.append((headers.get("x-client-origin") or "").strip().rstrip("/"))
            candidates.append((headers.get("origin") or "").strip().rstrip("/"))
            referer = (headers.get("referer") or "").strip()
            if referer:
                host = _hostname_from_url(referer)
                if host:
                    scheme = "https" if referer.lower().startswith("https") else "http"
                    candidates.append(f"{scheme}://{host}")
    for value in candidates:
        if not value:
            continue
        host = _hostname_from_url(value)
        if host and host in _allowed_passkey_hosts():
            return value if "://" in value else f"https://{value}"
    return None


def _issue_challenge_token(
    settings: Settings,
    *,
    username: str,
    action: Literal["register", "login"],
    challenge: bytes,
    rp_id: str,
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=PASSKEY_CHALLENGE_MINUTES)
    payload = {
        "sub": _normalize_username(username),
        "action": action,
        "challenge": bytes_to_base64url(challenge),
        "rp_id": rp_id,
        "type": "passkey_challenge",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_challenge_token(settings: Settings, token: str, *, action: str) -> tuple[str, bytes, str]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise ValueError("Passkey challenge expired or invalid") from exc
    if payload.get("type") != "passkey_challenge" or payload.get("action") != action:
        raise ValueError("Invalid passkey challenge")
    username = str(payload.get("sub") or "").strip()
    challenge_raw = payload.get("challenge")
    if not username or not challenge_raw:
        raise ValueError("Invalid passkey challenge payload")
    rp_id = str(payload.get("rp_id") or passkey_rp_id()).strip()
    return username, base64url_to_bytes(str(challenge_raw)), rp_id


def list_passkeys(*, conn: Any, username: str) -> list[dict[str, Any]]:
    email = _normalize_username(username)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, credential_id, sign_count, device_label, transports, created_at, last_used_at
            FROM user_passkeys
            WHERE lower(username) = lower(%s)
            ORDER BY created_at DESC
            """,
            (email,),
        )
        rows = cur.fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        items.append(
            {
                "id": int(row[0]),
                "credential_id": bytes_to_base64url(bytes(row[1])),
                "sign_count": int(row[2]),
                "device_label": row[3] or "",
                "transports": list(row[4] or []),
                "created_at": row[5].isoformat() if row[5] else None,
                "last_used_at": row[6].isoformat() if row[6] else None,
            }
        )
    return items


def user_has_passkeys(*, conn: Any, username: str) -> bool:
    email = _normalize_username(username)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM user_passkeys WHERE lower(username) = lower(%s) LIMIT 1",
            (email,),
        )
        return cur.fetchone() is not None


def delete_passkey(*, conn: Any, username: str, passkey_id: int) -> bool:
    """Remove one passkey owned by username. Returns True when a row was deleted."""
    email = _normalize_username(username)
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM user_passkeys
            WHERE id = %s AND lower(username) = lower(%s)
            RETURNING id
            """,
            (int(passkey_id), email),
        )
        return cur.fetchone() is not None


def _load_passkey_by_credential_id(*, conn: Any, credential_id: bytes) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT username, credential_id, public_key, sign_count
            FROM user_passkeys
            WHERE credential_id = %s
            LIMIT 1
            """,
            (credential_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "username": row[0],
        "credential_id": bytes(row[1]),
        "public_key": bytes(row[2]),
        "sign_count": int(row[3]),
    }


def registration_options(
    settings: Settings,
    *,
    conn: Any,
    username: str,
    device_label: str = "",
    request_origin: str | None = None,
) -> dict[str, Any]:
    email = _normalize_username(username)
    existing = list_passkeys(conn=conn, username=email)
    exclude = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(item["credential_id"]))
        for item in existing
    ]
    challenge = secrets.token_bytes(32)
    rp_id = passkey_rp_id(request_origin=request_origin)
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=PASSKEY_RP_NAME,
        user_id=passkey_user_id(email),
        user_name=email,
        user_display_name=email,
        challenge=challenge,
        exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        attestation=AttestationConveyancePreference.NONE,
    )
    token = _issue_challenge_token(
        settings,
        username=email,
        action="register",
        challenge=challenge,
        rp_id=rp_id,
    )
    from webauthn.helpers.options_to_json import options_to_json

    return {
        "challenge_token": token,
        "options": options_to_json(options),
        "device_label": device_label,
        "rp_id": rp_id,
    }


def complete_registration(
    settings: Settings,
    *,
    conn: Any,
    username: str,
    challenge_token: str,
    credential: dict[str, Any],
    device_label: str = "",
    request_origin: str | None = None,
) -> dict[str, Any]:
    email = _normalize_username(username)
    _, expected_challenge, rp_id = _decode_challenge_token(
        settings, challenge_token, action="register"
    )
    expected_origins = passkey_origins()
    if request_origin:
        cleaned = request_origin.strip().rstrip("/")
        if cleaned and cleaned not in expected_origins:
            expected_origins = [*expected_origins, cleaned]
    verification = verify_registration_response(
        credential=RegistrationCredential.model_validate(credential),
        expected_challenge=expected_challenge,
        expected_rp_id=rp_id,
        expected_origin=expected_origins,
        require_user_verification=True,
    )
    label = (device_label or "Face ID / Touch ID").strip()[:120]
    transports = list(credential.get("response", {}).get("transports") or [])
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_passkeys (
              username, credential_id, public_key, sign_count, device_label, transports
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (credential_id) DO NOTHING
            RETURNING id
            """,
            (
                email,
                verification.credential_id,
                verification.credential_public_key,
                int(verification.sign_count),
                label,
                transports,
            ),
        )
        row = cur.fetchone()
    if not row:
        raise ValueError("This passkey is already registered")
    return {"registered": True, "passkey_id": int(row[0])}


def authentication_options(
    settings: Settings,
    *,
    conn: Any,
    username: str,
    request_origin: str | None = None,
) -> dict[str, Any]:
    email = _normalize_username(username)
    passkeys = list_passkeys(conn=conn, username=email)
    if not passkeys:
        raise LookupError("No passkeys registered for this account")
    challenge = secrets.token_bytes(32)
    rp_id = passkey_rp_id(request_origin=request_origin)
    allow = [
        PublicKeyCredentialDescriptor(
            id=base64url_to_bytes(item["credential_id"]),
            transports=item.get("transports") or None,
        )
        for item in passkeys
    ]
    options = generate_authentication_options(
        rp_id=rp_id,
        challenge=challenge,
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    token = _issue_challenge_token(
        settings,
        username=email,
        action="login",
        challenge=challenge,
        rp_id=rp_id,
    )
    from webauthn.helpers.options_to_json import options_to_json

    return {"challenge_token": token, "options": options_to_json(options), "rp_id": rp_id}


def complete_authentication(
    settings: Settings,
    *,
    conn: Any,
    username: str,
    challenge_token: str,
    credential: dict[str, Any],
    request_origin: str | None = None,
) -> dict[str, Any]:
    email = _normalize_username(username)
    _, expected_challenge, rp_id = _decode_challenge_token(settings, challenge_token, action="login")
    credential_id = base64url_to_bytes(str(credential.get("rawId") or credential.get("id") or ""))
    stored = _load_passkey_by_credential_id(conn=conn, credential_id=credential_id)
    if not stored or _normalize_username(stored["username"]) != email:
        raise ValueError("Unknown passkey for this account")

    expected_origins = passkey_origins()
    if request_origin:
        cleaned = request_origin.strip().rstrip("/")
        if cleaned and cleaned not in expected_origins:
            expected_origins = [*expected_origins, cleaned]

    verification = verify_authentication_response(
        credential=AuthenticationCredential.model_validate(credential),
        expected_challenge=expected_challenge,
        expected_rp_id=rp_id,
        expected_origin=expected_origins,
        credential_public_key=stored["public_key"],
        credential_current_sign_count=stored["sign_count"],
        require_user_verification=True,
    )

    user = authenticate_user_lookup(settings, stored["username"])
    if not user:
        raise ValueError("Account not found")

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE user_passkeys
            SET sign_count = %s, last_used_at = NOW()
            WHERE credential_id = %s
            """,
            (int(verification.new_sign_count), credential_id),
        )

    tenant_id = str(user.tenant_id)
    tokens = create_token_pair(settings, AuthUser(user.username, user.role, tenant_id))
    portal = "master" if user.role == "admin" and str(tenant_id) == str(settings.master_customer_id) else "business"
    return {
        **tokens.__dict__,
        "portal": portal,
        "role": user.role,
        "tenant_id": tenant_id,
        "username": user.username,
        "mfa_required": False,
        "passkey_login": True,
    }
