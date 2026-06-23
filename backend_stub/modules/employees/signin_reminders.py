"""Periodic employee portal sign-in reminders — email + push, tenant-configurable."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from modules.employees.notification_branding import employee_notification_from_name
from modules.push.service import app_url_path, send_employee_push

UK_TZ = ZoneInfo("Europe/London")
DEFAULT_INTERVAL_DAYS = 30
DEFAULT_HOUR_UK = 9
TRIGGER_WINDOW_MINUTES = 20
SIGNIN_DELIVERY_MODES = frozenset({"email", "push", "email_push", "off"})


def _parse_signin_config(stored: Any) -> dict[str, Any]:
    raw = stored if isinstance(stored, dict) else {}
    delivery = str(raw.get("employee_signin_reminder") or "email_push").strip().lower()
    if delivery not in SIGNIN_DELIVERY_MODES:
        delivery = "email_push"
    try:
        interval = int(raw.get("signin_reminder_interval_days") or DEFAULT_INTERVAL_DAYS)
    except (TypeError, ValueError):
        interval = DEFAULT_INTERVAL_DAYS
    interval = max(7, min(365, interval))
    try:
        hour_uk = int(raw.get("signin_reminder_hour_uk") if raw.get("signin_reminder_hour_uk") is not None else DEFAULT_HOUR_UK)
    except (TypeError, ValueError):
        hour_uk = DEFAULT_HOUR_UK
    hour_uk = max(0, min(23, hour_uk))
    return {"delivery": delivery, "interval_days": interval, "hour_uk": hour_uk}


def get_signin_reminder_config(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT notification_preferences FROM tenants WHERE id = %s",
            (tenant_id,),
        )
        row = cur.fetchone()
    return _parse_signin_config(row[0] if row else None)


def _within_send_window(*, now: datetime, hour_uk: int) -> bool:
    local = now.astimezone(UK_TZ)
    target = local.replace(hour=hour_uk, minute=0, second=0, microsecond=0)
    delta_minutes = abs((local - target).total_seconds()) / 60.0
    return delta_minutes <= TRIGGER_WINDOW_MINUTES


def _last_login_at(*, tenant_id: int, username: str, conn: Any) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(created_at)
            FROM security_audit_events
            WHERE tenant_id = %s
              AND event_type = 'login_success'
              AND success = TRUE
              AND lower(username) = lower(%s)
            """,
            (tenant_id, username),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    value = row[0]
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def _account_created_at(*, tenant_id: int, username: str, conn: Any) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT created_at FROM app_users
            WHERE tenant_id = %s
              AND role = 'employee'
              AND lower(username) = lower(%s)
              AND is_active = TRUE
            LIMIT 1
            """,
            (tenant_id, username),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    value = row[0]
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def _recent_reminder_sent(
    *,
    tenant_id: int,
    employee_id: int,
    within_days: int,
    conn: Any,
    now: datetime,
) -> bool:
    cutoff = now - timedelta(days=within_days)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM signin_reminder_log
            WHERE tenant_id = %s AND employee_id = %s AND sent_at >= %s
            LIMIT 1
            """,
            (tenant_id, employee_id, cutoff),
        )
        return cur.fetchone() is not None


def _log_reminder(
    *,
    tenant_id: int,
    employee_id: int,
    channel: str,
    days_idle: int,
    conn: Any,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO signin_reminder_log (tenant_id, employee_id, channel, days_idle)
            VALUES (%s, %s, %s, %s)
            """,
            (tenant_id, employee_id, channel, days_idle),
        )


def _list_reminder_candidates(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT e.id, e.first_name, e.last_name, e.email
            FROM employees e
            WHERE e.tenant_id = %s
              AND e.status IN ('active', 'onboarding')
              AND e.email IS NOT NULL
              AND TRIM(e.email) <> ''
              AND EXISTS (
                SELECT 1 FROM app_users u
                WHERE u.tenant_id = e.tenant_id
                  AND u.role = 'employee'
                  AND lower(u.username) = lower(e.email)
                  AND u.is_active = TRUE
              )
            ORDER BY e.id
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": int(row[0]),
            "first_name": row[1] or "",
            "last_name": row[2] or "",
            "email": row[3] or "",
        }
        for row in rows
    ]


def evaluate_signin_reminders(
    *,
    tenant_id: int,
    conn: Any,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Send sign-in nudges to employees idle longer than tenant interval."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    config = get_signin_reminder_config(tenant_id=tenant_id, conn=conn)
    if config["delivery"] == "off":
        return []

    if not _within_send_window(now=now, hour_uk=config["hour_uk"]):
        return []

    interval_days = int(config["interval_days"])
    tenant_name = employee_notification_from_name(tenant_id=tenant_id, conn=conn)
    login_url = app_url_path("employee-login.html")
    portal_url = app_url_path("employee.html")
    sent: list[dict[str, Any]] = []

    for employee in _list_reminder_candidates(tenant_id=tenant_id, conn=conn):
        employee_id = employee["id"]
        email = employee["email"].strip()
        if not email:
            continue

        if _recent_reminder_sent(
            tenant_id=tenant_id,
            employee_id=employee_id,
            within_days=interval_days,
            conn=conn,
            now=now,
        ):
            continue

        last_login = _last_login_at(tenant_id=tenant_id, username=email, conn=conn)
        baseline = last_login or _account_created_at(tenant_id=tenant_id, username=email, conn=conn)
        if not baseline:
            continue

        days_idle = int((now - baseline).total_seconds() // 86400)
        if days_idle < interval_days:
            continue

        first_name = (employee.get("first_name") or "").strip() or "there"
        title = f"Sign in to {tenant_name}"
        body = (
            f"You have not signed in to the employee portal for {days_idle} days. "
            "Open shifts, clock in, and view payslips."
        )
        channels_used: list[str] = []
        delivery = config["delivery"]

        if delivery in {"email", "email_push"}:
            from core.email_templates import employee_signin_reminder_email
            from core.notifications import send_email_content

            content = employee_signin_reminder_email(
                employee_name=first_name,
                tenant_name=tenant_name,
                days_idle=days_idle,
                login_url=login_url,
            )
            send_email_content(
                conn=conn,
                tenant_id=tenant_id,
                content=content,
                purpose="general",
                to=email,
                audience="employee",
                deliver_now=True,
                commit=False,
            )
            channels_used.append("email")

        if delivery in {"push", "email_push"}:
            notification_key = f"signin_reminder:{employee_id}:{now.astimezone(UK_TZ).date().isoformat()}"
            push_result = send_employee_push(
                tenant_id=tenant_id,
                employee_id=employee_id,
                notification_key=notification_key,
                title=title,
                body=body,
                url=portal_url,
                tag=f"signin-{employee_id}",
                conn=conn,
            )
            if push_result.get("sent"):
                channels_used.append("push")

        if not channels_used:
            continue

        _log_reminder(
            tenant_id=tenant_id,
            employee_id=employee_id,
            channel="+".join(channels_used),
            days_idle=days_idle,
            conn=conn,
        )
        conn.commit()
        sent.append(
            {
                "employee_id": employee_id,
                "days_idle": days_idle,
                "channels": channels_used,
            }
        )

    return sent
