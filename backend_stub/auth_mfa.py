"""TOTP two-factor authentication — separate Master and Business login portals."""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import quote

import jwt
import pyotp

from config import Settings
from core.crypto import decrypt_text, encrypt_text, encryption_configured

Portal = Literal["master", "business"]
MFA_ISSUER = os.getenv("MFA_ISSUER_NAME", "ShiftSwift HR")
MFA_CHALLENGE_MINUTES = int(os.getenv("MFA_CHALLENGE_MINUTES", "5"))
MFA_ENROLLMENT_MINUTES = int(os.getenv("MFA_ENROLLMENT_MINUTES", "15"))
MFA_TRUSTED_DEVICE_DAYS = int(os.getenv("MFA_TRUSTED_DEVICE_DAYS", "30"))


def _store_secret(raw_secret: str) -> str:
    if encryption_configured():
        return encrypt_text(raw_secret)
    return f"plain:{raw_secret}"


def _load_secret(stored: str) -> str:
    if stored.startswith("plain:"):
        return stored[6:]
    return decrypt_text(stored)


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(*, username: str, secret: str, portal: Portal) -> str:
    label = f"{MFA_ISSUER} ({'Master' if portal == 'master' else 'Business'}):{username}"
    return pyotp.TOTP(secret).provisioning_uri(name=quote(label), issuer_name=MFA_ISSUER)


def verify_totp_code(*, secret: str, code: str) -> bool:
    if not code or not secret:
        return False
    normalized = code.strip().replace(" ", "")
    if not normalized.isdigit() or len(normalized) not in {6, 8}:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(normalized, valid_window=1)


def create_mfa_challenge_token(
    settings: Settings,
    *,
    username: str,
    role: str,
    tenant_id: str,
    portal: Portal,
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=MFA_CHALLENGE_MINUTES)
    payload = {
        "sub": username,
        "role": role,
        "tenant_id": tenant_id,
        "portal": portal,
        "type": "mfa_challenge",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_mfa_challenge_token(settings: Settings, token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired MFA challenge") from exc
    if payload.get("type") != "mfa_challenge":
        raise ValueError("Invalid MFA challenge token")
    required = ("sub", "role", "tenant_id", "portal")
    if not all(payload.get(key) for key in required):
        raise ValueError("Malformed MFA challenge")
    return payload


def create_mfa_enrollment_token(
    settings: Settings,
    *,
    username: str,
    role: str,
    tenant_id: str,
    portal: Portal = "master",
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=MFA_ENROLLMENT_MINUTES)
    payload = {
        "sub": username,
        "role": role,
        "tenant_id": tenant_id,
        "portal": portal,
        "type": "mfa_enrollment",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_mfa_enrollment_token(settings: Settings, token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired MFA enrollment session") from exc
    if payload.get("type") != "mfa_enrollment":
        raise ValueError("Invalid MFA enrollment token")
    if payload.get("portal") not in {"master", "business"}:
        raise ValueError("Invalid MFA enrollment portal")
    required = ("sub", "role", "tenant_id", "portal")
    if not all(payload.get(key) for key in required):
        raise ValueError("Malformed MFA enrollment token")
    return payload


def fetch_user_mfa(cur: Any, username: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT username, role, tenant_id::text, login_portal, mfa_enabled, totp_secret, is_active
        FROM app_users
        WHERE lower(username) = lower(%s)
        LIMIT 1
        """,
        (username,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "username": row[0],
        "role": row[1],
        "tenant_id": str(row[2]),
        "login_portal": row[3],
        "mfa_enabled": bool(row[4]),
        "totp_secret": row[5],
        "is_active": bool(row[6]),
    }


def portal_allows_user(*, portal: Portal, role: str, login_portal: str | None) -> bool:
    if portal == "master":
        return role == "admin" and (login_portal or "master") == "master"
    return role in {"hr", "employee"} and (login_portal or "business") == "business"


def begin_mfa_setup(*, conn: Any, username: str) -> dict[str, str]:
    secret = generate_totp_secret()
    with conn.cursor() as cur:
        user = fetch_user_mfa(cur, username)
        if not user:
            raise LookupError("user not found")
        portal: Portal = user["login_portal"] if user["login_portal"] in {"master", "business"} else "business"
        cur.execute(
            """
            UPDATE app_users SET totp_secret = %s, mfa_enabled = FALSE, updated_at = NOW()
            WHERE lower(username) = lower(%s)
            """,
            (_store_secret(secret), username),
        )
    conn.commit()
    return {
        "secret": secret,
        "otpauth_uri": provisioning_uri(username=user["username"], secret=secret, portal=portal),
        "portal": portal,
    }


def enable_mfa_with_passkey(*, conn: Any, username: str) -> None:
    """Mark MFA active when the user enrolled with Face ID / Touch ID (WebAuthn)."""
    with conn.cursor() as cur:
        user = fetch_user_mfa(cur, username)
        if not user:
            raise LookupError("user not found")
        cur.execute(
            """
            UPDATE app_users
            SET mfa_enabled = TRUE,
                mfa_enabled_at = NOW(),
                totp_secret = NULL,
                updated_at = NOW()
            WHERE lower(username) = lower(%s)
            """,
            (username,),
        )
    conn.commit()


def confirm_mfa_setup(*, conn: Any, username: str, code: str) -> None:
    with conn.cursor() as cur:
        user = fetch_user_mfa(cur, username)
        if not user or not user.get("totp_secret"):
            raise LookupError("MFA setup not started")
        secret = _load_secret(user["totp_secret"])
        if not verify_totp_code(secret=secret, code=code):
            raise ValueError("Invalid authentication code")
        cur.execute(
            """
            UPDATE app_users SET mfa_enabled = TRUE, mfa_enabled_at = NOW(), updated_at = NOW()
            WHERE lower(username) = lower(%s)
            """,
            (username,),
        )
    conn.commit()


def disable_mfa(*, conn: Any, username: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE app_users SET mfa_enabled = FALSE, totp_secret = NULL, mfa_enabled_at = NULL, updated_at = NOW()
            WHERE lower(username) = lower(%s)
            """,
            (username,),
        )
    conn.commit()


def verify_user_mfa_code(*, conn: Any, username: str, code: str) -> bool:
    with conn.cursor() as cur:
        user = fetch_user_mfa(cur, username)
    if not user or not user.get("mfa_enabled") or not user.get("totp_secret"):
        return False
    secret = _load_secret(user["totp_secret"])
    return verify_totp_code(secret=secret, code=code)


def hash_device_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def issue_trusted_device(
    *,
    conn: Any,
    username: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
    device_label: str | None = None,
) -> str:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_device_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=MFA_TRUSTED_DEVICE_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO mfa_trusted_devices (
              username, device_token_hash, device_label, user_agent, ip_address, expires_at
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (username, token_hash, device_label, user_agent, ip_address, expires_at),
        )
    conn.commit()
    return raw_token


def trusted_device_is_valid(*, conn: Any, username: str, raw_token: str) -> bool:
    if not raw_token or not username:
        return False
    token_hash = hash_device_token(raw_token.strip())
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id
            FROM mfa_trusted_devices
            WHERE lower(username) = lower(%s)
              AND device_token_hash = %s
              AND revoked_at IS NULL
              AND expires_at > %s
            LIMIT 1
            """,
            (username, token_hash, now),
        )
        row = cur.fetchone()
        if not row:
            return False
        cur.execute(
            "UPDATE mfa_trusted_devices SET last_used_at = NOW() WHERE id = %s",
            (row[0],),
        )
    conn.commit()
    return True


def revoke_trusted_devices(*, conn: Any, username: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mfa_trusted_devices
            SET revoked_at = NOW()
            WHERE lower(username) = lower(%s) AND revoked_at IS NULL
            """,
            (username,),
        )
    conn.commit()
