"""Master OPS: reset HR password / send setup email for existing tenants."""

from __future__ import annotations

import secrets
from typing import Any

from auth_password_reset import RESET_HOURS, send_account_setup_email
from auth_service import hash_password
from config import Settings
from core.email_templates import password_reset_email
from core.notifications import smtp_configured


def _generate_temporary_password() -> str:
    return f"Shift-{secrets.token_urlsafe(9)}"


def _resolve_primary_hr_user(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, billing_email, platform_status, deleted_at
            FROM tenants
            WHERE id = %s AND id != %s
            """,
            (tenant_id, master_tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Tenant not found")
        if row[4] is not None:
            raise ValueError("Cannot reset credentials for a deleted tenant")
        billing_email = (row[2] or "").strip()
        cur.execute(
            """
            SELECT username, tenant_id, role
            FROM app_users
            WHERE tenant_id = %s AND role = 'hr' AND is_active = TRUE
              AND COALESCE(login_portal, 'business') = 'business'
            ORDER BY
              CASE WHEN lower(username) = lower(%s) THEN 0 ELSE 1 END,
              updated_at DESC NULLS LAST
            LIMIT 1
            """,
            (tenant_id, billing_email),
        )
        user = cur.fetchone()
    if not user:
        raise ValueError("No active HR login for this tenant")
    return {
        "username": user[0],
        "tenant_id": int(user[1]),
        "role": user[2] or "hr",
        "billing_email": billing_email,
        "tenant_name": row[1],
    }


def _invalidate_password_reset_tokens(conn: Any, username: str) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE password_reset_tokens
                SET used_at = NOW()
                WHERE username = %s AND used_at IS NULL
                """,
                (username,),
            )
    except Exception:
        # Table may not exist in older schemas; ignore.
        pass


def reset_hr_password(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    settings: Settings,
    send_email: bool,
    set_temporary_password: bool,
    ip_address: str | None,
    user_agent: str | None,
) -> dict[str, Any]:
    if not send_email and not set_temporary_password:
        raise ValueError("Choose send_email and/or set_temporary_password")

    hr = _resolve_primary_hr_user(
        conn=conn,
        tenant_id=tenant_id,
        master_tenant_id=master_tenant_id,
    )
    username = str(hr["username"])
    result: dict[str, Any] = {
        "tenant_id": tenant_id,
        "hr_username": username,
        "email_sent": False,
        "temporary_password_set": False,
    }

    if set_temporary_password:
        password = _generate_temporary_password()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE app_users
                SET password_hash = %s,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    updated_at = NOW()
                WHERE tenant_id = %s
                  AND username = %s
                  AND role = 'hr'
                  AND is_active = TRUE
                """,
                (hash_password(password), tenant_id, username),
            )
            if cur.rowcount < 1:
                raise ValueError("No active HR login for this tenant")
        _invalidate_password_reset_tokens(conn, username)
        result["temporary_password_set"] = True
        result["temporary_password"] = password

    if send_email:
        if not smtp_configured():
            raise RuntimeError("SMTP is not configured on the server — set SMTP_* in environment")
        send_account_setup_email(
            settings=settings,
            conn=conn,
            user={"username": username, "role": "hr", "tenant_id": tenant_id},
            content_factory=lambda reset_url: password_reset_email(
                role_label="HR admin",
                reset_url=reset_url,
                reset_hours=RESET_HOURS,
            ),
            ip_address=ip_address,
            user_agent=user_agent,
            security_event_type="master_hr_password_reset_email",
            commit=False,
        )
        result["email_sent"] = True

    return result
