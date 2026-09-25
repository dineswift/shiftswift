"""Application configuration with production security checks."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# backend_stub/.env is the operator-edited source of truth (override CloudPanel empty vars)
_ci_e2e = os.getenv("CI_E2E", "").strip().lower() in {"1", "true", "yes", "on"}
load_dotenv(
    Path(__file__).resolve().parent / ".env",
    override=not _ci_e2e,
)
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_env: str
    jwt_secret: str
    jwt_access_minutes: int
    jwt_refresh_days: int
    master_customer_id: str
    cors_allow_origins: list[str]
    trusted_hosts: list[str]
    force_https: bool
    login_rate_limit: int
    login_rate_window_seconds: int
    max_upload_bytes: int
    database_url: str | None
    use_db: bool

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def is_development(self) -> bool:
        return not self.is_production


def load_settings() -> Settings:
    app_env = os.getenv("APP_ENV", "development")
    jwt_secret = os.getenv("JWT_SECRET", "")
    if not jwt_secret:
        jwt_secret = os.getenv("AUTH_TOKEN", "local-dev-jwt-secret-change-in-production")

    settings = Settings(
        app_env=app_env,
        jwt_secret=jwt_secret,
        jwt_access_minutes=int(os.getenv("JWT_ACCESS_MINUTES", "60")),
        jwt_refresh_days=int(os.getenv("JWT_REFRESH_DAYS", "7")),
        master_customer_id=os.getenv("MASTER_CUSTOMER_ID", "999"),
        cors_allow_origins=[
            origin.strip()
            for origin in os.getenv(
                "CORS_ALLOW_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        ],
        trusted_hosts=[
            host.strip()
            for host in os.getenv("TRUSTED_HOSTS", "localhost,127.0.0.1").split(",")
            if host.strip()
        ],
        force_https=_env_bool("FORCE_HTTPS", False),
        login_rate_limit=int(os.getenv("LOGIN_RATE_LIMIT", "10")),
        login_rate_window_seconds=int(os.getenv("LOGIN_RATE_WINDOW_SECONDS", "900")),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))),
        database_url=os.getenv("DATABASE_URL"),
        use_db=_env_bool("USE_DB", True),
    )
    validate_settings(settings)
    return settings


def validate_settings(settings: Settings) -> None:
    if not settings.is_production:
        return
    weak_secrets = {
        "",
        "local-dev-jwt-secret-change-in-production",
        "local-dev-token",
        "change-me",
    }
    if settings.jwt_secret in weak_secrets or len(settings.jwt_secret) < 32:
        raise RuntimeError(
            "JWT_SECRET must be at least 32 characters in production. "
            "Run: bash scripts/generate_secrets.sh"
        )
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required in production")
    if settings.force_https and not any(
        origin.startswith("https://") for origin in settings.cors_allow_origins
    ):
        raise RuntimeError("CORS_ALLOW_ORIGINS must use https:// when FORCE_HTTPS=1")


def generate_jwt_secret() -> str:
    return secrets.token_urlsafe(48)
