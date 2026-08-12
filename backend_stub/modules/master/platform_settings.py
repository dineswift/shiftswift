"""Read-only platform configuration snapshot for master admin console."""

from __future__ import annotations

import os
from typing import Any

from config import Settings
from core.notifications import smtp_config_summary
from auth_policy import business_require_mfa_hr, employee_require_mfa, login_require_email_mfa
from modules.master.security import master_ip_allowlist, master_require_mfa
from auth_passkeys import passkeys_enabled as passkeys_feature_enabled


def _mask_secret(value: str | None, *, visible: int = 4) -> dict[str, Any]:
    raw = (value or "").strip()
    if not raw:
        return {"configured": False, "preview": None, "length": 0}
    if len(raw) <= visible:
        return {"configured": True, "preview": "*" * len(raw), "length": len(raw)}
    return {"configured": True, "preview": f"{'*' * max(len(raw) - visible, 4)}{raw[-visible:]}", "length": len(raw)}


def platform_settings_snapshot(settings: Settings) -> dict[str, Any]:
    smtp = smtp_config_summary()
    allowlist = master_ip_allowlist(settings)
    return {
        "provider_name": os.getenv("PROVIDER_LEGAL_NAME", "Datasoftware Analytics Ltd"),
        "master_customer_id": settings.master_customer_id,
        "environment": "production" if settings.is_production else "development",
        "database_configured": bool(settings.database_url),
        "master_require_mfa": master_require_mfa(settings),
        "business_require_mfa": business_require_mfa_hr(settings),
        "employee_require_mfa": employee_require_mfa(settings),
        "login_require_email_mfa": login_require_email_mfa(settings),
        "passkeys_enabled": passkeys_feature_enabled(),
        "master_ip_allowlist": allowlist,
        "master_ip_allowlist_enabled": bool(allowlist),
        "master_impersonation_minutes": int(os.getenv("MASTER_IMPERSONATION_MINUTES", "30")),
        "billing_trial_days": int(os.getenv("BILLING_TRIAL_DAYS", "14")),
        "billing_dd_grace_days": int(os.getenv("BILLING_DD_GRACE_DAYS", "7")),
        "ai_enabled": os.getenv("AI_ENABLED", "true").lower() in {"1", "true", "yes"},
        "ai_provider": os.getenv("AI_PROVIDER", "gemini"),
        "smtp": {
            "configured": smtp.get("configured"),
            "host": smtp.get("host"),
            "port": smtp.get("port"),
            "from": smtp.get("from"),
            "user": smtp.get("user"),
        },
    }


def api_keys_snapshot() -> dict[str, Any]:
    return {
        "stripe": {
            "secret_key": _mask_secret(os.getenv("STRIPE_SECRET_KEY")),
            "webhook_secret": _mask_secret(os.getenv("STRIPE_WEBHOOK_SECRET")),
            "currency": os.getenv("STRIPE_CURRENCY", "gbp"),
            "tax_enabled": os.getenv("STRIPE_TAX_ENABLED", "false").lower() in {"1", "true", "yes"},
        },
        "ai": {
            "gemini_api_key": _mask_secret(os.getenv("GEMINI_API_KEY")),
            "gemini_model": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            "openai_api_key": _mask_secret(os.getenv("OPENAI_API_KEY")),
            "openai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        },
        "integrations": {
            "idsp_api_key": _mask_secret(os.getenv("IDSP_API_KEY")),
            "encryption_key": _mask_secret(os.getenv("ENCRYPTION_KEY")),
        },
        "note": "Keys are loaded from server environment (.env). Update on the VPS, then restart the API.",
    }


def list_master_audit_log(
    *,
    conn: Any,
    limit: int = 100,
    offset: int = 0,
    action: str | None = None,
    tenant_id: int | None = None,
) -> dict[str, Any]:
    clauses = ["1=1"]
    params: list[Any] = []
    if action:
        clauses.append("action = %s")
        params.append(action)
    if tenant_id:
        clauses.append("target_tenant_id = %s")
        params.append(tenant_id)
    where = " AND ".join(clauses)
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM master_audit_log WHERE {where}", params)
        total = int(cur.fetchone()[0])
        cur.execute(
            f"""
            SELECT id, master_username, action, target_tenant_id, ip_address, detail, created_at
            FROM master_audit_log
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            [*params, limit, offset],
        )
        rows = cur.fetchall()
    items = [
        {
            "id": row[0],
            "master_username": row[1],
            "action": row[2],
            "target_tenant_id": row[3],
            "ip_address": row[4],
            "detail": row[5] or {},
            "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
        }
        for row in rows
    ]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def list_email_log(*, conn: Any, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM notifications WHERE channel = 'email'")
        total = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT n.id, n.tenant_id, t.name, n.subject, n.status, n.created_at
            FROM notifications n
            LEFT JOIN tenants t ON t.id = n.tenant_id
            WHERE n.channel = 'email'
            ORDER BY n.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    return {
        "items": [
            {
                "id": row[0],
                "tenant_id": row[1],
                "tenant_name": row[2],
                "subject": row[3],
                "status": row[4],
                "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
            }
            for row in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
