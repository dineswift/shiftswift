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


def _employee_push_already_sent(
    *,
    tenant_id: int,
    employee_id: int,
    notification_key: str,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM push_notification_log
            WHERE tenant_id = %s AND employee_id = %s AND notification_key = %s
            LIMIT 1
            """,
            (tenant_id, employee_id, notification_key),
        )
        return cur.fetchone() is not None


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
    subscription_kind: str = "employee",
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
            if subscription_kind == "admin":
                _delete_admin_subscription_by_id(subscription_id=int(subscription["id"]), conn=conn)
            else:
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
    alert_type: str | None = None,
    conn: Any,
) -> dict[str, Any]:
    """Send to all devices for an employee once per notification_key."""
    if not push_configured():
        return {"sent": 0, "skipped": "not_configured"}

    try:
        if _employee_push_already_sent(
            tenant_id=tenant_id,
            employee_id=employee_id,
            notification_key=notification_key,
            conn=conn,
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

    resolved_alert_type = alert_type or "general"
    clock_alert_types = frozenset(
        {
            "shift_reminder",
            "shift_end_reminder",
            "clock_in",
            "clock_out",
            "missed_clock_in",
            "missed_clock_in_early",
        }
    )
    payload = {
        "title": title,
        "body": body,
        "url": url,
        "tag": tag or notification_key,
        "alert_type": resolved_alert_type,
        "urgent": resolved_alert_type in clock_alert_types,
    }
    sent = 0
    for sub in subscriptions:
        if send_push(subscription=sub, payload=payload, conn=conn):
            sent += 1
    if sent > 0:
        record_push_sent(
            tenant_id=tenant_id,
            employee_id=employee_id,
            notification_key=notification_key,
            conn=conn,
            commit=False,
        )
    _record_employee_in_app(
        tenant_id=tenant_id,
        employee_id=employee_id,
        title=title,
        body=body,
        url=url,
        alert_type=resolved_alert_type,
        conn=conn,
    )
    try:
        conn.commit()
    except Exception:
        pass
    return {"sent": sent, "devices": len(subscriptions)}


def _employee_username(*, tenant_id: int, employee_id: int, conn: Any) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT NULLIF(TRIM(email), '')
            FROM employees
            WHERE tenant_id = %s AND id = %s
            LIMIT 1
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
    return str(row[0]).strip() if row and row[0] else None


def create_in_app_notification(
    *,
    tenant_id: int,
    audience: str,
    recipient_username: str,
    title: str,
    body: str,
    url: str | None = None,
    alert_type: str | None = None,
    employee_id: int | None = None,
    conn: Any,
    commit: bool = True,
) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO in_app_notifications (
              tenant_id, audience, recipient_username, employee_id,
              title, body, url, alert_type
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                tenant_id,
                audience,
                recipient_username.strip().lower(),
                employee_id,
                title,
                body,
                url,
                alert_type,
            ),
        )
        row = cur.fetchone()
    if commit:
        conn.commit()
    return int(row[0]) if row else None


def _record_employee_in_app(
    *,
    tenant_id: int,
    employee_id: int,
    title: str,
    body: str,
    url: str,
    alert_type: str,
    conn: Any,
) -> None:
    username = _employee_username(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not username:
        return
    create_in_app_notification(
        tenant_id=tenant_id,
        audience="employee",
        recipient_username=username,
        employee_id=employee_id,
        title=title,
        body=body,
        url=url,
        alert_type=alert_type,
        conn=conn,
        commit=False,
    )


def upsert_admin_subscription(
    *,
    tenant_id: int,
    username: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO admin_push_subscriptions (
              tenant_id, username, endpoint, p256dh, auth, user_agent, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (tenant_id, username, endpoint) DO UPDATE SET
              p256dh = EXCLUDED.p256dh,
              auth = EXCLUDED.auth,
              user_agent = EXCLUDED.user_agent,
              updated_at = NOW()
            RETURNING id, created_at, updated_at
            """,
            (tenant_id, username.strip().lower(), endpoint, p256dh, auth, user_agent),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "id": row[0],
        "created_at": row[1].isoformat() if row[1] else None,
        "updated_at": row[2].isoformat() if row[2] else None,
    }


def delete_admin_subscription(
    *,
    tenant_id: int,
    username: str,
    endpoint: str,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM admin_push_subscriptions
            WHERE tenant_id = %s AND lower(username) = lower(%s) AND endpoint = %s
            """,
            (tenant_id, username, endpoint),
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_admin_subscriptions(
    *,
    tenant_id: int,
    username: str,
    conn: Any,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, endpoint, p256dh, auth, user_agent, updated_at
            FROM admin_push_subscriptions
            WHERE tenant_id = %s AND lower(username) = lower(%s)
            ORDER BY updated_at DESC
            """,
            (tenant_id, username),
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


def list_tenant_admin_subscriptions(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, username, endpoint, p256dh, auth, user_agent, updated_at
            FROM admin_push_subscriptions
            WHERE tenant_id = %s
            ORDER BY updated_at DESC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "username": row[1],
            "endpoint": row[2],
            "p256dh": row[3],
            "auth": row[4],
            "user_agent": row[5],
            "updated_at": row[6].isoformat() if row[6] else None,
        }
        for row in rows
    ]


def _delete_admin_subscription_by_id(*, subscription_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM admin_push_subscriptions WHERE id = %s", (subscription_id,))
    conn.commit()


def _admin_push_already_sent(
    *,
    tenant_id: int,
    username: str,
    notification_key: str,
    conn: Any,
) -> bool:
    normalized = username.strip().lower()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM admin_push_notification_log
            WHERE tenant_id = %s AND username = %s AND notification_key = %s
            LIMIT 1
            """,
            (tenant_id, normalized, notification_key),
        )
        return cur.fetchone() is not None


def record_admin_push_sent(
    *,
    tenant_id: int,
    username: str,
    notification_key: str,
    conn: Any,
    commit: bool = True,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO admin_push_notification_log (tenant_id, username, notification_key)
            VALUES (%s, %s, %s)
            ON CONFLICT (tenant_id, username, notification_key) DO NOTHING
            RETURNING id
            """,
            (tenant_id, username.strip().lower(), notification_key),
        )
        row = cur.fetchone()
    if commit:
        conn.commit()
    return row is not None


def send_admin_push(
    *,
    tenant_id: int,
    username: str,
    notification_key: str,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    alert_type: str | None = None,
    conn: Any,
) -> dict[str, Any]:
    if not push_configured():
        return {"sent": 0, "skipped": "not_configured"}

    normalized = username.strip().lower()
    try:
        if _admin_push_already_sent(
            tenant_id=tenant_id,
            username=normalized,
            notification_key=notification_key,
            conn=conn,
        ):
            return {"sent": 0, "skipped": "duplicate"}

        subscriptions = list_admin_subscriptions(
            tenant_id=tenant_id,
            username=normalized,
            conn=conn,
        )
    except Exception as exc:
        logger.warning(
            "Admin push skipped for tenant %s user %s (%s): %s",
            tenant_id,
            normalized,
            notification_key,
            exc,
        )
        try:
            conn.rollback()
        except Exception:
            pass
        return {"sent": 0, "skipped": "error"}

    resolved_alert_type = alert_type or "general"
    hr_alert_types = frozenset(
        {"missed_punch_hr", "leave_request", "rtw_expiry", "general"}
    )
    payload = {
        "title": title,
        "body": body,
        "url": url,
        "tag": tag or notification_key,
        "alert_type": resolved_alert_type,
        "urgent": resolved_alert_type in hr_alert_types,
    }
    sent = 0
    for sub in subscriptions:
        sub_row = {**sub, "id": sub["id"]}
        if send_push(subscription=sub_row, payload=payload, conn=conn, subscription_kind="admin"):
            sent += 1
    if sent > 0:
        record_admin_push_sent(
            tenant_id=tenant_id,
            username=normalized,
            notification_key=notification_key,
            conn=conn,
            commit=False,
        )
    create_in_app_notification(
        tenant_id=tenant_id,
        audience="hr",
        recipient_username=normalized,
        title=title,
        body=body,
        url=url,
        alert_type=resolved_alert_type,
        conn=conn,
        commit=False,
    )
    try:
        conn.commit()
    except Exception:
        pass
    return {"sent": sent, "devices": len(subscriptions)}


def broadcast_admin_push(
    *,
    tenant_id: int,
    notification_key: str,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    alert_type: str | None = None,
    conn: Any,
) -> dict[str, Any]:
    """Send to every HR admin device subscribed for this tenant."""
    subs = list_tenant_admin_subscriptions(tenant_id=tenant_id, conn=conn)
    usernames = sorted({str(s["username"]).strip().lower() for s in subs if s.get("username")})
    total_sent = 0
    for username in usernames:
        result = send_admin_push(
            tenant_id=tenant_id,
            username=username,
            notification_key=f"{notification_key}:{username}",
            title=title,
            body=body,
            url=url,
            tag=tag,
            alert_type=alert_type,
            conn=conn,
        )
        total_sent += int(result.get("sent") or 0)
    return {"sent": total_sent, "recipients": len(usernames)}


def list_in_app_notifications(
    *,
    tenant_id: int,
    audience: str,
    recipient_username: str,
    conn: Any,
    limit: int = 40,
    unread_only: bool = False,
) -> list[dict[str, Any]]:
    query = """
        SELECT id, title, body, url, alert_type, read_at, created_at
        FROM in_app_notifications
        WHERE tenant_id = %s AND audience = %s AND lower(recipient_username) = lower(%s)
    """
    params: list[Any] = [tenant_id, audience, recipient_username]
    if unread_only:
        query += " AND read_at IS NULL"
    query += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "title": row[1],
            "body": row[2],
            "url": row[3],
            "alert_type": row[4],
            "read_at": row[5].isoformat() if row[5] else None,
            "created_at": row[6].isoformat() if row[6] else None,
        }
        for row in rows
    ]


def count_unread_in_app(
    *,
    tenant_id: int,
    audience: str,
    recipient_username: str,
    conn: Any,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM in_app_notifications
            WHERE tenant_id = %s AND audience = %s AND lower(recipient_username) = lower(%s)
              AND read_at IS NULL
            """,
            (tenant_id, audience, recipient_username),
        )
        row = cur.fetchone()
    return int(row[0] or 0) if row else 0


def mark_in_app_read(
    *,
    tenant_id: int,
    audience: str,
    recipient_username: str,
    notification_id: int,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE in_app_notifications
            SET read_at = NOW()
            WHERE id = %s AND tenant_id = %s AND audience = %s
              AND lower(recipient_username) = lower(%s) AND read_at IS NULL
            """,
            (notification_id, tenant_id, audience, recipient_username),
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def mark_all_in_app_read(
    *,
    tenant_id: int,
    audience: str,
    recipient_username: str,
    conn: Any,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE in_app_notifications
            SET read_at = NOW()
            WHERE tenant_id = %s AND audience = %s AND lower(recipient_username) = lower(%s)
              AND read_at IS NULL
            """,
            (tenant_id, audience, recipient_username),
        )
        count = cur.rowcount
    conn.commit()
    return count
