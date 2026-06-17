"""Provision employee portal logins and send setup emails."""

from __future__ import annotations

import re
import secrets
import os
from typing import Any

from auth_password_reset import RESET_HOURS, send_account_setup_email
import psycopg2.extras

from auth_service import hash_password
from config import Settings
from employee_audit import log_employee_data_event
from modules.employees.repository import fetch_employee

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
INVITE_EMPLOYEE_STATUSES = frozenset({"active", "onboarding"})
PORTAL_SETUP_COMPLETE_EVENTS = frozenset({"login_success", "password_reset_completed"})
PORTAL_REMINDER_MIN_DAYS = int(os.getenv("PORTAL_SETUP_REMINDER_MIN_DAYS", "1"))


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _looks_like_email(value: str | None) -> bool:
    return bool(value and EMAIL_RE.match(value))


def _fetch_app_user_row(*, conn: Any, email: str) -> dict[str, Any] | None:
    """Load app_users row on the active connection (includes uncommitted inserts)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT username, password_hash, role, tenant_id::text AS tenant_id, is_active,
                   locked_until, login_portal, mfa_enabled
            FROM app_users
            WHERE lower(username) = lower(%s)
            LIMIT 1
            """,
            (email,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def fetch_portal_account_by_email(*, conn: Any, email: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT username, role, tenant_id::text AS tenant_id, is_active, login_portal
            FROM app_users
            WHERE lower(username) = lower(%s)
            LIMIT 1
            """,
            (email,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "username": row[0],
        "role": row[1],
        "tenant_id": row[2],
        "is_active": bool(row[3]),
        "login_portal": row[4],
    }


def _fetch_portal_setup_complete_emails(*, conn: Any, emails: list[str]) -> set[str]:
    if not emails:
        return set()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT lower(username)
            FROM security_audit_events
            WHERE lower(username) = ANY(%s)
              AND success = TRUE
              AND event_type = ANY(%s)
            """,
            (emails, list(PORTAL_SETUP_COMPLETE_EVENTS)),
        )
        return {row[0] for row in cur.fetchall()}


def _fetch_last_portal_invite_at(
    *,
    conn: Any,
    tenant_id: int,
    employee_ids: list[int],
) -> dict[int, Any]:
    if not employee_ids:
        return {}
    from core.schema import table_columns

    if not table_columns(conn, "employee_data_audit_log"):
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT entity_id, MAX(created_at)
            FROM employee_data_audit_log
            WHERE tenant_id = %s
              AND action = 'invite'
              AND entity_type = 'employee_portal'
              AND entity_id = ANY(%s)
            GROUP BY entity_id
            """,
            (tenant_id, employee_ids),
        )
        return {int(row[0]): row[1] for row in cur.fetchall()}


def _resolve_portal_setup_status(*, has_account: bool, setup_complete: bool) -> str:
    if not has_account:
        return "none"
    if setup_complete:
        return "complete"
    return "pending"


def enrich_employees_portal_status(
    *,
    tenant_id: int,
    employees: list[dict[str, Any]],
    conn: Any,
) -> list[dict[str, Any]]:
    emails = [_normalize_email(item.get("email")) for item in employees if _looks_like_email(item.get("email"))]
    portal_by_email: dict[str, dict[str, Any]] = {}
    if emails:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT lower(username), role, tenant_id::text, is_active
                FROM app_users
                WHERE lower(username) = ANY(%s)
                """,
                (emails,),
            )
            for username, role, account_tenant_id, is_active in cur.fetchall():
                portal_by_email[username] = {
                    "role": role,
                    "tenant_id": account_tenant_id,
                    "is_active": bool(is_active),
                }

    setup_complete_emails = _fetch_portal_setup_complete_emails(conn=conn, emails=emails)
    employee_ids = [int(item["id"]) for item in employees if item.get("id") is not None]
    invite_sent_at_by_id = _fetch_last_portal_invite_at(
        conn=conn,
        tenant_id=tenant_id,
        employee_ids=employee_ids,
    )

    enriched: list[dict[str, Any]] = []
    for item in employees:
        email = _normalize_email(item.get("email"))
        account = portal_by_email.get(email) if email else None
        provisioned = bool(
            account
            and account["role"] == "employee"
            and str(account["tenant_id"]) == str(tenant_id)
            and account["is_active"]
        )
        setup_complete = bool(email and email in setup_complete_emails)
        setup_status = _resolve_portal_setup_status(
            has_account=provisioned,
            setup_complete=setup_complete,
        )
        employee_id = int(item["id"]) if item.get("id") is not None else None
        invite_sent_at = invite_sent_at_by_id.get(employee_id) if employee_id is not None else None
        eligible = (
            _looks_like_email(email)
            and item.get("status") in INVITE_EMPLOYEE_STATUSES
            and setup_status != "complete"
        )
        enriched.append(
            {
                **item,
                "portal_setup_status": setup_status,
                "portal_setup_pending": setup_status == "pending",
                "portal_setup_complete": setup_status == "complete",
                "portal_has_account": setup_status == "complete",
                "portal_invite_eligible": eligible,
                "portal_invite_sent_at": invite_sent_at.isoformat() if invite_sent_at else None,
            }
        )
    return enriched


def list_pending_portal_setups(
    *,
    tenant_id: int,
    conn: Any,
    min_days_since_invite: int = 0,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, email, status
            FROM employees
            WHERE tenant_id = %s AND status = ANY(%s)
            ORDER BY last_name, first_name
            """,
            (tenant_id, list(INVITE_EMPLOYEE_STATUSES)),
        )
        rows = cur.fetchall()

    employees = [
        {
            "id": row[0],
            "first_name": row[1],
            "last_name": row[2],
            "email": row[3],
            "status": row[4],
        }
        for row in rows
    ]
    enriched = enrich_employees_portal_status(tenant_id=tenant_id, employees=employees, conn=conn)
    pending = [item for item in enriched if item.get("portal_setup_status") == "pending"]
    if min_days_since_invite <= 0:
        return pending

    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=min_days_since_invite)
    filtered: list[dict[str, Any]] = []
    for item in pending:
        sent_raw = item.get("portal_invite_sent_at")
        if not sent_raw:
            continue
        sent_at = datetime.fromisoformat(str(sent_raw).replace("Z", "+00:00"))
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        if sent_at <= cutoff:
            filtered.append(item)
    return filtered


def count_pending_portal_setups(*, tenant_id: int, conn: Any) -> int:
    return len(list_pending_portal_setups(tenant_id=tenant_id, conn=conn))


def process_portal_setup_reminders(
    *,
    conn: Any,
    settings: Settings,
    as_of: Any | None = None,
) -> dict[str, int]:
    """Email HR when invited employees have not finished portal setup."""
    from datetime import date, datetime, timezone

    from admin_service import get_tenant_profile
    from core.email_templates import portal_setup_pending_hr_email
    from core.notifications import send_email_content

    today = as_of.date() if isinstance(as_of, datetime) else (as_of or date.today())
    summary = {"tenants_checked": 0, "reminders_sent": 0, "pending_employees": 0}

    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tenants ORDER BY id")
        tenant_ids = [int(row[0]) for row in cur.fetchall()]

    import os

    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    admin_url = f"{app_url}/admin.html#employees"

    for tenant_id in tenant_ids:
        summary["tenants_checked"] += 1
        pending = list_pending_portal_setups(
            tenant_id=tenant_id,
            conn=conn,
            min_days_since_invite=PORTAL_REMINDER_MIN_DAYS,
        )
        if not pending:
            continue

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM portal_setup_reminder_log
                WHERE tenant_id = %s AND reminder_date = %s
                LIMIT 1
                """,
                (tenant_id, today),
            )
            if cur.fetchone():
                continue

        profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
        tenant_name = profile.get("trading_name") or profile.get("name") or "Your business"
        to_email = profile.get("billing_email") or profile.get("signatory_email")
        if not to_email:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT username FROM app_users
                    WHERE tenant_id = %s AND role = 'hr' AND is_active = TRUE
                    ORDER BY username
                    LIMIT 1
                    """,
                    (tenant_id,),
                )
                hr_row = cur.fetchone()
                to_email = hr_row[0] if hr_row else None
        if not to_email:
            continue

        pending_rows = [
            {
                "name": f"{item.get('first_name', '')} {item.get('last_name', '')}".strip() or "Employee",
                "email": item.get("email") or "",
            }
            for item in pending
        ]
        content = portal_setup_pending_hr_email(
            tenant_name=tenant_name,
            pending_employees=pending_rows,
            admin_url=admin_url,
        )
        send_email_content(
            conn=conn,
            tenant_id=tenant_id,
            content=content,
            purpose="general",
            to=str(to_email),
            audience="hr",
            deliver_now=True,
            commit=False,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO portal_setup_reminder_log (tenant_id, reminder_date, pending_count)
                VALUES (%s, %s, %s)
                ON CONFLICT (tenant_id, reminder_date) DO NOTHING
                """,
                (tenant_id, today, len(pending)),
            )
        conn.commit()
        summary["reminders_sent"] += 1
        summary["pending_employees"] += len(pending)

    return summary


def _ensure_employee_app_user(
    *,
    tenant_id: int,
    email: str,
    conn: Any,
) -> tuple[dict[str, Any], bool]:
    existing = fetch_portal_account_by_email(conn=conn, email=email)
    if existing:
        if existing["role"] == "hr":
            raise ValueError("This email is already used for HR admin login — use a different work email")
        if existing["role"] == "admin" or existing.get("login_portal") not in {None, "business"}:
            raise ValueError("This email cannot be used for an employee portal account")
        if str(existing["tenant_id"]) != str(tenant_id):
            raise ValueError("This email is already registered on another ShiftSwift HR account")
        if not existing["is_active"]:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE app_users
                    SET is_active = TRUE, updated_at = NOW()
                    WHERE lower(username) = lower(%s)
                    """,
                    (email,),
                )
            existing["is_active"] = True
        user = _fetch_app_user_row(conn=conn, email=email)
        if not user:
            raise ValueError("Could not load employee login account")
        return user, False

    password_hash = hash_password(secrets.token_urlsafe(32))
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_users (username, password_hash, role, tenant_id, login_portal)
            VALUES (%s, %s, 'employee', %s, 'business')
            """,
            (email, password_hash, tenant_id),
        )
    user = _fetch_app_user_row(conn=conn, email=email)
    if not user:
        raise ValueError("Could not create employee login account")
    return user, True


def invite_employee_to_portal(
    *,
    tenant_id: int,
    employee_id: int,
    conn: Any,
    settings: Settings,
    actor_username: str,
    actor_role: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    resend_if_exists: bool = True,
) -> dict[str, Any]:
    employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not employee:
        raise LookupError("employee not found")

    email = _normalize_email(employee.get("email"))
    if not _looks_like_email(email):
        raise ValueError("Add a work email on the employee profile before sending a portal invite")
    if employee.get("status") not in INVITE_EMPLOYEE_STATUSES:
        raise ValueError("Portal invites are only available for active or onboarding employees")

    portal_meta = enrich_employees_portal_status(
        tenant_id=tenant_id,
        employees=[{**employee, "id": employee_id}],
        conn=conn,
    )[0]
    if portal_meta.get("portal_setup_complete") and not resend_if_exists:
        raise ValueError("This employee has already completed portal setup")

    user, created = _ensure_employee_app_user(
        tenant_id=tenant_id,
        email=email,
        conn=conn,
    )

    from core.email_templates import employee_portal_invite_email
    from modules.employees.notification_branding import (
        employee_notification_from_name,
        employer_legal_name,
    )

    notification_from_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    legal_name = employer_legal_name(tenant_id=tenant_id, conn=conn)
    employee_name = f"{employee.get('first_name', '')} {employee.get('last_name', '')}".strip() or "there"

    import os

    app_url = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    send_account_setup_email(
        settings=settings,
        conn=conn,
        user=user,
        content_factory=lambda reset_url: employee_portal_invite_email(
            employee_name=employee_name,
            notification_from_name=notification_from_name,
            employer_legal_name=legal_name,
            setup_url=reset_url,
            login_url=f"{app_url}/employee-login.html",
            reset_hours=RESET_HOURS,
        ),
        ip_address=ip_address,
        user_agent=user_agent,
        security_event_type="employee_portal_invite_sent",
        commit=False,
    )

    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="invite",
        entity_type="employee_portal",
        entity_id=employee_id,
        field_name=email,
        new_value="created" if created else "resent",
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    conn.commit()

    message = (
        f"Portal invite sent to {email}"
        if created
        else f"Portal setup link resent to {email}"
    )
    return {
        "employee_id": employee_id,
        "email": email,
        "created_account": created,
        "portal_setup_status": "pending",
        "portal_setup_pending": True,
        "portal_setup_complete": False,
        "portal_has_account": False,
        "message": message,
    }


def invite_missing_portal_accounts(
    *,
    tenant_id: int,
    conn: Any,
    settings: Settings,
    actor_username: str,
    actor_role: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    resend_existing: bool = False,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, email, status
            FROM employees
            WHERE tenant_id = %s AND status = ANY(%s)
            ORDER BY last_name, first_name
            """,
            (tenant_id, list(INVITE_EMPLOYEE_STATUSES)),
        )
        rows = cur.fetchall()

    employee_rows = [
        {
            "id": row[0],
            "first_name": row[1],
            "last_name": row[2],
            "email": row[3],
            "status": row[4],
        }
        for row in rows
    ]
    portal_meta_by_id = {
        int(item["id"]): item
        for item in enrich_employees_portal_status(
            tenant_id=tenant_id,
            employees=employee_rows,
            conn=conn,
        )
    }

    invited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for employee_id, first_name, last_name, email, status in rows:
        label = f"{first_name} {last_name}".strip()
        if not _looks_like_email(email):
            skipped.append({"employee_id": employee_id, "name": label, "reason": "no work email"})
            continue

        portal_meta = portal_meta_by_id.get(int(employee_id), {})
        setup_status = portal_meta.get("portal_setup_status", "none")
        if setup_status == "complete" and not resend_existing:
            skipped.append({"employee_id": employee_id, "name": label, "reason": "portal setup complete"})
            continue
        if setup_status == "pending" and not resend_existing:
            skipped.append(
                {
                    "employee_id": employee_id,
                    "name": label,
                    "reason": "invite sent — waiting for employee to set password",
                }
            )
            continue

        try:
            result = invite_employee_to_portal(
                tenant_id=tenant_id,
                employee_id=int(employee_id),
                conn=conn,
                settings=settings,
                actor_username=actor_username,
                actor_role=actor_role,
                ip_address=ip_address,
                user_agent=user_agent,
                resend_if_exists=resend_existing,
            )
            invited.append(
                {
                    "employee_id": result["employee_id"],
                    "name": label,
                    "email": result["email"],
                    "created_account": result["created_account"],
                }
            )
        except ValueError as exc:
            failed.append({"employee_id": employee_id, "name": label, "reason": str(exc)})

    created_count = sum(1 for item in invited if item.get("created_account"))
    resent_count = len(invited) - created_count
    parts = []
    if created_count:
        parts.append(f"{created_count} new account{'s' if created_count != 1 else ''}")
    if resent_count:
        parts.append(f"{resent_count} resent")
    summary = ", ".join(parts) if parts else "No invites sent"

    return {
        "invited_count": len(invited),
        "skipped_count": len(skipped),
        "failed_count": len(failed),
        "invited": invited,
        "skipped": skipped,
        "failed": failed,
        "message": f"{summary}. {len(skipped)} skipped, {len(failed)} failed.",
    }
