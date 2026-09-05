"""Security controls for Cyber Essentials readiness."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from auth_service import authenticate_user, create_token_pair, decode_token, hash_password, verify_password
from config import Settings, validate_settings
from dev_credentials import TENANT_HR_PASSWORD, TENANT_HR_USERNAME


def test_bcrypt_hash_and_verify() -> None:
    hashed = hash_password("TestPassword123!")
    assert hashed.startswith("$2")
    assert verify_password("TestPassword123!", hashed)
    assert not verify_password("wrong", hashed)


def test_jwt_round_trip() -> None:
    settings = Settings(
        app_env="development",
        jwt_secret="test-secret-key-with-enough-length-123456",
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
    from auth_service import AuthUser

    user = AuthUser(username=TENANT_HR_USERNAME, role="hr", tenant_id="1")
    tokens = create_token_pair(settings, user)
    decoded = decode_token(settings, tokens.access_token, expected_type="access")
    assert decoded.username == TENANT_HR_USERNAME
    assert decoded.tenant_id == "1"


def test_production_rejects_weak_secret() -> None:
    settings = Settings(
        app_env="production",
        jwt_secret="local-dev-jwt-secret-change-in-production",
        jwt_access_minutes=60,
        jwt_refresh_days=7,
        master_customer_id="999",
        cors_allow_origins=["https://app.example.com"],
        trusted_hosts=["app.example.com"],
        force_https=True,
        login_rate_limit=10,
        login_rate_window_seconds=900,
        max_upload_bytes=10485760,
        database_url="postgresql://localhost/test",
        use_db=True,
    )
    try:
        validate_settings(settings)
        raised = False
    except RuntimeError:
        raised = True
    assert raised


def test_dev_fallback_auth() -> None:
    settings = Settings(
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
    user = authenticate_user(settings, TENANT_HR_USERNAME, TENANT_HR_PASSWORD)
    assert user is not None
    assert user.username == TENANT_HR_USERNAME
    assert user.role == "hr"


def test_log_security_event_does_not_raise_when_db_unavailable() -> None:
    from auth_service import log_security_event

    settings = Settings(
        app_env="development",
        jwt_secret="test-secret-key-with-enough-length-123456",
        jwt_access_minutes=60,
        jwt_refresh_days=7,
        master_customer_id="999",
        cors_allow_origins=["http://localhost:5173"],
        trusted_hosts=["localhost"],
        force_https=False,
        login_rate_limit=10,
        login_rate_window_seconds=900,
        max_upload_bytes=10485760,
        database_url="postgresql://invalid:invalid@127.0.0.1:1/none",
        use_db=True,
    )
    log_security_event(
        settings,
        event_type="mfa_verify_failed",
        username="admin@shiftswifthr.co.uk",
        tenant_id="999",
        ip_address="127.0.0.1",
        user_agent="test",
        success=False,
        detail="method=totp",
    )
