"""Branded HTML surfaces on the API server — same minimal ShiftSwift design as the frontend."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from config import Settings

BACKEND_ROOT = Path(__file__).resolve().parent
STATIC_DIR = BACKEND_ROOT / "static"
FRONTEND_DIR = BACKEND_ROOT.parent / "frontend"


def register_web_pages(app: FastAPI, settings: Settings) -> None:
    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    if FRONTEND_DIR.is_dir():
        app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

    @app.get("/", include_in_schema=False)
    def api_home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/login", include_in_schema=False)
    def login_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app/login.html", status_code=307)

    @app.get("/employee-login", include_in_schema=False)
    def employee_login_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app/employee-login.html", status_code=307)

    @app.get("/business-login", include_in_schema=False)
    def business_login_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app/business-login.html", status_code=307)

    @app.get("/tenant-login", include_in_schema=False)
    def tenant_login_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app/business-login.html", status_code=307)

    @app.get("/master-login", include_in_schema=False)
    def master_login_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app/business-login.html", status_code=307)

    @app.get("/ops-9x7k2", include_in_schema=False)
    def ops_master_login_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app/ops-9x7k2.html", status_code=307)

    if not settings.is_production:
        register_branded_openapi(app)


def register_branded_openapi(app: FastAPI) -> None:
    openapi_url = app.openapi_url or "/openapi.json"
    title = f"{app.title} — API reference"

    @app.get("/docs", include_in_schema=False)
    def swagger_ui() -> HTMLResponse:
        return HTMLResponse(
            _swagger_html(openapi_url=openapi_url, title=title),
            media_type="text/html",
        )

    @app.get("/redoc", include_in_schema=False)
    def redoc_ui() -> HTMLResponse:
        return HTMLResponse(
            _redoc_html(openapi_url=openapi_url, title=title),
            media_type="text/html",
        )


def _swagger_html(*, openapi_url: str, title: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <link rel="icon" type="image/svg+xml" href="/static/assets/shiftswift-hr-icon.svg" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="stylesheet" href="/static/swagger.css" />
</head>
<body>
  <header class="api-doc-bar">
    <a class="api-doc-brand" href="/">
      <img src="/static/assets/shiftswift-hr-logo-nav.svg" alt="ShiftSwift HR" />
    </a>
    <nav class="api-doc-nav">
      <a href="/">API home</a>
      <a href="/app/business-login.html">Sign in</a>
      <a href="/redoc">ReDoc</a>
    </nav>
  </header>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({{
      url: "{openapi_url}",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
    }});
  </script>
</body>
</html>"""


def _redoc_html(*, openapi_url: str, title: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <link rel="icon" type="image/svg+xml" href="/static/assets/shiftswift-hr-icon.svg" />
  <link rel="stylesheet" href="/static/theme.css" />
  <link rel="stylesheet" href="/static/api-surface.css" />
  <style>
    body {{ margin: 0; background: var(--page-bg); }}
    redoc {{ display: block; }}
  </style>
</head>
<body>
  <header class="api-doc-bar">
    <a class="api-doc-brand" href="/">
      <img src="/static/assets/shiftswift-hr-logo-nav.svg" alt="ShiftSwift HR" />
    </a>
    <nav class="api-doc-nav">
      <a href="/">API home</a>
      <a href="/docs">Swagger</a>
      <a href="/app/business-login.html">Sign in</a>
    </nav>
  </header>
  <redoc spec-url="{openapi_url}"></redoc>
  <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
</body>
</html>"""
