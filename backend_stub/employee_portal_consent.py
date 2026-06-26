"""Employee portal GDPR consent — employer is data controller."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from auth_service import fetch_user_from_db
from config import Settings

EMPLOYEE_GDPR_CONSENT_VERSION = "2026-06-10"


def tenant_display_name(*, tenant_id: int, conn: Any) -> str:
    from admin_service import get_tenant_profile

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    return str(profile.get("trading_name") or profile.get("name") or "Your employer")


def username_display_fallback(username: str) -> str:
    """Best-effort friendly label when HR has not set employee name yet."""
    local = (username.split("@", 1)[0] if "@" in username else username).strip()
    if not local:
        return "Employee"
    cleaned = re.sub(r"\d+$", "", local).strip() or local
    return cleaned[:1].upper() + cleaned[1:]


def _name_from_employee_record(employee: dict[str, Any]) -> tuple[str, str] | None:
    first = str(employee.get("first_name") or "").strip()
    last = str(employee.get("last_name") or "").strip()
    full = f"{first} {last}".strip()
    if full:
        return full, first or full.split()[0]
    if first:
        return first, first
    return None


def employee_display_name(*, tenant_id: int, username: str, conn: Any) -> tuple[str, str]:
    """Return (display_name, first_name) for the signed-in employee."""
    from modules.time_punch.service import resolve_employee

    employee = resolve_employee(tenant_id=tenant_id, username=username, conn=conn)
    if not employee:
        fallback = username_display_fallback(username)
        return fallback, fallback.split()[0] if fallback else "there"

    named = _name_from_employee_record(employee)
    if named:
        return named
    fallback = username_display_fallback(username)
    return fallback, fallback.split()[0] if fallback else "there"


def hr_display_name(*, tenant_id: int, username: str, conn: Any) -> tuple[str, str]:
    """Return (display_name, first_name) for HR/admin portal users."""
    from admin_service import get_tenant_profile
    from modules.time_punch.service import resolve_employee

    employee = resolve_employee(tenant_id=tenant_id, username=username, conn=conn)
    if employee:
        named = _name_from_employee_record(employee)
        if named:
            return named

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    signatory_name = str(profile.get("signatory_name") or "").strip()
    user_lower = username.strip().lower()
    contact_emails = {
        str(profile.get("signatory_email") or "").strip().lower(),
        str(profile.get("billing_email") or "").strip().lower(),
    } - {""}
    if signatory_name and user_lower in contact_emails:
        parts = signatory_name.split()
        return signatory_name, parts[0] if parts else signatory_name

    fallback = username_display_fallback(username)
    return fallback, fallback.split()[0] if fallback else "there"


def has_employee_gdpr_consent(*, tenant_id: int, username: str, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM employee_portal_gdpr_consents
            WHERE tenant_id = %s AND lower(username) = lower(%s)
            LIMIT 1
            """,
            (tenant_id, username),
        )
        return cur.fetchone() is not None


def record_employee_gdpr_consent(
    *,
    tenant_id: int,
    username: str,
    employer_name: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO employee_portal_gdpr_consents (
              tenant_id, username, consent_version, employer_name, ip_address, user_agent
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, username) DO NOTHING
            """,
            (
                tenant_id,
                username.strip(),
                EMPLOYEE_GDPR_CONSENT_VERSION,
                employer_name,
                ip_address,
                user_agent,
            ),
        )


def validate_employee_gdpr_acceptance(*, accept_employee_gdpr: bool) -> None:
    if not accept_employee_gdpr:
        raise ValueError(
            "Please confirm you understand your employer manages your personal data "
            "and agree to the privacy notice before continuing."
        )


def get_password_reset_context(
    *,
    settings: Settings,
    conn: Any,
    raw_token: str,
) -> dict[str, object]:
    from auth_password_reset import _hash_token

    token_hash = _hash_token(raw_token.strip())
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT username
            FROM password_reset_tokens
            WHERE token_hash = %s
              AND used_at IS NULL
              AND expires_at > %s
            LIMIT 1
            """,
            (token_hash, now),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("This reset link is invalid or has expired. Request a new one.")
        username = row[0]

    user = fetch_user_from_db(settings, username)
    if not user or not user.get("is_active"):
        raise LookupError("This reset link is invalid or has expired. Request a new one.")

    tenant_id = int(user["tenant_id"])
    role = str(user.get("role") or "")
    requires_gdpr_consent = False
    employer_name = ""
    if role == "employee":
        employer_name = tenant_display_name(tenant_id=tenant_id, conn=conn)
        requires_gdpr_consent = not has_employee_gdpr_consent(
            tenant_id=tenant_id,
            username=username,
            conn=conn,
        )

    return {
        "role": role,
        "employer_name": employer_name,
        "requires_gdpr_consent": requires_gdpr_consent,
        "privacy_policy_url": "/privacy-policy.html",
    }
