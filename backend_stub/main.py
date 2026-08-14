"""ShiftSwift HR local API server — modular router registration."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from admin_routes import router as admin_router
from auth_routes import router as auth_router
from billing_routes import router as billing_router
from compliance_routes import router as compliance_router
from contracts_routes import router as contracts_router
from core.crypto import encryption_configured
from modules.events.routes import router as events_router
from modules.grievance.routes import router as grievance_router
from modules.disciplinary.routes import router as disciplinary_router
from modules.offboarding.routes import router as offboarding_router
from modules.ai.routes import router as ai_router
from modules.employee_portal.routes import router as employee_portal_router
from modules.document_signing.routes import router as document_signing_router
from modules.employee_contracts.routes import router as employment_contracts_router
from modules.hr_templates.routes import router as hr_templates_router
from modules.global_documents.routes import router as global_documents_router
from modules.employees.routes import router as employees_router
from modules.workspace.routes import router as workspace_router
from modules.recruitment.routes import router as recruitment_router
from modules.crm.routes import router as crm_router
from modules.time_punch.epos_routes import router as epos_integration_router
from modules.time_punch.routes import admin_router as time_punch_admin_router
from modules.time_punch.routes import employee_router as time_punch_router
from modules.time_punch.routes import kiosk_router as time_punch_kiosk_router
from modules.rota.routes import admin_router as rota_admin_router
from modules.rota.routes import employee_router as rota_employee_router
from modules.leave.routes import admin_router as leave_admin_router
from modules.leave.routes import employee_router as leave_employee_router
from modules.employees.profile_change_routes import admin_router as profile_change_admin_router
from modules.employees.profile_change_routes import employee_router as profile_change_employee_router
from modules.push.routes import router as push_router
from modules.push.admin_routes import router as admin_push_router
from modules.master.routes import router as master_router
from modules.registry import module_catalog
from signup_routes import router as signup_router
from config import load_settings
from brand import brand_payload
from security_middleware import SecurityHeadersMiddleware
from web_pages import register_web_pages

settings = load_settings()

app = FastAPI(
    title="ShiftSwift HR API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(SecurityHeadersMiddleware, settings=settings)
if settings.is_production:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
cors_kwargs: dict[str, object] = {
    "allow_credentials": True,
    "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allow_headers": ["Authorization", "Content-Type", "X-Tenant-Id", "X-User-Id"],
}
if settings.is_development:
    cors_kwargs["allow_origin_regex"] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
else:
    cors_kwargs["allow_origins"] = settings.cors_allow_origins
app.add_middleware(CORSMiddleware, **cors_kwargs)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "ShiftSwift HR", "environment": settings.app_env}


@app.get("/setup/brand")
def setup_brand() -> dict[str, object]:
    return brand_payload(app_env=settings.app_env)


@app.get("/setup/status")
def setup_status() -> dict[str, object]:
    from core.notifications import smtp_config_summary

    db_ok = bool(os.getenv("DATABASE_URL"))
    smtp = smtp_config_summary()
    return {
        "complete": db_ok,
        "enabled": db_ok,
        "app_env": settings.app_env,
        "message": "Local install ready" if db_ok else "Configure DATABASE_URL",
        "modules_ready": {
            "database": db_ok,
            "encryption": encryption_configured(),
            "stripe": bool(os.getenv("STRIPE_SECRET_KEY")),
            "smtp": smtp["configured"],
            "rtw_storage": bool(os.getenv("RTW_STORAGE_DIR", "uploads/rtw_immutable")),
            "ai_assistant": bool(os.getenv("AI_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}),
        },
        "smtp": smtp,
        "security": {
            "jwt_auth": True,
            "bcrypt_passwords": True,
            "rate_limited_login": True,
            "security_headers": True,
            "totp_2fa": True,
            "separate_master_business_login": True,
        },
    }


@app.get("/setup/modules")
def setup_modules() -> dict[str, object]:
    return module_catalog()


register_web_pages(app, settings)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(compliance_router)
app.include_router(grievance_router)
app.include_router(disciplinary_router)
app.include_router(offboarding_router)
app.include_router(ai_router)
app.include_router(hr_templates_router)
app.include_router(global_documents_router)
app.include_router(employment_contracts_router)
app.include_router(document_signing_router)
app.include_router(events_router)
app.include_router(billing_router)
app.include_router(signup_router)
app.include_router(contracts_router)
app.include_router(time_punch_router)
app.include_router(time_punch_kiosk_router)
app.include_router(epos_integration_router)
app.include_router(employee_portal_router)
app.include_router(employees_router)
app.include_router(workspace_router)
app.include_router(recruitment_router)
app.include_router(crm_router)
app.include_router(time_punch_admin_router)
app.include_router(rota_admin_router)
app.include_router(rota_employee_router)
app.include_router(leave_admin_router)
app.include_router(leave_employee_router)
app.include_router(profile_change_admin_router)
app.include_router(profile_change_employee_router)
app.include_router(push_router)
app.include_router(admin_push_router)
app.include_router(master_router)
