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


def _https_settings(**overrides) -> Settings:
    values = dict(
        app_env="production",
        jwt_secret="test-secret-key-with-enough-length-123456",
        jwt_access_minutes=60,
        jwt_refresh_days=7,
        master_customer_id="999",
        cors_allow_origins=["https://app.example.com"],
        trusted_hosts=["api.example.com", "localhost", "127.0.0.1"],
        force_https=True,
        login_rate_limit=10,
        login_rate_window_seconds=900,
        max_upload_bytes=10485760,
        database_url="postgresql://localhost/test",
        use_db=True,
    )
    values.update(overrides)
    return Settings(**values)


def _force_https_client(base_url: str):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from security_middleware import SecurityHeadersMiddleware

    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware, settings=_https_settings())

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/setup/status")
    def setup_status() -> dict[str, str]:
        return {"complete": "yes"}

    @app.get("/setup/brand")
    def setup_brand() -> dict[str, str]:
        return {"name": "ShiftSwift HR"}

    return TestClient(app, base_url=base_url)


def test_health_on_loopback_with_force_https_is_200_not_307() -> None:
    client = _force_https_client("http://127.0.0.1:8000")
    response = client.get("/health", follow_redirects=False)
    assert response.status_code == 200, response.headers.get("location")
    assert response.json()["status"] == "ok"


def test_setup_status_on_localhost_with_force_https_is_200() -> None:
    client = _force_https_client("http://localhost:8000")
    response = client.get("/setup/status", follow_redirects=False)
    assert response.status_code == 200, response.headers.get("location")


def test_health_on_public_host_with_force_https_still_307() -> None:
    client = _force_https_client("http://api.shiftswifthr.co.uk")
    response = client.get("/health", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers.get("location") or ""
    assert location.startswith("https://")
    assert "/health" in location


def test_other_loopback_paths_still_redirect_when_force_https() -> None:
    client = _force_https_client("http://127.0.0.1:8000")
    response = client.get("/setup/brand", follow_redirects=False)
    assert response.status_code == 307
    assert (response.headers.get("location") or "").startswith("https://")
