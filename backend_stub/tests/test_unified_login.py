"""Unified sign-in — resolve portal + single login endpoint."""

from __future__ import annotations

from dev_credentials import (
    MASTER_USERNAME,
    TENANT_EMPLOYEE_USERNAME,
    TENANT_HR_USERNAME,
)
from auth_service import resolve_login_portal, resolve_unified_authentication
from tests.test_auth_mfa import _dev_settings


def test_resolve_login_portal_dev_users() -> None:
    settings = _dev_settings()

    hr = resolve_login_portal(settings, TENANT_HR_USERNAME)
    assert hr["portal"] == "hr"
    assert hr["endpoint"] == "/auth/business-login"

    employee = resolve_login_portal(settings, TENANT_EMPLOYEE_USERNAME)
    assert employee["portal"] == "employee"
    assert employee["endpoint"] == "/auth/employee-login"

    master = resolve_login_portal(settings, MASTER_USERNAME)
    assert master["portal"] == "master"
    assert master["endpoint"] == "/auth/master-login"
    assert master["redirect_path"] == "master.html"

    unknown = resolve_login_portal(settings, "nobody@example.com")
    assert unknown["portal"] == "unknown"
    assert unknown["endpoint"] == "/auth/unified-login"


def test_resolve_unified_authentication_dev_users() -> None:
    from dev_credentials import TENANT_EMPLOYEE_PASSWORD, TENANT_HR_PASSWORD

    settings = _dev_settings()

    user, role, error = resolve_unified_authentication(
        settings,
        TENANT_HR_USERNAME,
        TENANT_HR_PASSWORD,
    )
    assert error is None
    assert user is not None
    assert user.role == "hr"
    assert role == "hr"

    user, role, error = resolve_unified_authentication(
        settings,
        TENANT_EMPLOYEE_USERNAME,
        TENANT_EMPLOYEE_PASSWORD,
    )
    assert error is None
    assert user is not None
    assert user.role == "employee"
    assert role == "employee"

    user, role, error = resolve_unified_authentication(
        settings,
        TENANT_HR_USERNAME,
        "wrong-password",
    )
    assert user is None
    assert role is None
    assert error == "Invalid username or password"
