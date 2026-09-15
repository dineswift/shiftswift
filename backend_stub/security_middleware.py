"""HTTP security headers and HTTPS enforcement."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from config import Settings

# systemd / wait-api-health.sh curl http://127.0.0.1:8000/health without -L.
# FORCE_HTTPS must not 307 those loopback probes. Public Host headers still redirect.
LOCAL_PLAINHTTP_PATHS = frozenset({"/health", "/setup/status"})
LOOPBACK_HOSTNAMES = frozenset({"127.0.0.1", "localhost", "::1"})


def request_hostname(request: Request) -> str:
    host = (request.url.hostname or "").strip().lower()
    if host:
        return host
    raw = (request.headers.get("host") or "").strip().lower()
    if raw.startswith("["):
        end = raw.find("]")
        if end != -1:
            return raw[1:end]
    return raw.split(":", 1)[0]


def skip_https_redirect(request: Request) -> bool:
    path = request.url.path.rstrip("/") or "/"
    if path not in LOCAL_PLAINHTTP_PATHS:
        return False
    return request_hostname(request) in LOOPBACK_HOSTNAMES


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings):
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next) -> Response:
        if (
            self.settings.force_https
            and request.url.scheme == "http"
            and not skip_https_redirect(request)
        ):
            target = request.url.replace(scheme="https")
            return RedirectResponse(str(target), status_code=307)

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        response.headers["X-XSS-Protection"] = "0"
        if self.settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
