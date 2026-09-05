"""Email OTP second factor — default MFA method after password login."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from config import Settings
from core.notifications import fetch_tenant_contacts, send_email_content, smtp_configured

logger = logging.getLogger(__name__)

EMAIL_MFA_MINUTES = int(os.getenv("EMAIL_MFA_MINUTES", "10"))
EMAIL_MFA_MAX_ATTEMPTS = int(os.getenv("EMAIL_MFA_MAX_ATTEMPTS", "5"))
EMAIL_MFA_RESEND_SECONDS = int(os.getenv("EMAIL_MFA_RESEND_SECONDS", "45"))
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def looks_like_email(value: str | None) -> bool:
    return bool(value and _EMAIL_RE.match(str(value).strip()))


def mask_email(email: str) -> str:
    raw = str(email or "").strip()
    if "@" not in raw:
        return raw
    local, _, domain = raw.partition("@")
    if len(local) <= 2:
        masked_local = (local[:1] + "*") if local else "*"
    else:
        masked_local = f"{local[0]}{'*' * min(6, len(local) - 2)}{local[-1]}"
    return f"{masked_local}@{domain}"


def parse_tenant_id(value: str | int | None) -> int | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw or raw.lower() == "none":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def ensure_mfa_email_codes_table(conn: Any) -> None:
    """Create the OTP table if migration 092 has not been applied yet."""
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS mfa_email_codes (
              id BIGSERIAL PRIMARY KEY,
              username TEXT NOT NULL,
              challenge_jti TEXT NOT NULL,
              code_hash TEXT NOT NULL,
              attempts INT NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              expires_at TIMESTAMPTZ NOT NULL,
              consumed_at TIMESTAMPTZ,
              last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS mfa_email_codes_username_active_idx
              ON mfa_email_codes (lower(username), expires_at DESC)
              WHERE consumed_at IS NULL
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS mfa_email_codes_challenge_jti_active_uq
              ON mfa_email_codes (challenge_jti)
              WHERE consumed_at IS NULL
            """
        )


def generate_email_mfa_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _hr_email_usernames(*, conn: Any, tenant_id: int) -> list[str]:
    """Existing tenants often used a non-email HR username; find any email login on the tenant."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT username
            FROM app_users
            WHERE tenant_id = %s
              AND is_active = TRUE
              AND role = 'hr'
              AND COALESCE(login_portal, 'business') = 'business'
            ORDER BY id ASC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall() or []
    found: list[str] = []
    for (name,) in rows:
        if looks_like_email(name):
            found.append(str(name).strip())
    return found


def _employee_email_for_username(*, conn: Any, tenant_id: int, username: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT email
            FROM employees
            WHERE tenant_id = %s
              AND email IS NOT NULL
              AND lower(trim(email)) = lower(trim(%s))
            LIMIT 1
            """,
            (tenant_id, username),
        )
        row = cur.fetchone()
    if row and looks_like_email(row[0]):
        return str(row[0]).strip()
    return None


def resolve_login_otp_recipients(
    *,
    conn: Any,
    username: str,
    tenant_id: str | int | None,
) -> list[str]:
    """Every inbox that should receive this sign-in code.

    The login username wins when it is an email. Existing tenants often just
    updated billing/signatory, so those addresses are included as well.
    """
    found: list[str] = []

    def add(value: str | None) -> None:
        if not looks_like_email(value):
            return
        addr = str(value).strip()
        if addr.lower() not in {item.lower() for item in found}:
            found.append(addr)

    add(username)
    parsed_tenant = parse_tenant_id(tenant_id)
    if parsed_tenant is not None:
        add(_employee_email_for_username(conn=conn, tenant_id=parsed_tenant, username=username))
        for hr_email in _hr_email_usernames(conn=conn, tenant_id=parsed_tenant):
            add(hr_email)
        contacts = fetch_tenant_contacts(tenant_id=parsed_tenant, conn=conn)
        for key in ("hr_email", "billing_email", "signatory_email"):
            add(contacts.get(key) if contacts else None)
    return found


def resolve_login_otp_recipient(
    *,
    conn: Any,
    username: str,
    tenant_id: str | int | None,
) -> str:
    """Primary inbox for the sign-in code."""
    recipients = resolve_login_otp_recipients(conn=conn, username=username, tenant_id=tenant_id)
    if recipients:
        return recipients[0]
    raise RuntimeError(
        "This account does not have an email address for verification codes. "
        "Sign in with a work email, or add a billing/HR email on the tenant."
    )


def issue_email_mfa_code(
    *,
    conn: Any,
    username: str,
    challenge_jti: str,
) -> str:
    """Store a new hashed OTP for this challenge and return the plaintext code."""
    ensure_mfa_email_codes_table(conn)
    code = generate_email_mfa_code()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=EMAIL_MFA_MINUTES)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mfa_email_codes
            SET consumed_at = COALESCE(consumed_at, NOW())
            WHERE (lower(username) = lower(%s) OR challenge_jti = %s)
              AND consumed_at IS NULL
            """,
            (username, challenge_jti),
        )
        cur.execute(
            """
            INSERT INTO mfa_email_codes (
              username, challenge_jti, code_hash, expires_at, last_sent_at
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (username, challenge_jti, _hash_code(code), expires, now),
        )
    return code


def seconds_until_email_mfa_resend(*, conn: Any, challenge_jti: str) -> int:
    ensure_mfa_email_codes_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT last_sent_at
            FROM mfa_email_codes
            WHERE challenge_jti = %s AND consumed_at IS NULL
            ORDER BY id DESC
            LIMIT 1
            """,
            (challenge_jti,),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return 0
    last_sent = row[0]
    if last_sent.tzinfo is None:
        last_sent = last_sent.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - last_sent).total_seconds()
    remaining = int(EMAIL_MFA_RESEND_SECONDS - elapsed)
    return max(0, remaining)


def verify_email_mfa_code(
    *,
    conn: Any,
    username: str,
    challenge_jti: str,
    code: str,
) -> bool:
    normalized = str(code or "").strip().replace(" ", "")
    if not normalized.isdigit() or len(normalized) != 6:
        return False
    ensure_mfa_email_codes_table(conn)
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, code_hash, attempts, expires_at
            FROM mfa_email_codes
            WHERE challenge_jti = %s
              AND lower(username) = lower(%s)
              AND consumed_at IS NULL
            ORDER BY id DESC
            LIMIT 1
            FOR UPDATE
            """,
            (challenge_jti, username),
        )
        row = cur.fetchone()
        if not row:
            return False
        row_id, code_hash, attempts, expires_at = row
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= now or int(attempts or 0) >= EMAIL_MFA_MAX_ATTEMPTS:
            cur.execute(
                "UPDATE mfa_email_codes SET consumed_at = NOW() WHERE id = %s",
                (row_id,),
            )
            return False
        if not secrets.compare_digest(str(code_hash), _hash_code(normalized)):
            cur.execute(
                "UPDATE mfa_email_codes SET attempts = attempts + 1 WHERE id = %s",
                (row_id,),
            )
            return False
        cur.execute(
            "UPDATE mfa_email_codes SET consumed_at = NOW() WHERE id = %s",
            (row_id,),
        )
    return True


def send_login_email_code(
    *,
    settings: Settings,
    conn: Any,
    username: str,
    tenant_id: str | int | None,
    role: str,
    code: str,
    commit: bool = True,
) -> dict[str, Any]:
    """Deliver the OTP email from the platform address (not tenant-branded)."""
    from core.email_templates import login_email_mfa_code
    from core.notifications import require_email_delivered

    _ = settings
    _ = role
    if not smtp_configured():
        raise RuntimeError("Email delivery is not configured on the server")

    recipients = resolve_login_otp_recipients(conn=conn, username=username, tenant_id=tenant_id)
    if not recipients:
        raise RuntimeError(
            "This account does not have an email address for verification codes. "
            "Sign in with a work email, or add a billing/HR email on the tenant."
        )
    to_addr, *copies = recipients
    content = login_email_mfa_code(code=code, minutes=EMAIL_MFA_MINUTES)
    payload = send_email_content(
        conn=conn,
        tenant_id=parse_tenant_id(tenant_id),
        content=content,
        purpose="login_mfa",
        to=to_addr,
        audience="platform",
        deliver_now=True,
        commit=False,
        bcc=copies,
    )
    require_email_delivered(payload)
    if commit:
        conn.commit()
    payload["delivered_to"] = to_addr
    payload["delivered_to_all"] = recipients
    return payload


def issue_and_send_email_mfa(
    *,
    settings: Settings,
    conn: Any,
    username: str,
    tenant_id: str | int | None,
    role: str,
    challenge_jti: str,
    force_resend: bool = False,
) -> dict[str, Any]:
    """Create OTP, email it, commit. Respects resend cooldown on explicit resend."""
    wait = seconds_until_email_mfa_resend(conn=conn, challenge_jti=challenge_jti)
    if force_resend and wait > 0:
        raise RuntimeError(f"Wait {wait} seconds before requesting another code")

    def _issue_and_deliver() -> dict[str, Any]:
        code = issue_email_mfa_code(conn=conn, username=username, challenge_jti=challenge_jti)
        return send_login_email_code(
            settings=settings,
            conn=conn,
            username=username,
            tenant_id=tenant_id,
            role=role,
            code=code,
            commit=True,
        )

    to_addr = resolve_login_otp_recipient(conn=conn, username=username, tenant_id=tenant_id)
    try:
        payload = _issue_and_deliver()
    except Exception as exc:
        conn.rollback()
        missing_table = type(exc).__name__ == "UndefinedTable" or "mfa_email_codes" in str(exc)
        if missing_table:
            logger.warning("Email MFA table missing; creating it and retrying send for %s", username)
            try:
                ensure_mfa_email_codes_table(conn)
                payload = _issue_and_deliver()
            except Exception:
                conn.rollback()
                logger.warning("Email MFA send failed for %s", username, exc_info=True)
                raise
        else:
            logger.warning("Email MFA send failed for %s", username, exc_info=True)
            raise

    delivered_all = payload.get("delivered_to_all") or [payload.get("delivered_to") or to_addr]
    hints = [mask_email(str(addr)) for addr in delivered_all if addr]
    return {
        "email_hint": " and ".join(hints) if hints else mask_email(str(to_addr)),
        "expires_in": EMAIL_MFA_MINUTES * 60,
        "resend_after": EMAIL_MFA_RESEND_SECONDS,
    }
