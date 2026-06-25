"""Two-factor authentication and portal-separated login."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import pyotp

from auth_mfa import (
    create_mfa_challenge_token,
    create_mfa_enrollment_token,
    decode_mfa_challenge_token,
    decode_mfa_enrollment_token,
    hash_device_token,
    portal_allows_user,
    verify_totp_code,
)
from auth_service import authenticate_user
from config import Settings
from dev_credentials import (
    MASTER_PASSWORD,
    MASTER_USERNAME,
    TENANT_EMPLOYEE_PASSWORD,
    TENANT_EMPLOYEE_USERNAME,
    TENANT_HR_PASSWORD,
    TENANT_HR_USERNAME,
)


def _dev_settings() -> Settings:
    return Settings(
        app_env="development",
        jwt_secret="dev-secret-key-long-enough-for-tests-12345",
        jwt_access_minutes=60,
        jwt_refresh_days=7,
        master_customer_id="999",
        cors_allow_origins=["http://localhost:5173"],
        trusted_hosts=["localhost"],
        force_https=False,
        login_rate_limit=10,
        login_rate_window_seconds=900,
        max_upload_bytes=10485760,
        database_url=None,
        use_db=False,
    )


def test_totp_verify_round_trip() -> None:
    secret = pyotp.random_base32()
    code = pyotp.TOTP(secret).now()
    assert verify_totp_code(secret=secret, code=code)
    assert not verify_totp_code(secret=secret, code="000000")


def test_device_token_hash_is_stable() -> None:
    assert hash_device_token("abc") == hash_device_token("abc")
    assert hash_device_token("abc") != hash_device_token("xyz")


def test_mfa_challenge_token_round_trip() -> None:
    settings = _dev_settings()
    token = create_mfa_challenge_token(
        settings,
        username=TENANT_HR_USERNAME,
        role="hr",
        tenant_id="1",
        portal="business",
    )
    payload = decode_mfa_challenge_token(settings, token)
    assert payload["sub"] == TENANT_HR_USERNAME
    assert payload["portal"] == "business"
    assert payload["tenant_id"] == "1"


def test_mfa_enrollment_token_round_trip() -> None:
    settings = _dev_settings()
    token = create_mfa_enrollment_token(
        settings,
        username=MASTER_USERNAME,
        role="admin",
        tenant_id="999",
        portal="master",
    )
    payload = decode_mfa_enrollment_token(settings, token)
    assert payload["sub"] == MASTER_USERNAME
    assert payload["portal"] == "master"
    assert payload["role"] == "admin"
    assert payload["tenant_id"] == "999"
    assert payload["type"] == "mfa_enrollment"


def test_business_mfa_enrollment_token_round_trip() -> None:
    settings = _dev_settings()
    token = create_mfa_enrollment_token(
        settings,
        username=TENANT_HR_USERNAME,
        role="hr",
        tenant_id="1",
        portal="business",
    )
    payload = decode_mfa_enrollment_token(settings, token)
    assert payload["sub"] == TENANT_HR_USERNAME
    assert payload["portal"] == "business"
    assert payload["role"] == "hr"
    assert payload["tenant_id"] == "1"


def test_auth_policy_defaults() -> None:
    from auth_policy import business_require_mfa_hr, employee_require_mfa

    dev = _dev_settings()
    assert not business_require_mfa_hr(dev)
    assert not employee_require_mfa(dev)

    prod = Settings(
        app_env="production",
        jwt_secret="prod-secret-key-long-enough-for-tests-12345",
        jwt_access_minutes=60,
        jwt_refresh_days=7,
        master_customer_id="999",
        cors_allow_origins=["https://app.shiftswifthr.co.uk"],
        trusted_hosts=["api.shiftswifthr.co.uk"],
        force_https=True,
        login_rate_limit=10,
        login_rate_window_seconds=900,
        max_upload_bytes=10485760,
        database_url=None,
        use_db=False,
    )
    assert business_require_mfa_hr(prod)
    assert not employee_require_mfa(prod)


def test_portal_allows_user() -> None:
    assert portal_allows_user(portal="master", role="admin", login_portal="master")
    assert not portal_allows_user(portal="master", role="hr", login_portal="business")
    assert portal_allows_user(portal="business", role="hr", login_portal="business")
    assert not portal_allows_user(portal="business", role="admin", login_portal="master")


def test_dev_login_portal_separation() -> None:
    settings = _dev_settings()

    business_user = authenticate_user(
        settings,
        TENANT_HR_USERNAME,
        TENANT_HR_PASSWORD,
        portal="business",
    )
    assert business_user is not None
    assert business_user.role == "hr"

    assert authenticate_user(
        settings,
        TENANT_HR_USERNAME,
        TENANT_HR_PASSWORD,
        portal="master",
    ) is None

    master_user = authenticate_user(
        settings,
        MASTER_USERNAME,
        MASTER_PASSWORD,
        portal="master",
    )
    assert master_user is not None
    assert master_user.role == "admin"

    assert authenticate_user(
        settings,
        MASTER_USERNAME,
        MASTER_PASSWORD,
        portal="business",
    ) is None


def test_dev_business_and_employee_login_types() -> None:
    settings = _dev_settings()

    hr_user = authenticate_user(
        settings,
        TENANT_HR_USERNAME,
        TENANT_HR_PASSWORD,
        portal="business",
        require_role="hr",
    )
    assert hr_user is not None
    assert hr_user.role == "hr"

    assert authenticate_user(
        settings,
        TENANT_HR_USERNAME,
        TENANT_HR_PASSWORD,
        portal="business",
        require_role="employee",
    ) is None

    employee_user = authenticate_user(
        settings,
        TENANT_EMPLOYEE_USERNAME,
        TENANT_EMPLOYEE_PASSWORD,
        portal="business",
        require_role="employee",
    )
    assert employee_user is not None
    assert employee_user.role == "employee"

    assert authenticate_user(
        settings,
        TENANT_EMPLOYEE_USERNAME,
        TENANT_EMPLOYEE_PASSWORD,
        portal="business",
        require_role="hr",
    ) is None


def test_employee_login_without_business_id() -> None:
    settings = _dev_settings()
    user = authenticate_user(
        settings,
        TENANT_EMPLOYEE_USERNAME,
        TENANT_EMPLOYEE_PASSWORD,
        portal="business",
        require_role="employee",
    )
    assert user is not None
    assert user.tenant_id == "1"
