"""Software license access — trial, Direct Debit failures, grace period, and hold."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from trial_service import (
    _app_url,
    _upgrade_page_url,
    _utcnow,
    trial_snapshot,
)
from brand import EMAIL_SUPPORT

DD_GRACE_DAYS = int(os.getenv("BILLING_DD_GRACE_DAYS", "7"))
PAYMENT_WARNING_STATUSES = frozenset({"past_due", "unpaid"})
PAYMENT_HOLD_STATUS = "payment_hold"


def _billing_page_url() -> str:
    return os.getenv("BILLING_UPGRADE_URL", f"{_app_url()}/admin.html#overview")


def _failure_row(cur: Any, tenant_id: int) -> tuple[Any, ...] | None:
    cur.execute(
        """
        SELECT payment_failed_at, license_hold_at, license_state,
               subscription_status, billing_email, name
        FROM tenants WHERE id = %s
        """,
        (tenant_id,),
    )
    return cur.fetchone()


def days_until_hold(*, payment_failed_at: datetime | None, as_of: datetime | None = None) -> int | None:
    if not payment_failed_at:
        return None
    now = as_of or _utcnow()
    if payment_failed_at.tzinfo is None:
        payment_failed_at = payment_failed_at.replace(tzinfo=timezone.utc)
    elapsed = (now.date() - payment_failed_at.date()).days
    return DD_GRACE_DAYS - elapsed


def license_snapshot(*, tenant_id: int, conn: Any, as_of: datetime | None = None) -> dict[str, Any]:
    """Merged trial + Direct Debit payment failure view for UI and access checks."""
    now = as_of or _utcnow()
    trial = trial_snapshot(tenant_id=tenant_id, conn=conn, as_of=now)

    with conn.cursor() as cur:
        row = _failure_row(cur, tenant_id)
    if not row:
        raise LookupError("tenant not found")

    payment_failed_at, license_hold_at, license_state, sub_status, billing_email, tenant_name = row

    grace_days_left = days_until_hold(payment_failed_at=payment_failed_at, as_of=now)
    payment_issue = sub_status in PAYMENT_WARNING_STATUSES or sub_status == PAYMENT_HOLD_STATUS
    in_grace = payment_issue and payment_failed_at and grace_days_left is not None and grace_days_left > 0
    on_hold = (
        license_state == PAYMENT_HOLD_STATUS
        or sub_status == PAYMENT_HOLD_STATUS
        or (payment_failed_at and grace_days_left is not None and grace_days_left <= 0 and payment_issue)
    )

    access_allowed = trial["access_allowed"]
    license_warning = False
    warning_message = None
    hold_message = None

    if on_hold:
        access_allowed = False
        license_state_effective = PAYMENT_HOLD_STATUS
        hold_message = (
            f"Your Direct Debit payment failed. The {DD_GRACE_DAYS}-day grace period has ended — "
            "ShiftSwift HR is on hold until payment is received."
        )
    elif in_grace:
        access_allowed = access_allowed or True
        license_state_effective = "payment_warning"
        license_warning = True
        warning_message = (
            f"Direct Debit payment failed. Please update your bank details or pay within "
            f"{grace_days_left} day{'s' if grace_days_left != 1 else ''} to avoid your licence being placed on hold."
        )
    elif not trial["access_allowed"]:
        access_allowed = False
        license_state_effective = "trial_expired"
    else:
        license_state_effective = license_state or "active"

    failed_iso = payment_failed_at.isoformat() if isinstance(payment_failed_at, datetime) else payment_failed_at
    hold_iso = license_hold_at.isoformat() if isinstance(license_hold_at, datetime) else license_hold_at

    return {
        **trial,
        "license_state": license_state_effective,
        "payment_failed_at": failed_iso,
        "license_hold_at": hold_iso,
        "grace_days_total": DD_GRACE_DAYS,
        "grace_days_remaining": max(grace_days_left, 0) if grace_days_left is not None else None,
        "license_warning": license_warning,
        "license_on_hold": on_hold,
        "warning_message": warning_message,
        "hold_message": hold_message,
        "access_allowed": access_allowed,
        "billing_email": billing_email or trial.get("billing_email"),
        "tenant_name": tenant_name,
        "update_payment_url": _billing_page_url(),
    }


def assert_tenant_access(*, tenant_id: int, conn: Any, master_tenant_id: str) -> None:
    if str(tenant_id) == str(master_tenant_id):
        return

    from fastapi import HTTPException

    with conn.cursor() as cur:
        cur.execute(
            "SELECT platform_status, deleted_at, name FROM tenants WHERE id = %s",
            (tenant_id,),
        )
        platform_row = cur.fetchone()
    if not platform_row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    platform_status, deleted_at, tenant_name = platform_row
    if deleted_at is not None:
        raise HTTPException(
            status_code=403,
            detail={
                "message": "This business account has been closed by the platform administrator.",
                "platform_suspended": True,
                "tenant_name": tenant_name,
            },
        )
    if (platform_status or "active").strip().lower() == "suspended":
        raise HTTPException(
            status_code=403,
            detail={
                "message": f"This business account is temporarily suspended. Contact {EMAIL_SUPPORT}.",
                "platform_suspended": True,
                "tenant_name": tenant_name,
            },
        )

    snap = license_snapshot(tenant_id=tenant_id, conn=conn)
    if snap["access_allowed"]:
        return

    from fastapi import HTTPException

    if snap.get("license_on_hold"):
        raise HTTPException(
            status_code=402,
            detail={
                "message": snap["hold_message"],
                "license_on_hold": True,
                "payment_failed_at": snap["payment_failed_at"],
                "license_hold_at": snap["license_hold_at"],
                "update_payment_url": snap["update_payment_url"],
                "subscription_status": snap["subscription_status"],
            },
        )

    raise HTTPException(
        status_code=402,
        detail={
            "message": "Your free trial has ended. Upgrade your subscription to continue using ShiftSwift HR.",
            "upgrade_required": True,
            "upgrade_url": snap["upgrade_url"],
            "trial_ends_at": snap["trial_ends_at"],
            "subscription_status": snap["subscription_status"],
        },
    )


def resolve_tenant_by_stripe_customer(cur: Any, customer_id: str | None) -> int | None:
    if not customer_id:
        return None
    cur.execute("SELECT id FROM tenants WHERE stripe_customer_id = %s", (customer_id,))
    row = cur.fetchone()
    return int(row[0]) if row else None


def record_payment_failure(
    *,
    conn: Any,
    tenant_id: int,
    failed_at: datetime | None = None,
    subscription_status: str = "past_due",
) -> dict[str, Any]:
    """Mark DD/invoice failure — starts grace period and sends first warning email."""
    when = failed_at or _utcnow()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT payment_failed_at, billing_email, name
            FROM tenants WHERE id = %s FOR UPDATE
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
        existing_failure, billing_email, tenant_name = row

        if existing_failure is None:
            cur.execute(
                """
                UPDATE tenants SET
                  payment_failed_at = %s,
                  license_hold_at = NULL,
                  license_state = 'payment_warning',
                  subscription_status = %s
                WHERE id = %s
                """,
                (when, subscription_status, tenant_id),
            )
            failure_started = when
        else:
            failure_started = existing_failure
            cur.execute(
                """
                UPDATE tenants SET
                  license_state = CASE
                    WHEN license_state = 'payment_hold' THEN license_state
                    ELSE 'payment_warning'
                  END,
                  subscription_status = %s
                WHERE id = %s
                """,
                (subscription_status, tenant_id),
            )

    conn.commit()
    _queue_payment_email(
        conn=conn,
        tenant_id=tenant_id,
        billing_email=billing_email,
        tenant_name=tenant_name or f"Tenant {tenant_id}",
        failure_started_at=failure_started,
        reminder_key="failed",
        grace_days_left=days_until_hold(payment_failed_at=failure_started, as_of=when),
    )
    conn.commit()
    return license_snapshot(tenant_id=tenant_id, conn=conn)


def clear_payment_failure(*, conn: Any, tenant_id: int) -> None:
    """Payment succeeded — restore active licence."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants SET
              payment_failed_at = NULL,
              license_hold_at = NULL,
              license_state = 'active',
              subscription_status = 'active'
            WHERE id = %s
            """,
            (tenant_id,),
        )
    conn.commit()


def apply_license_hold(*, conn: Any, tenant_id: int, as_of: datetime | None = None) -> None:
    when = as_of or _utcnow()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants SET
              license_state = 'payment_hold',
              subscription_status = %s,
              license_hold_at = COALESCE(license_hold_at, %s)
            WHERE id = %s
            """,
            (PAYMENT_HOLD_STATUS, when, tenant_id),
        )
    conn.commit()


def _reminder_sent(cur: Any, tenant_id: int, failure_started_at: datetime, reminder_key: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM payment_failure_reminder_log
        WHERE tenant_id = %s AND failure_started_at = %s AND reminder_key = %s
        """,
        (tenant_id, failure_started_at, reminder_key),
    )
    return cur.fetchone() is not None


def _log_reminder(cur: Any, tenant_id: int, failure_started_at: datetime, reminder_key: str) -> None:
    cur.execute(
        """
        INSERT INTO payment_failure_reminder_log (tenant_id, failure_started_at, reminder_key)
        VALUES (%s, %s, %s)
        ON CONFLICT (tenant_id, failure_started_at, reminder_key) DO NOTHING
        """,
        (tenant_id, failure_started_at, reminder_key),
    )


def _queue_payment_email(
    *,
    conn: Any,
    tenant_id: int,
    billing_email: str | None,
    tenant_name: str,
    failure_started_at: datetime,
    reminder_key: str,
    grace_days_left: int | None,
) -> None:
    if not billing_email:
        return

    with conn.cursor() as cur:
        if _reminder_sent(cur, tenant_id, failure_started_at, reminder_key):
            return

    billing_url = _billing_page_url()

    from core.email_templates import payment_failure_email

    template_key = "grace_start" if reminder_key == "failed" else reminder_key
    content = payment_failure_email(
        tenant_name=tenant_name,
        reminder_key=template_key,
        billing_url=billing_url,
        grace_days_left=grace_days_left,
        grace_period_days=DD_GRACE_DAYS,
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (tenant_id, channel, subject, body, payload, status)
            VALUES (%s, 'email', %s, %s, %s::jsonb, 'queued')
            """,
            (
                tenant_id,
                content.subject,
                content.text,
                json.dumps(
                    {
                        "to": billing_email,
                        "type": "payment_failure",
                        "reminder_key": reminder_key,
                        "purpose": "billing",
                        "html_body": content.html,
                    }
                ),
            ),
        )
        _log_reminder(cur, tenant_id, failure_started_at, reminder_key)


def process_payment_failure_cycle(*, conn: Any, as_of: datetime | None = None) -> dict[str, int]:
    """Send grace reminders, apply hold after period, queue emails. Run on cron."""
    now = as_of or _utcnow()
    summary = {"checked": 0, "reminders_sent": 0, "holds_applied": 0}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, payment_failed_at, billing_email, name, license_state
            FROM tenants
            WHERE payment_failed_at IS NOT NULL
              AND subscription_status IN ('past_due', 'unpaid', 'payment_hold')
            """
        )
        rows = cur.fetchall()

    for tenant_id, payment_failed_at, billing_email, tenant_name, license_state in rows:
        summary["checked"] += 1
        if not payment_failed_at:
            continue

        grace_left = days_until_hold(payment_failed_at=payment_failed_at, as_of=now)
        if grace_left is None:
            continue

        if grace_left <= 0 and license_state != PAYMENT_HOLD_STATUS:
            apply_license_hold(conn=conn, tenant_id=tenant_id, as_of=now)
            summary["holds_applied"] += 1
            _queue_payment_email(
                conn=conn,
                tenant_id=tenant_id,
                billing_email=billing_email,
                tenant_name=tenant_name or f"Tenant {tenant_id}",
                failure_started_at=payment_failed_at,
                reminder_key="hold",
                grace_days_left=0,
            )
            summary["reminders_sent"] += 1
            continue

        reminder_key = None
        if grace_left == 1:
            reminder_key = "grace_1_day"
        elif grace_left == max(DD_GRACE_DAYS // 2, 1):
            reminder_key = "grace_mid"

        if reminder_key:
            with conn.cursor() as cur:
                already = _reminder_sent(cur, tenant_id, payment_failed_at, reminder_key)
            if not already:
                _queue_payment_email(
                    conn=conn,
                    tenant_id=tenant_id,
                    billing_email=billing_email,
                    tenant_name=tenant_name or f"Tenant {tenant_id}",
                    failure_started_at=payment_failed_at,
                    reminder_key=reminder_key,
                    grace_days_left=grace_left,
                )
                summary["reminders_sent"] += 1

    conn.commit()
    return summary
