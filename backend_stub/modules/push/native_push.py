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
_APNS_JWT_CACHE: dict[str, Any] = {"token": None, "exp": 0}


def _apns_bearer_token() -> str:
    """Build a short-lived APNs provider JWT (ES256) using PyJWT — no apns2 dependency."""
    import time

    import jwt

    now = int(time.time())
    cached = _APNS_JWT_CACHE.get("token")
    if cached and int(_APNS_JWT_CACHE.get("exp") or 0) > now + 60:
        return str(cached)

    key_path = os.environ["APNS_KEY_PATH"]
    key_id = os.environ["APNS_KEY_ID"]
    team_id = os.environ["APNS_TEAM_ID"]
    with open(key_path, "r", encoding="utf-8") as handle:
        key_pem = handle.read()

    token = jwt.encode(
        {"iss": team_id, "iat": now},
        key_pem,
        algorithm="ES256",
        headers={"alg": "ES256", "kid": key_id},
    )
    if isinstance(token, bytes):
        token = token.decode("ascii")
    _APNS_JWT_CACHE["token"] = token
    _APNS_JWT_CACHE["exp"] = now + 50 * 60
    return token


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
        import httpx

        bundle_id = os.getenv("APNS_BUNDLE_ID", "co.uk.shiftswifthr.app")
        use_sandbox = os.getenv("APNS_USE_SANDBOX", "false").lower() in {"1", "true", "yes"}
        host = "api.sandbox.push.apple.com" if use_sandbox else "api.push.apple.com"
        url = f"https://{host}/3/device/{device_token}"
        payload = {
            "aps": {
                "alert": {"title": title, "body": body},
                "sound": NOTIFICATION_SOUND,
            },
            **{str(k): str(v) for k, v in (data or {}).items()},
        }
        headers = {
            "authorization": f"bearer {_apns_bearer_token()}",
            "apns-topic": bundle_id,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "content-type": "application/json",
        }
        with httpx.Client(http2=True, timeout=20.0) as client:
            response = client.post(url, json=payload, headers=headers)
        if response.status_code == 200:
            return True
        logger.warning(
            "APNs delivery failed (%s): %s",
            response.status_code,
            (response.text or "")[:300],
        )
        if response.status_code in {400, 410}:
            raise RuntimeError(f"APNs status {response.status_code}")
        return False
    except Exception as exc:
        logger.warning("APNs delivery failed: %s", exc)
        status = getattr(exc, "status", None) or getattr(exc, "status_code", None)
        if status in {400, 410} or "APNs status 400" in str(exc) or "APNs status 410" in str(exc):
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
