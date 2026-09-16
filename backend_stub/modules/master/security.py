"""Master admin access controls — IP allowlist and MFA policy."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request

if TYPE_CHECKING:
    from config import Settings

from deps import client_ip


def master_ip_allowlist(settings: Settings) -> frozenset[str]:
    raw = os.getenv("MASTER_IP_ALLOWLIST", "").strip()
    if not raw:
        return frozenset()
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def master_require_mfa(settings: Settings) -> bool:
    """Require master admin TOTP at sign-in — off unless MASTER_REQUIRE_MFA=1."""
    return os.getenv("MASTER_REQUIRE_MFA", "").strip().lower() in {"1", "true", "yes", "on"}


def assert_master_ip(request: Request, settings: Settings) -> None:
    allowed = master_ip_allowlist(settings)
    if not allowed:
        return
    ip = client_ip(request)
    if ip not in allowed:
        raise HTTPException(status_code=403, detail="Master console not available from this network")


def assert_master_tenant(user_tenant_id: str, settings: Settings) -> None:
    if str(user_tenant_id) != str(settings.master_customer_id):
        raise HTTPException(status_code=403, detail="Platform master access only")
