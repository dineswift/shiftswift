"""Native push delivery — FCM (Android) and APNs (iOS)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

GONE_FCM_ERRORS = frozenset(
    {
        "NOT_FOUND",
        "UNREGISTERED",
        "INVALID_ARGUMENT",
    }
)


def fcm_configured() -> bool:
    path = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
    return bool(path and os.path.isfile(path))


def apns_configured() -> bool:
    key_path = (os.getenv("APNS_KEY_PATH") or "").strip()
    key_id = (os.getenv("APNS_KEY_ID") or "").strip()
    team_id = (os.getenv("APNS_TEAM_ID") or "").strip()
    return bool(key_path and key_id and team_id and os.path.isfile(key_path))


def native_push_configured() -> bool:
    return fcm_configured() or apns_configured()


def upsert_native_device(
    *,
    tenant_id: int,
    employee_id: int,
    platform: str,
    device_token: str,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO native_push_devices (
              tenant_id, employee_id, platform, device_token, user_agent, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (employee_id, platform, device_token) DO UPDATE SET
              user_agent = EXCLUDED.user_agent,
              updated_at = NOW()
            RETURNING id, created_at, updated_at
            """,
            (tenant_id, employee_id, platform, device_token, user_agent),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "id": row[0],
        "created_at": row[1].isoformat() if row[1] else None,
        "updated_at": row[2].isoformat() if row[2] else None,
    }


def delete_native_device(
    *,
    tenant_id: int,
    employee_id: int,
    platform: str,
    device_token: str,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM native_push_devices
            WHERE tenant_id = %s AND employee_id = %s AND platform = %s AND device_token = %s
            """,
            (tenant_id, employee_id, platform, device_token),
        )
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def list_native_devices(
    *,
    tenant_id: int,
    employee_id: int,
    conn: Any,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, platform, device_token, user_agent, updated_at
            FROM native_push_devices
            WHERE tenant_id = %s AND employee_id = %s
            ORDER BY updated_at DESC
            """,
            (tenant_id, employee_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "platform": row[1],
            "device_token": row[2],
            "user_agent": row[3],
            "updated_at": row[4].isoformat() if row[4] else None,
        }
        for row in rows
    ]


def _delete_native_device_by_id(*, device_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM native_push_devices WHERE id = %s", (device_id,))
    conn.commit()


def _fcm_app():
    import firebase_admin
    from firebase_admin import credentials

    path = os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"]
    if not firebase_admin._apps:
        cred = credentials.Certificate(path)
        firebase_admin.initialize_app(cred)
    return firebase_admin.get_app()


NOTIFICATION_SOUND = os.getenv("APNS_NOTIFICATION_SOUND", "shiftswift_alert.caf")


def send_fcm(
    *,
    device_token: str,
    title: str,
    body: str,
    data: dict[str, str],
) -> bool:
    if not fcm_configured():
        return False
    try:
        from firebase_admin import messaging

        _fcm_app()
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in data.items()},
            token=device_token,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id="shiftswift_hr_alerts",
                    sound="shiftswift_alert",
                ),
            ),
        )
        messaging.send(message)
        return True
    except Exception as exc:
        code = getattr(exc, "code", None) or getattr(exc, "http_response", None)
        logger.warning("FCM delivery failed: %s", exc)
        if str(getattr(exc, "code", "")) in GONE_FCM_ERRORS:
            raise
        return False


def send_apns(
    *,
    device_token: str,
    title: str,
    body: str,
    data: dict[str, str],
) -> bool:
    if not apns_configured():
        return False
    try:
        from apns2.client import APNsClient
        from apns2.payload import Payload

        bundle_id = os.getenv("APNS_BUNDLE_ID", "co.uk.shiftswifthr.app")
        use_sandbox = os.getenv("APNS_USE_SANDBOX", "false").lower() in {"1", "true", "yes"}
        client = APNsClient(
            os.environ["APNS_KEY_PATH"],
            use_alternative_port=False,
            use_sandbox=use_sandbox,
        )
        payload = Payload(
            alert={"title": title, "body": body},
            sound=NOTIFICATION_SOUND,
            custom=data,
        )
        client.send_notification(
            device_token,
            payload,
            topic=bundle_id,
            priority=10,
        )
        return True
    except Exception as exc:
        logger.warning("APNs delivery failed: %s", exc)
        status = getattr(exc, "status", None)
        if status in {400, 410}:
            raise
        return False


def send_native_push(
    *,
    device: dict[str, Any],
    title: str,
    body: str,
    url: str,
    tag: str | None,
    alert_type: str | None,
    conn: Any,
) -> bool:
    data = {
        "url": url,
        "tag": tag or "",
        "alert_type": alert_type or "general",
    }
    platform = device["platform"]
    token = device["device_token"]
    try:
        if platform == "android":
            return send_fcm(device_token=token, title=title, body=body, data=data)
        if platform == "ios":
            return send_apns(device_token=token, title=title, body=body, data=data)
    except Exception:
        _delete_native_device_by_id(device_id=int(device["id"]), conn=conn)
        return False
    return False


def send_employee_native_push(
    *,
    tenant_id: int,
    employee_id: int,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    alert_type: str | None = None,
    conn: Any,
) -> dict[str, Any]:
    if not native_push_configured():
        return {"sent": 0, "skipped": "not_configured"}

    devices = list_native_devices(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not devices:
        return {"sent": 0, "skipped": "no_device"}

    sent = 0
    for device in devices:
        if send_native_push(
            device=device,
            title=title,
            body=body,
            url=url,
            tag=tag,
            alert_type=alert_type,
            conn=conn,
        ):
            sent += 1
    return {"sent": sent}


def upsert_admin_native_device(
    *,
    tenant_id: int,
    username: str,
    platform: str,
    device_token: str,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    normalized = username.strip().lower()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO admin_native_push_devices (
              tenant_id, username, platform, device_token, user_agent, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (tenant_id, username, platform, device_token)
            DO UPDATE SET
              user_agent = EXCLUDED.user_agent,
              updated_at = NOW()
            RETURNING id, created_at, updated_at
            """,
            (tenant_id, normalized, platform, device_token, user_agent),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "id": row[0],
        "created_at": row[1].isoformat() if row[1] else None,
        "updated_at": row[2].isoformat() if row[2] else None,
    }


def list_admin_native_devices(
    *,
    tenant_id: int,
    username: str,
    conn: Any,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, platform, device_token, user_agent, updated_at
            FROM admin_native_push_devices
            WHERE tenant_id = %s AND lower(username) = lower(%s)
            ORDER BY updated_at DESC
            """,
            (tenant_id, username.strip()),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "platform": row[1],
            "device_token": row[2],
            "user_agent": row[3],
            "updated_at": row[4].isoformat() if row[4] else None,
        }
        for row in rows
    ]


def _delete_admin_native_device_by_id(*, device_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM admin_native_push_devices WHERE id = %s", (device_id,))
    conn.commit()


def send_admin_native_push(
    *,
    tenant_id: int,
    username: str,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    alert_type: str | None = None,
    conn: Any,
) -> dict[str, Any]:
    if not native_push_configured():
        return {"sent": 0, "skipped": "not_configured"}

    devices = list_admin_native_devices(tenant_id=tenant_id, username=username, conn=conn)
    if not devices:
        return {"sent": 0, "skipped": "no_device"}

    sent = 0
    for device in devices:
        data = {
            "url": url,
            "tag": tag or "",
            "alert_type": alert_type or "general",
        }
        platform = device["platform"]
        token = device["device_token"]
        try:
            ok = False
            if platform == "android":
                ok = send_fcm(device_token=token, title=title, body=body, data=data)
            elif platform == "ios":
                ok = send_apns(device_token=token, title=title, body=body, data=data)
            if ok:
                sent += 1
        except Exception:
            _delete_admin_native_device_by_id(device_id=int(device["id"]), conn=conn)
    return {"sent": sent}
