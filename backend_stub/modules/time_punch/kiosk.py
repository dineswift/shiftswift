"""Shared tablet kiosk clock-in — site QR + employee PIN."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from auth_service import verify_password
from modules.time_punch.service import (
    PunchType,
    _insert_time_punch,
    _validate_punch_transition,
    eligible_sites_for_employee,
    last_punch,
    resolve_site_by_clock_token,
    work_state_from_last,
)

KIOSK_SESSION_MINUTES = 8


def set_employee_kiosk_pin(
    *,
    tenant_id: int,
    employee_id: int,
    pin: str | None,
    conn: Any,
) -> None:
    from auth_service import hash_password

    clean = (pin or "").strip()
    if clean and (not clean.isdigit() or not 4 <= len(clean) <= 6):
        raise ValueError("Kiosk PIN must be 4–6 digits")
    pin_hash = hash_password(clean) if clean else None
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE employees SET kiosk_pin_hash = %s, updated_at = NOW()
            WHERE id = %s AND tenant_id = %s
            RETURNING id
            """,
            (pin_hash, employee_id, tenant_id),
        )
        if not cur.fetchone():
            raise LookupError("Employee not found")
    conn.commit()


def _verify_pin(*, pin_hash: str | None, pin: str) -> bool:
    if not pin_hash:
        return False
    return verify_password(pin, pin_hash)


def create_kiosk_session(
    *,
    clock_token: str,
    employee_id: int,
    pin: str,
    conn: Any,
) -> dict[str, Any]:
    site = resolve_site_by_clock_token(clock_token=clock_token, conn=conn)
    if not site:
        raise LookupError("Invalid premises code")
    tenant_id = int(site["tenant_id"])

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, status, kiosk_pin_hash
            FROM employees
            WHERE id = %s AND tenant_id = %s
            """,
            (employee_id, tenant_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Employee not found")
    if row[3] not in {"active", "onboarding"}:
        raise PermissionError("Employee is not active")
    if not _verify_pin(pin_hash=row[4], pin=(pin or "").strip()):
        raise PermissionError("Incorrect PIN")

    if not any(s["id"] == site["id"] for s in eligible_sites_for_employee(
        tenant_id=tenant_id, employee_id=employee_id, conn=conn
    )):
        raise PermissionError(f"You are not assigned to punch at {site['name']}")

    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=KIOSK_SESSION_MINUTES)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO kiosk_punch_sessions (
              session_token, tenant_id, employee_id, punch_site_id, expires_at
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (token, tenant_id, employee_id, site["id"], expires_at),
        )
    conn.commit()
    prior = last_punch(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    work_state = work_state_from_last(prior)
    return {
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "employee_id": employee_id,
        "employee_name": f"{row[1]} {row[2]}".strip(),
        "site_id": site["id"],
        "site_name": site["name"],
        "work_state": work_state,
    }


def _resolve_session(*, session_token: str, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ks.session_token, ks.tenant_id, ks.employee_id, ks.punch_site_id, ks.expires_at,
                   e.first_name, e.last_name, e.email, ps.name
            FROM kiosk_punch_sessions ks
            JOIN employees e ON e.id = ks.employee_id
            JOIN punch_sites ps ON ps.id = ks.punch_site_id
            WHERE ks.session_token = %s
            """,
            (session_token.strip(),),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Session expired — sign in again")
    expires_at = row[4]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise LookupError("Session expired — sign in again")
    return {
        "session_token": row[0],
        "tenant_id": int(row[1]),
        "employee_id": int(row[2]),
        "punch_site_id": int(row[3]),
        "employee_name": f"{row[5]} {row[6]}".strip(),
        "app_username": row[7] or f"employee:{row[2]}",
        "site_name": row[8],
    }


def record_kiosk_punch(
    *,
    session_token: str,
    punch_type: PunchType,
    conn: Any,
) -> dict[str, Any]:
    session = _resolve_session(session_token=session_token, conn=conn)
    _validate_punch_transition(
        tenant_id=session["tenant_id"],
        employee_id=session["employee_id"],
        punch_type=punch_type,
        conn=conn,
    )
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT latitude, longitude FROM punch_sites
            WHERE id = %s AND tenant_id = %s
            """,
            (session["punch_site_id"], session["tenant_id"]),
        )
        site_row = cur.fetchone()
    if not site_row:
        raise LookupError("Punch site not found")

    result = _insert_time_punch(
        tenant_id=session["tenant_id"],
        employee_id=session["employee_id"],
        punch_site_id=session["punch_site_id"],
        punch_type=punch_type,
        latitude=float(site_row[0]),
        longitude=float(site_row[1]),
        accuracy_meters=None,
        distance_meters=0.0,
        app_username=session["app_username"],
        ip_address=None,
        user_agent="kiosk",
        punch_method="kiosk",
        conn=conn,
    )
    from modules.time_punch.service import work_state_from_last

    result["employee_name"] = session["employee_name"]
    result["site_name"] = session["site_name"]
    result["work_state"] = work_state_from_last(
        {"punch_type": punch_type, "punched_at": result["punched_at"]}
    )
    return result


def kiosk_site_bootstrap(*, clock_token: str, conn: Any) -> dict[str, Any]:
    site = resolve_site_by_clock_token(clock_token=clock_token, conn=conn)
    if not site:
        raise LookupError("Invalid premises code")
    return {
        "site_id": site["id"],
        "site_name": site["name"],
        "tenant_id": site["tenant_id"],
    }
