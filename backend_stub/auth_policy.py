"""Authentication policy — MFA requirements per portal."""

from __future__ import annotations

import os

from config import Settings


def _env_flag(name: str, *, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def business_require_mfa_hr(settings: Settings) -> bool:
    """Require HR admins to enroll in TOTP — fallback when email OTP cannot be sent."""
    return _env_flag("BUSINESS_REQUIRE_MFA", default=settings.is_production)


def employee_require_mfa(settings: Settings) -> bool:
    """Require employee portal accounts to use TOTP — off by default."""
    return _env_flag("EMPLOYEE_REQUIRE_MFA", default=False)


def login_require_email_mfa(settings: Settings) -> bool:
    """After password, email a 6-digit code by default (authenticator remains an alternative)."""
    _ = settings
    return _env_flag("LOGIN_REQUIRE_EMAIL_MFA", default=True)
