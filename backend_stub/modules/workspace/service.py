"""Workspace users — HR portal accounts with role-based access (not employee portal)."""

from __future__ import annotations

import secrets
from typing import Any

from auth_password_reset import RESET_HOURS, send_account_setup_email
from auth_service import hash_password
from config import Settings
from core.email_templates import workspace_user_invite_email
from employee_audit import log_employee_data_event
from rbac import WORKSPACE_ROLE_LABELS, WORKSPACE_ROLES


def ensure_workspace_owner(*, conn: Any, tenant_id: int, username: str) -> None:
    email = username.strip().lower()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tenant_users (tenant_id, username, role, is_active)
            VALUES (%s, %s, 'owner', TRUE)
            ON CONFLICT (tenant_id, username) DO NOTHING
            """,
            (tenant_id, email),
        )


def list_workspace_users(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              tu.username,
              tu.role,
              tu.display_name,
              tu.is_active,
              tu.invited_by,
              tu.invited_at,
              tu.created_at,
              tu.updated_at,
              au.mfa_enabled,
              au.is_active AS login_active,
              (
                SELECT MAX(s.created_at)
                FROM security_audit_events s
                WHERE lower(s.username) = lower(tu.username)
                  AND s.success = TRUE
                  AND s.event_type = 'login_success'
              ) AS last_login_at
            FROM tenant_users tu
            LEFT JOIN app_users au
              ON lower(au.username) = lower(tu.username)
             AND au.tenant_id = tu.tenant_id
             AND au.role = 'hr'
            WHERE tu.tenant_id = %s
            ORDER BY
              CASE tu.role WHEN 'owner' THEN 0 WHEN 'hr_manager' THEN 1 ELSE 2 END,
              lower(tu.username)
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        role = str(row[1])
        items.append(
            {
                "username": row[0],
                "role": role,
                "role_label": WORKSPACE_ROLE_LABELS.get(role, role),
                "display_name": row[2] or "",
                "is_active": bool(row[3]),
                "invited_by": row[4] or "",
                "invited_at": row[5].isoformat() if row[5] else None,
                "created_at": row[6].isoformat() if row[6] else None,
                "updated_at": row[7].isoformat() if row[7] else None,
                "mfa_enabled": bool(row[8]) if row[8] is not None else False,
                "login_active": bool(row[9]) if row[9] is not None else False,
                "last_login_at": row[10].isoformat() if row[10] else None,
            }
        )
    return items


def _count_active_owners(*, tenant_id: int, conn: Any, exclude_username: str | None = None) -> int:
    with conn.cursor() as cur:
        if exclude_username:
            cur.execute(
                """
                SELECT COUNT(*) FROM tenant_users
                WHERE tenant_id = %s AND role = 'owner' AND is_active = TRUE
                  AND lower(username) <> lower(%s)
                """,
                (tenant_id, exclude_username),
            )
        else:
            cur.execute(
                """
                SELECT COUNT(*) FROM tenant_users
                WHERE tenant_id = %s AND role = 'owner' AND is_active = TRUE
                """,
                (tenant_id,),
            )
        return int(cur.fetchone()[0])


def _validate_invite_role(role: str, *, actor_workspace_role: str) -> str:
    normalized = role.strip().lower()
    if normalized not in WORKSPACE_ROLES:
        raise ValueError(f"Unknown role — choose one of: {', '.join(WORKSPACE_ROLES)}")
    if normalized == "owner" and actor_workspace_role != "owner":
        raise ValueError("Only the workspace owner can assign the owner role")
    if normalized == "owner" and actor_workspace_role == "owner":
        pass
    return normalized


def _assert_email_available(
    *,
    conn: Any,
    tenant_id: int,
    email: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT role, tenant_id::text, login_portal
            FROM app_users
            WHERE lower(username) = lower(%s)
            LIMIT 1
            """,
            (email,),
        )
        row = cur.fetchone()
    if not row:
        return
    app_role, existing_tenant, login_portal = row[0], str(row[1]), row[2] or "business"
    if app_role == "employee":
        raise ValueError("This email is already used for an employee portal account")
    if app_role == "admin" or login_portal == "master":
        raise ValueError("This email is reserved for platform administration")
    if str(existing_tenant) != str(tenant_id):
        raise ValueError("This email is already registered on another ShiftSwift HR workspace")


def invite_workspace_user(
    *,
    tenant_id: int,
    email: str,
    role: str,
    display_name: str | None,
    actor_username: str,
    actor_workspace_role: str,
    actor_role: str,
    conn: Any,
    settings: Settings,
    ip_address: str | None = None,
    user_agent: str | None = None,
    resend: bool = True,
) -> dict[str, Any]:
    email_norm = email.strip().lower()
    if not email_norm or "@" not in email_norm:
        raise ValueError("A valid work email is required")
    workspace_role = _validate_invite_role(role, actor_workspace_role=actor_workspace_role)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT role, is_active FROM tenant_users
            WHERE tenant_id = %s AND lower(username) = lower(%s)
            LIMIT 1
            """,
            (tenant_id, email_norm),
        )
        existing = cur.fetchone()

    if existing and not resend:
        raise ValueError("This user already has workspace access")

    _assert_email_available(conn=conn, tenant_id=tenant_id, email=email_norm)

    placeholder_password = secrets.token_urlsafe(24)
    password_hash = hash_password(placeholder_password)
    created_login = False

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM app_users
            WHERE lower(username) = lower(%s) AND tenant_id = %s AND role = 'hr'
            LIMIT 1
            """,
            (email_norm, tenant_id),
        )
        has_login = cur.fetchone() is not None
        if not has_login:
            cur.execute(
                """
                INSERT INTO app_users (username, password_hash, role, tenant_id, login_portal)
                VALUES (%s, %s, 'hr', %s, 'business')
                """,
                (email_norm, password_hash, tenant_id),
            )
            created_login = True
        else:
            cur.execute(
                """
                UPDATE app_users
                SET is_active = TRUE, login_portal = 'business', updated_at = NOW()
                WHERE lower(username) = lower(%s) AND tenant_id = %s AND role = 'hr'
                """,
                (email_norm, tenant_id),
            )

        cur.execute(
            """
            INSERT INTO tenant_users (
              tenant_id, username, role, display_name, is_active, invited_by, invited_at
            )
            VALUES (%s, %s, %s, %s, TRUE, %s, NOW())
            ON CONFLICT (tenant_id, username) DO UPDATE SET
              role = EXCLUDED.role,
              display_name = COALESCE(EXCLUDED.display_name, tenant_users.display_name),
              is_active = TRUE,
              invited_by = EXCLUDED.invited_by,
              invited_at = NOW(),
              updated_at = NOW()
            """,
            (
                tenant_id,
                email_norm,
                workspace_role,
                (display_name or "").strip() or None,
                actor_username,
            ),
        )

    import os

    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    user_row = {
        "username": email_norm,
        "role": "hr",
        "tenant_id": tenant_id,
    }
    role_label = WORKSPACE_ROLE_LABELS.get(workspace_role, workspace_role)

    send_account_setup_email(
        settings=settings,
        conn=conn,
        user=user_row,
        content_factory=lambda reset_url: workspace_user_invite_email(
            role_label=role_label,
            setup_url=reset_url,
            login_url=f"{app_url}/sign-in.html",
            reset_hours=RESET_HOURS,
        ),
        ip_address=ip_address,
        user_agent=user_agent,
        security_event_type="workspace_user_invite_sent",
        commit=False,
    )

    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="create",
        entity_type="workspace_user",
        entity_id=None,
        field_name=email_norm,
        new_value=workspace_role,
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    conn.commit()

    return {
        "username": email_norm,
        "role": workspace_role,
        "role_label": role_label,
        "display_name": display_name or "",
        "created_login": created_login,
        "message": f"Invite sent to {email_norm}",
    }


def update_workspace_user(
    *,
    tenant_id: int,
    username: str,
    role: str | None,
    display_name: str | None,
    is_active: bool | None,
    actor_username: str,
    actor_workspace_role: str,
    actor_role: str,
    conn: Any,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    email_norm = username.strip().lower()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT role, is_active FROM tenant_users
            WHERE tenant_id = %s AND lower(username) = lower(%s)
            LIMIT 1
            """,
            (tenant_id, email_norm),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Workspace user not found")

    current_role = str(row[0])
    if role is not None:
        new_role = _validate_invite_role(role, actor_workspace_role=actor_workspace_role)
    else:
        new_role = current_role

    if is_active is False:
        if current_role == "owner" and _count_active_owners(
            tenant_id=tenant_id, conn=conn, exclude_username=email_norm
        ) < 1:
            raise ValueError("Cannot deactivate the last workspace owner")
        if email_norm == actor_username.strip().lower():
            raise ValueError("You cannot deactivate your own account")

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenant_users
            SET
              role = COALESCE(%s, role),
              display_name = COALESCE(%s, display_name),
              is_active = COALESCE(%s, is_active),
              updated_at = NOW()
            WHERE tenant_id = %s AND lower(username) = lower(%s)
            RETURNING role, display_name, is_active
            """,
            (
                new_role if role is not None else None,
                (display_name or "").strip() or None if display_name is not None else None,
                is_active,
                tenant_id,
                email_norm,
            ),
        )
        updated = cur.fetchone()
        if is_active is False:
            cur.execute(
                """
                UPDATE app_users
                SET is_active = FALSE, updated_at = NOW()
                WHERE tenant_id = %s AND lower(username) = lower(%s) AND role = 'hr'
                """,
                (tenant_id, email_norm),
            )
        elif is_active is True:
            cur.execute(
                """
                UPDATE app_users
                SET is_active = TRUE, updated_at = NOW()
                WHERE tenant_id = %s AND lower(username) = lower(%s) AND role = 'hr'
                """,
                (tenant_id, email_norm),
            )

    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="update",
        entity_type="workspace_user",
        entity_id=None,
        field_name=email_norm,
        new_value=new_role,
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    conn.commit()

    role_key = str(updated[0])
    return {
        "username": email_norm,
        "role": role_key,
        "role_label": WORKSPACE_ROLE_LABELS.get(role_key, role_key),
        "display_name": updated[1] or "",
        "is_active": bool(updated[2]),
        "message": "Workspace user updated",
    }
