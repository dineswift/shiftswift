"""Platform master tenant lifecycle — suspend, restore, soft delete, trial extension."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from auth_service import hash_password, verify_password
from core.notifications import require_email_delivered, send_email_notification, smtp_configured
from modules.master.service import _pick_canonical_tenant_id, delete_eligibility, list_tenants
from trial_service import TRIALING_STATUSES

ACTIVE_EMPLOYEE_STATUSES = ("active", "onboarding", "suspended")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fetch_tenant_row(cur: Any, tenant_id: int, master_tenant_id: int) -> tuple[Any, ...] | None:
    cur.execute(
        """
        SELECT id, name, billing_email, platform_status, deleted_at, trial_ends_at, subscription_status
        FROM tenants
        WHERE id = %s AND id != %s
        """,
        (tenant_id, master_tenant_id),
    )
    return cur.fetchone()


def _get_tenant_row(conn: Any, tenant_id: int, master_tenant_id: int) -> tuple[Any, ...] | None:
    with conn.cursor() as cur:
        return _fetch_tenant_row(cur, tenant_id, master_tenant_id)


def suspend_tenant(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    master_username: str,
    reason: str | None = None,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    if row[4]:
        raise ValueError("Deleted tenants cannot be suspended — restore first")
    now = _utcnow()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET platform_status = 'suspended',
                platform_suspended_at = %s,
                platform_suspended_by = %s,
                platform_suspended_reason = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (now, master_username, (reason or "").strip() or None, tenant_id),
        )
        cur.execute(
            "UPDATE app_users SET is_active = FALSE, updated_at = NOW() WHERE tenant_id = %s",
            (tenant_id,),
        )
    return {"tenant_id": tenant_id, "platform_status": "suspended"}


def unsuspend_tenant(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    if row[4]:
        raise ValueError("Deleted tenants must be restored before re-enabling")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET platform_status = 'active',
                platform_suspended_at = NULL,
                platform_suspended_by = NULL,
                platform_suspended_reason = NULL,
                updated_at = NOW()
            WHERE id = %s
            """,
            (tenant_id,),
        )
        cur.execute(
            "UPDATE app_users SET is_active = TRUE, updated_at = NOW() WHERE tenant_id = %s",
            (tenant_id,),
        )
    return {"tenant_id": tenant_id, "platform_status": "active"}


def soft_delete_tenant(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    master_username: str,
    confirm_name: str,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    if row[4]:
        raise ValueError("Tenant is already deleted")
    can_delete, block_reason = delete_eligibility(
        subscription_status=row[6],
        platform_status=row[3],
        deleted_at=row[4],
    )
    if not can_delete:
        raise ValueError(block_reason or "Cannot delete this tenant")
    tenant_name = row[1] or ""
    if confirm_name.strip().lower() != tenant_name.strip().lower():
        raise ValueError("Confirmation name does not match tenant business name")
    now = _utcnow()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET deleted_at = %s,
                deleted_by = %s,
                platform_status = 'suspended',
                platform_suspended_at = COALESCE(platform_suspended_at, %s),
                platform_suspended_by = COALESCE(platform_suspended_by, %s),
                platform_suspended_reason = COALESCE(platform_suspended_reason, 'Soft deleted by platform admin'),
                updated_at = NOW()
            WHERE id = %s
            """,
            (now, master_username, now, master_username, tenant_id),
        )
        cur.execute(
            "UPDATE app_users SET is_active = FALSE, updated_at = NOW() WHERE tenant_id = %s",
            (tenant_id,),
        )
    return {"tenant_id": tenant_id, "deleted_at": now.isoformat()}


def _duplicate_billing_groups(tenants: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for tenant in tenants:
        email = (tenant.get("billing_email") or "").strip().lower()
        if email:
            groups.setdefault(email, []).append(tenant)
    return {email: group for email, group in groups.items() if len(group) > 1}


def cleanup_duplicate_tenants(
    *,
    conn: Any,
    master_tenant_id: int,
    master_username: str,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Soft-delete orphan duplicate trials that share the same billing email."""
    tenants = list_tenants(conn=conn, master_tenant_id=master_tenant_id, include_deleted=False)
    groups = _duplicate_billing_groups(tenants)

    removed: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    deleted_count = 0
    now = _utcnow()

    for email, group in groups.items():
        keeper_id = _pick_canonical_tenant_id(group)
        keeper = next(row for row in group if row["id"] == keeper_id)
        kept.append({"tenant_id": keeper_id, "billing_email": email, "name": keeper.get("name")})
        for tenant in group:
            if tenant["id"] == keeper_id:
                continue
            entry = {
                "tenant_id": tenant["id"],
                "billing_email": email,
                "name": tenant.get("name"),
            }
            if dry_run:
                entry["action"] = "would_soft_delete"
                removed.append(entry)
                continue
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE tenants
                    SET deleted_at = %s,
                        deleted_by = %s,
                        platform_status = 'suspended',
                        platform_suspended_at = COALESCE(platform_suspended_at, %s),
                        platform_suspended_by = COALESCE(platform_suspended_by, %s),
                        platform_suspended_reason = COALESCE(
                            platform_suspended_reason,
                            'Duplicate trial removed automatically'
                        ),
                        updated_at = NOW()
                    WHERE id = %s AND deleted_at IS NULL
                    """,
                    (now, master_username, now, master_username, tenant["id"]),
                )
                if cur.rowcount == 0:
                    entry["action"] = "skipped"
                    entry["reason"] = "already_deleted_or_not_found"
                    removed.append(entry)
                    continue
                cur.execute(
                    "UPDATE app_users SET is_active = FALSE, updated_at = NOW() WHERE tenant_id = %s",
                    (tenant["id"],),
                )
            entry["action"] = "soft_delete"
            deleted_count += 1
            removed.append(entry)

    return {
        "dry_run": dry_run,
        "groups": len(groups),
        "kept": kept,
        "removed": removed,
        "deleted_count": deleted_count,
        "message": (
            f"Found {len(removed)} duplicate trial workspace(s) across {len(groups)} billing email(s)."
            if dry_run
            else f"Removed {deleted_count} duplicate trial workspace(s)."
        ),
    }


def restore_tenant(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    if not row[4]:
        raise ValueError("Tenant is not deleted")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET deleted_at = NULL,
                deleted_by = NULL,
                platform_status = 'active',
                platform_suspended_at = NULL,
                platform_suspended_by = NULL,
                platform_suspended_reason = NULL,
                updated_at = NOW()
            WHERE id = %s
            """,
            (tenant_id,),
        )
        cur.execute(
            "UPDATE app_users SET is_active = TRUE, updated_at = NOW() WHERE tenant_id = %s",
            (tenant_id,),
        )
    return {"tenant_id": tenant_id, "restored": True}


def extend_trial(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    days: int,
) -> dict[str, Any]:
    if days < 1 or days > 90:
        raise ValueError("Trial extension must be between 1 and 90 days")
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    if row[4]:
        raise ValueError("Cannot extend trial for a deleted tenant")
    subscription_status = (row[6] or "").lower()
    if subscription_status not in TRIALING_STATUSES and subscription_status not in {"", "trialing", "provisioning"}:
        raise ValueError("Trial extension applies to trialing tenants only")
    now = _utcnow()
    current_end = row[5]
    if isinstance(current_end, datetime):
        if current_end.tzinfo is None:
            current_end = current_end.replace(tzinfo=timezone.utc)
        base = max(current_end, now)
    else:
        base = now
    new_end = base + timedelta(days=days)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET trial_ends_at = %s,
                subscription_status = COALESCE(NULLIF(subscription_status, ''), 'trialing'),
                license_state = 'active',
                updated_at = NOW()
            WHERE id = %s
            """,
            (new_end, tenant_id),
        )
    return {"tenant_id": tenant_id, "trial_ends_at": new_end.isoformat(), "days_added": days}


def save_internal_notes(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    notes: str,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    clean = (notes or "").strip()
    if len(clean) > 8000:
        raise ValueError("Notes must be 8000 characters or fewer")
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE tenants SET internal_notes = %s, updated_at = NOW() WHERE id = %s",
            (clean, tenant_id),
        )
    return {"tenant_id": tenant_id, "internal_notes": clean}


def update_tenant_workspace(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    business_name: str,
    trading_name: str | None = None,
    registered_address: str | None = None,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    if row[4]:
        raise ValueError("Cannot edit a deleted tenant")

    clean_name = (business_name or "").strip()
    if len(clean_name) < 2:
        raise ValueError("Business name must be at least 2 characters")
    if len(clean_name) > 200:
        raise ValueError("Business name must be 200 characters or fewer")

    clean_trading = (trading_name or "").strip()[:200]
    clean_address = (registered_address or "").strip()[:500]

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET name = %s,
                trading_name = %s,
                registered_address = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (clean_name, clean_trading or None, clean_address or None, tenant_id),
        )

    return {
        "tenant_id": tenant_id,
        "name": clean_name,
        "trading_name": clean_trading,
        "registered_address": clean_address,
    }


def email_tenant_contact(
    *,
    conn: Any,
    tenant_id: int,
    master_tenant_id: int,
    subject: str,
    body: str,
    master_username: str,
) -> dict[str, Any]:
    row = _get_tenant_row(conn, tenant_id, master_tenant_id)
    if not row:
        raise LookupError("Tenant not found")
    recipient = (row[2] or "").strip()
    if not recipient:
        raise ValueError("Tenant has no billing email on file")
    clean_subject = (subject or "").strip()
    clean_body = (body or "").strip()
    if not clean_subject or not clean_body:
        raise ValueError("Subject and message are required")
    if not smtp_configured():
        raise RuntimeError("SMTP is not configured on the server — set SMTP_* in environment")
    delivery = send_email_notification(
        conn=conn,
        tenant_id=tenant_id,
        subject=clean_subject,
        body=clean_body,
        purpose="general",
        to=recipient,
        audience="hr",
        deliver_now=True,
        commit=False,
    )
    require_email_delivered(delivery)
    return {"tenant_id": tenant_id, "sent_to": recipient, "subject": clean_subject, "email_sent": True}


def change_master_password(
    *,
    conn: Any,
    master_tenant_id: int,
    username: str,
    current_password: str,
    new_password: str,
) -> dict[str, Any]:
    if len(new_password) < 12:
        raise ValueError("New password must be at least 12 characters")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT password_hash FROM app_users
            WHERE username = %s AND tenant_id = %s AND role = 'admin' AND login_portal = 'master'
            """,
            (username, master_tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Master account not found")
        if not verify_password(current_password, row[0]):
            raise PermissionError("Current password is incorrect")
        cur.execute(
            """
            UPDATE app_users
            SET password_hash = %s, updated_at = NOW(), failed_login_attempts = 0, locked_until = NULL
            WHERE username = %s AND tenant_id = %s
            """,
            (hash_password(new_password), username, master_tenant_id),
        )
    return {"message": "Password updated."}


def master_account_profile(*, conn: Any, master_tenant_id: int, username: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT mfa_enabled, mfa_enabled_at, created_at
            FROM app_users
            WHERE username = %s AND tenant_id = %s AND role = 'admin' AND login_portal = 'master'
            """,
            (username, master_tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Master account not found")
    return {
        "username": username,
        "mfa_enabled": bool(row[0]),
        "mfa_enabled_at": row[1].isoformat() if isinstance(row[1], datetime) else row[1],
        "created_at": row[2].isoformat() if isinstance(row[2], datetime) else row[2],
    }


def disable_master_mfa(
    *,
    conn: Any,
    master_tenant_id: int,
    username: str,
    current_password: str,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT password_hash, mfa_enabled FROM app_users
            WHERE username = %s AND tenant_id = %s AND role = 'admin' AND login_portal = 'master'
            """,
            (username, master_tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Master account not found")
        if not verify_password(current_password, row[0]):
            raise PermissionError("Current password is incorrect")
        cur.execute(
            """
            UPDATE app_users
            SET mfa_enabled = FALSE, totp_secret = NULL, mfa_enabled_at = NULL, updated_at = NOW()
            WHERE username = %s AND tenant_id = %s
            """,
            (username, master_tenant_id),
        )
    return {"message": "MFA disabled. You will be prompted to set it up again on next master sign-in."}
