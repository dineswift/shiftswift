"""Backend module registry — used by /setup/modules and client documentation."""

from __future__ import annotations

MODULES: list[dict[str, object]] = [
    {
        "id": "auth",
        "name": "Authentication",
        "prefix": "/auth",
        "description": "JWT login, refresh, and tenant verification.",
        "setup": ["JWT_SECRET", "DATABASE_URL"],
    },
    {
        "id": "employees",
        "name": "Core Employees",
        "prefix": "/admin/employees",
        "description": "Single source of truth for workforce records; syncs sponsor profiles.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "compliance",
        "name": "Home Office Compliance",
        "prefix": "/compliance/sponsor-licence",
        "description": "RTW evidence, absence alerts, SMS reporting, advert records, audit export.",
        "setup": ["DATABASE_URL", "RTW_STORAGE_DIR", "UK_RTW_CHECKLIST_URL"],
    },
    {
        "id": "grievance",
        "name": "Grievance Case Management",
        "prefix": "/grievance",
        "description": "Encrypted case notes, ACAS milestones, disciplinary RBAC.",
        "setup": ["DATABASE_URL", "ENCRYPTION_KEY"],
    },
    {
        "id": "disciplinary",
        "name": "Disciplinary Case Management",
        "prefix": "/disciplinary",
        "description": "Encrypted investigation notes, hearing outcomes, audit trail.",
        "setup": ["DATABASE_URL", "ENCRYPTION_KEY"],
    },
    {
        "id": "offboarding",
        "name": "Offboarding & Leavers",
        "prefix": "/offboarding",
        "description": "ACAS appeal windows and sponsorship cessation workflows.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "events",
        "name": "Domain Events & Webhooks",
        "prefix": "/events",
        "description": "Cross-module triggers (suspension → compliance, grievance → offboarding).",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "billing",
        "name": "B2B Billing",
        "prefix": "/billing",
        "description": "Stripe subscriptions, plans, promo codes.",
        "setup": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    },
    {
        "id": "contracts",
        "name": "Legal Contracts",
        "prefix": "/contracts",
        "description": "MSA, DPA, subscription order generation and e-sign.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "hr_templates",
        "name": "HR Process Templates",
        "prefix": "/hr-templates",
        "description": "Onboarding and HR process templates — tenant edit and download.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "ai",
        "name": "AI Document Assistant",
        "prefix": "/ai",
        "description": "Gemini Flash (default) or OpenAI — draft and refine HR documents when enabled.",
        "setup": ["AI_ENABLED", "GEMINI_API_KEY"],
    },
    {
        "id": "admin",
        "name": "Admin Workspace",
        "prefix": "/admin",
        "description": "Tenant profile, documents, promotions metadata.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "time_punch",
        "name": "Geofenced Time Punch",
        "prefix": "/time-punch",
        "description": "Clock in/out at assigned work sites with GPS geofence validation.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "rota",
        "name": "Weekly Rota Builder",
        "prefix": "/admin/rota",
        "description": "Plan shifts by week with overlap validation and publish workflow.",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "crm",
        "name": "Sales CRM Add-on",
        "prefix": "/admin/crm",
        "description": "Optional prospect/customer pipeline — accounts, contacts, deals (Master-gated).",
        "setup": ["DATABASE_URL"],
    },
    {
        "id": "master",
        "name": "Platform Master Admin",
        "prefix": "/master",
        "description": "Tenant register, MRR overview, and platform audit trail for Datasoftware Analytics Ltd.",
        "setup": ["DATABASE_URL", "MASTER_CUSTOMER_ID"],
    },
]


def module_catalog() -> dict[str, object]:
    return {"modules": MODULES, "count": len(MODULES)}
