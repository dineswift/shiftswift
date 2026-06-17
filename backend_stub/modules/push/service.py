"""Web Push — VAPID config, subscription storage, and delivery."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

GONE_STATUS_CODES = frozenset({404, 410})


def app_url_path(path: str) -> str:
    base = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    if path.startswith("http"):
        return path
    return f"{base}/{path.lstrip('/')}"


def vapid_contact() -> str:
    email = os.getenv("VAPID_CONTACT_EMAIL") or os.getenv("EMAIL_SUPPORT", "support@shiftswifthr.co.uk")
    return email if email.startswith("mailto:") else f"mailto:{email}"


def vapid_public_key() -> str | None:
    value = (os.getenv("VAPID_PUBLIC_KEY") or "").strip()
    return value or None


def vapid_private_key() -> str | None:
    value = (os.getenv("VAPID_PRIVATE_KEY") or "").strip()
    return value or None


def push_configured() -> bool:
    return bool(vapid_public_key() and vapid_private_key())


def push_config_payload() -> dict[str, Any]:
    return {
        "enabled": push_configured(),
        "public_key": vapid_public_key(),
        "contact": vapid_contact(),
    }


def upsert_subscription(
    *,
    tenant_id: int,
    employee_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO push_subscriptions (
              tenant_id, employee_id, endpoint, p256dh, auth, user_agent, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (employee_id, endpoint) DO UPDATE SET
              p256dh = EXCLUDED.p256dh,
              auth = EXCLUDED.auth,
              user_agent = EXCLUDED.user_agent,
              updated_at = NOW()
            RETURNING id, created_at, updated_at
            """,
            (tenant_id, employee_id, endpoint, p256dh, auth, user_agent),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "id": row[0],
        "created_at": row[1].isoformat() if row[1] else None,
        "updated_at": row[2].isoformat() if row[2] else None,
    }


def delete_subscription(
    *,
    tenant_id: int,
    employee_id: int,
    endpoint: str,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM push_subscriptions
            WHERE tenant_id = %s AND employee_id = %s AND endpoint = %s
            """,
            (tenant_id, employee_id, endpoint),
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_subscriptions(
    *,
    tenant_id: int,
    employee_id: int,
    conn: Any,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, endpoint, p256dh, auth, user_agent, updated_at
            FROM push_subscriptions
            WHERE tenant_id = %s AND employee_id = %s
            ORDER BY updated_at DESC
            """,
            (tenant_id, employee_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "endpoint": row[1],
            "p256dh": row[2],
            "auth": row[3],
            "user_agent": row[4],
            "updated_at": row[5].isoformat() if row[5] else None,
        }
        for row in rows
    ]


def _delete_subscription_by_id(*, subscription_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM push_subscriptions WHERE id = %s", (subscription_id,))
    conn.commit()


def record_push_sent(
    *,
    tenant_id: int,
    employee_id: int,
    notification_key: str,
    conn: Any,
    commit: bool = True,
) -> bool:
    """Return True if this is the first send for notification_key."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO push_notification_log (tenant_id, employee_id, notification_key)
            VALUES (%s, %s, %s)
            ON CONFLICT (tenant_id, employee_id, notification_key) DO NOTHING
            RETURNING id
            """,
            (tenant_id, employee_id, notification_key),
        )
        row = cur.fetchone()
    if commit:
        conn.commit()
    return row is not None


def send_push(
    *,
    subscription: dict[str, Any],
    payload: dict[str, Any],
    conn: Any,
) -> bool:
    """Send one push. Removes expired subscriptions on 404/410."""
    if not push_configured():
        return False

    from pywebpush import WebPushException, webpush

    subscription_info = {
        "endpoint": subscription["endpoint"],
        "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
    }
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=vapid_private_key(),
            vapid_claims={"sub": vapid_contact()},
        )
        return True
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in GONE_STATUS_CODES:
            _delete_subscription_by_id(subscription_id=int(subscription["id"]), conn=conn)
            logger.info("Removed expired push subscription id=%s status=%s", subscription["id"], status)
        else:
            logger.warning("Push delivery failed subscription id=%s: %s", subscription["id"], exc)
        return False
    except Exception as exc:
        logger.warning("Push delivery failed subscription id=%s: %s", subscription["id"], exc)
        return False


def send_employee_push(
    *,
    tenant_id: int,
    employee_id: int,
    notification_key: str,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    conn: Any,
) -> dict[str, Any]:
    """Send to all devices for an employee once per notification_key."""
    if not push_configured():
        return {"sent": 0, "skipped": "not_configured"}

    try:
        if not record_push_sent(
            tenant_id=tenant_id,
            employee_id=employee_id,
            notification_key=notification_key,
            conn=conn,
            commit=False,
        ):
            return {"sent": 0, "skipped": "duplicate"}

        subscriptions = list_subscriptions(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    except Exception as exc:
        logger.warning(
            "Push skipped for tenant %s employee %s (%s): %s",
            tenant_id,
            employee_id,
            notification_key,
            exc,
        )
        try:
            conn.rollback()
        except Exception:
            pass
        return {"sent": 0, "skipped": "error"}

    if not subscriptions:
        return {"sent": 0, "skipped": "no_subscription"}

    payload = {
        "title": title,
        "body": body,
        "url": url,
        "tag": tag or notification_key,
    }
    sent = 0
    for sub in subscriptions:
        if send_push(subscription=sub, payload=payload, conn=conn):
            sent += 1
    return {"sent": sent, "devices": len(subscriptions)}
