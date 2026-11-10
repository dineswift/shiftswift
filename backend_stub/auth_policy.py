"""Authentication policy — MFA requirements per portal."""

from __future__ import annotations

import os
import re
from typing import Any

from config import Settings

APPLE_REVIEW_EMAIL = "apple-review@shiftswifthr.co.uk"
_DEMO_WORD = re.compile(r"(^|[^a-z0-9])demo([^a-z0-9]|$)")


def _env_flag(name: str, *, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def business_require_mfa_hr(settings: Settings) -> bool:
    """Require HR admins to enroll in TOTP at sign-in — off unless BUSINESS_REQUIRE_MFA=1."""
    return _env_flag("BUSINESS_REQUIRE_MFA", default=False)


def employee_require_mfa(settings: Settings) -> bool:
    """Require employee portal accounts to use TOTP — off by default."""
    return _env_flag("EMPLOYEE_REQUIRE_MFA", default=False)


def login_require_email_mfa(settings: Settings) -> bool:
    """After password, require email OTP by default (authenticator/passkey remain alternatives)."""
    _ = settings
    return _env_flag("LOGIN_REQUIRE_EMAIL_MFA", default=True)


def looks_like_demo_or_review(*, name: str = "", billing_email: str = "", username: str = "") -> bool:
    """Apple review and demo businesses start without a sign-in code."""
    email = (billing_email or "").strip().lower()
    user = (username or "").strip().lower()
    if email == APPLE_REVIEW_EMAIL or user == APPLE_REVIEW_EMAIL:
        return True
    return bool(_DEMO_WORD.search((name or "").lower()) or _DEMO_WORD.search(email) or _DEMO_WORD.search(user))


def tenant_login_mfa_required(conn: Any, tenant_id: int) -> bool:
    """True unless master has turned the sign-in code off for this business. Missing column stays on."""
    from core.schema import table_columns

    if "login_mfa_required" not in table_columns(conn, "tenants"):
        return True
    with conn.cursor() as cur:
        cur.execute("SELECT login_mfa_required FROM tenants WHERE id = %s", (int(tenant_id),))
        row = cur.fetchone()
    if not row or row[0] is None:
        return True
    return bool(row[0])


def account_skips_login_mfa(*, username: str, tenant_id: int | str | None, conn: Any) -> bool:
    """Password-only sign-in for Apple review, and for a business master has exempted."""
    if (username or "").strip().lower() == APPLE_REVIEW_EMAIL:
        return True
    if tenant_id is None or str(tenant_id).strip() == "":
        return False
    return not tenant_login_mfa_required(conn, int(tenant_id))


def ensure_login_mfa_default(conn: Any, tenant_id: int, *, name: str, billing_email: str) -> None:
    """New demo and Apple review businesses are saved with the sign-in code off."""
    from core.schema import table_columns

    if "login_mfa_required" not in table_columns(conn, "tenants"):
        return
    if not looks_like_demo_or_review(name=name, billing_email=billing_email):
        return
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE tenants SET login_mfa_required = FALSE WHERE id = %s",
            (int(tenant_id),),
        )


def portal_uses_email_mfa(settings: Settings, portal: str) -> bool:
    """Master sign-in never emails a code. The master address may not be a mailbox anyone can open."""
    if portal == "master":
        return False
    return login_require_email_mfa(settings)
