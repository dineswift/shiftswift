"""EPOS / till integration — device token auth and one-shot PIN punch."""

from __future__ import annotations

import hashlib
import secrets
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Literal

from modules.time_punch.kiosk import _verify_pin
from modules.time_punch.service import (
    PunchType,
    WorkState,
    _insert_time_punch,
    _validate_punch_transition,
    eligible_sites_for_employee,
    last_punch,
    tenant_time_clock_enabled,
    work_state_from_last,
)

EposAction = Literal["in", "out", "break_start", "break_end", "toggle"]
EPOS_PIN_RATE_LIMIT = 10
EPOS_PIN_RATE_WINDOW_SECONDS = 900

_failed_pin_attempts: dict[str, deque[float]] = defaultdict(deque)


class EposPunchError(Exception):
    def __init__(self, error: str, message: str, status_code: int = 403) -> None:
        super().__init__(message)
        self.error = error
        self.message = message
        self.status_code = status_code


def _hash_integration_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_plain_token() -> str:
    return f"sshr_epos_{secrets.token_urlsafe(32)}"


def _token_prefix(token: str) -> str:
    return token[:16]


def _rate_limit_key(*, token_id: int, employee_id: int | None) -> str:
    return f"{token_id}:{employee_id or 'any'}"


def _is_pin_rate_limited(*, token_id: int, employee_id: int | None) -> bool:
    key = _rate_limit_key(token_id=token_id, employee_id=employee_id)
    now = datetime.now(timezone.utc).timestamp()
    window = EPOS_PIN_RATE_WINDOW_SECONDS
    attempts = _failed_pin_attempts[key]
    while attempts and now - attempts[0] > window:
        attempts.popleft()
    return len(attempts) >= EPOS_PIN_RATE_LIMIT


def _record_failed_pin(*, token_id: int, employee_id: int | None) -> None:
    key = _rate_limit_key(token_id=token_id, employee_id=employee_id)
    _failed_pin_attempts[key].append(datetime.now(timezone.utc).timestamp())


def _clear_failed_pin(*, token_id: int, employee_id: int | None) -> None:
    _failed_pin_attempts.pop(_rate_limit_key(token_id=token_id, employee_id=employee_id), None)


def _write_audit(
    *,
    tenant_id: int,
    integration_token_id: int | None,
    event_type: str,
    employee_id: int | None = None,
    external_ref: str | None = None,
    ip_address: str | None = None,
    detail: str | None = None,
    conn: Any,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO epos_integration_audit_log (
              tenant_id, integration_token_id, event_type, employee_id,
              external_ref, ip_address, detail
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                tenant_id,
                integration_token_id,
                event_type,
                employee_id,
                external_ref,
                ip_address,
                detail,
            ),
        )
    conn.commit()


def resolve_integration_token(*, bearer_token: str, conn: Any) -> dict[str, Any]:
    clean = (bearer_token or "").strip()
    if not clean:
        raise EposPunchError("invalid_token", "Invalid integration token", 401)
    token_hash = _hash_integration_token(clean)
    prefix = _token_prefix(clean)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.id, t.tenant_id, t.punch_site_id, t.label, t.is_active,
                   ps.name, ps.latitude, ps.longitude, ps.is_active
            FROM epos_integration_tokens t
            JOIN punch_sites ps ON ps.id = t.punch_site_id
            WHERE t.token_prefix = %s AND t.token_hash = %s
            LIMIT 1
            """,
            (prefix, token_hash),
        )
        row = cur.fetchone()
    if not row or not row[4]:
        raise EposPunchError("invalid_token", "Invalid integration token", 401)
    if not row[8]:
        raise EposPunchError("time_punch_disabled", "Punch site is inactive", 503)
    return {
        "id": int(row[0]),
        "tenant_id": int(row[1]),
        "punch_site_id": int(row[2]),
        "label": row[3],
        "site_name": row[5],
        "latitude": float(row[6]),
        "longitude": float(row[7]),
    }


def touch_integration_token(*, token_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE epos_integration_tokens SET last_used_at = NOW() WHERE id = %s",
            (token_id,),
        )
    conn.commit()


def create_integration_token(
    *,
    tenant_id: int,
    punch_site_id: int,
    label: str,
    created_by: str,
    conn: Any,
) -> dict[str, Any]:
    clean_label = (label or "").strip()
    if not clean_label:
        raise ValueError("Integration label is required")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM punch_sites
            WHERE id = %s AND tenant_id = %s AND is_active = TRUE
            """,
            (punch_site_id, tenant_id),
        )
        if not cur.fetchone():
            raise LookupError("Punch site not found")
    plain = _new_plain_token()
    token_hash = _hash_integration_token(plain)
    prefix = _token_prefix(plain)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO epos_integration_tokens (
              tenant_id, punch_site_id, label, token_prefix, token_hash, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (tenant_id, punch_site_id, clean_label, prefix, token_hash, created_by),
        )
        row = cur.fetchone()
    conn.commit()
    _write_audit(
        tenant_id=tenant_id,
        integration_token_id=int(row[0]),
        event_type="token_created",
        detail=clean_label,
        conn=conn,
    )
    return {
        "id": row[0],
        "label": clean_label,
        "token_prefix": prefix,
        "token": plain,
        "created_at": row[1].isoformat() if isinstance(row[1], datetime) else row[1],
    }


def list_integration_tokens(
    *,
    tenant_id: int,
    punch_site_id: int,
    conn: Any,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, label, token_prefix, is_active, created_at, created_by,
                   revoked_at, last_used_at
            FROM epos_integration_tokens
            WHERE tenant_id = %s AND punch_site_id = %s
            ORDER BY created_at DESC
            """,
            (tenant_id, punch_site_id),
        )
        rows = cur.fetchall()
    items = []
    for row in rows:
        items.append(
            {
                "id": row[0],
                "label": row[1],
                "token_prefix": row[2],
                "is_active": bool(row[3]),
                "created_at": row[4].isoformat() if isinstance(row[4], datetime) else row[4],
                "created_by": row[5],
                "revoked_at": row[6].isoformat() if isinstance(row[6], datetime) else row[6],
                "last_used_at": row[7].isoformat() if isinstance(row[7], datetime) else row[7],
            }
        )
    return items


def revoke_integration_token(
    *,
    tenant_id: int,
    token_id: int,
    revoked_by: str,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE epos_integration_tokens
            SET is_active = FALSE, revoked_at = NOW()
            WHERE id = %s AND tenant_id = %s AND is_active = TRUE
            RETURNING id
            """,
            (token_id, tenant_id),
        )
        row = cur.fetchone()
    if not row:
        return False
    conn.commit()
    _write_audit(
        tenant_id=tenant_id,
        integration_token_id=token_id,
        event_type="token_revoked",
        detail=revoked_by,
        conn=conn,
    )
    return True


def resolve_toggle_punch_type(work_state: WorkState) -> PunchType:
    if work_state == "off":
        return "in"
    if work_state == "clocked_in":
        return "out"
    if work_state == "on_break":
        return "break_end"
    return "in"


def _punch_message(punch_type: PunchType) -> str:
    return {
        "in": "Clocked in",
        "out": "Clocked out",
        "break_start": "Break started",
        "break_end": "Break ended",
    }.get(punch_type, "Punch recorded")


def _find_idempotent_punch(
    *,
    integration_token_id: int,
    external_ref: str,
    conn: Any,
) -> dict[str, Any] | None:
    clean_ref = (external_ref or "").strip()
    if not clean_ref:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT tp.id, tp.tenant_id, tp.employee_id, tp.punch_type, tp.punched_at,
                   tp.punch_method, e.first_name, e.last_name, ps.name
            FROM time_punches tp
            JOIN employees e ON e.id = tp.employee_id
            JOIN punch_sites ps ON ps.id = tp.punch_site_id
            WHERE tp.integration_token_id = %s AND tp.external_ref = %s
            LIMIT 1
            """,
            (integration_token_id, clean_ref),
        )
        row = cur.fetchone()
    if not row:
        return None
    work_state = work_state_from_last({"punch_type": row[3]})
    employee_name = f"{row[6]} {row[7]}".strip()
    punched_at = row[4]
    return {
        "ok": True,
        "punch_id": row[0],
        "employee_id": row[2],
        "employee_name": employee_name,
        "site_id": None,
        "site_name": row[8],
        "punch_type": row[3],
        "punch_method": row[5],
        "work_state": work_state,
        "punched_at": punched_at.isoformat() if isinstance(punched_at, datetime) else punched_at,
        "message": _punch_message(row[3]),
        "idempotent": True,
    }


def site_bootstrap(*, integration: dict[str, Any], conn: Any) -> dict[str, Any]:
    if not tenant_time_clock_enabled(tenant_id=integration["tenant_id"], conn=conn):
        raise EposPunchError("time_punch_disabled", "Time punch is not enabled for this business", 503)
    return {
        "tenant_id": integration["tenant_id"],
        "site_id": integration["punch_site_id"],
        "site_name": integration["site_name"],
        "pin_mode": "employee_id_and_pin",
        "supported_actions": ["in", "out", "break_start", "break_end", "toggle"],
        "integration_label": integration["label"],
    }


def record_epos_punch(
    *,
    integration: dict[str, Any],
    employee_id: int,
    pin: str,
    action: EposAction,
    external_ref: str | None,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    tenant_id = integration["tenant_id"]
    token_id = integration["id"]
    site_id = integration["punch_site_id"]

    if not tenant_time_clock_enabled(tenant_id=tenant_id, conn=conn):
        raise EposPunchError("time_punch_disabled", "Time punch is not enabled for this business", 503)

    existing = _find_idempotent_punch(
        integration_token_id=token_id,
        external_ref=external_ref or "",
        conn=conn,
    )
    if existing:
        existing["site_id"] = site_id
        return existing

    if _is_pin_rate_limited(token_id=token_id, employee_id=employee_id):
        raise EposPunchError("rate_limited", "Too many failed PIN attempts — try again later", 429)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, status, kiosk_pin_hash, email
            FROM employees
            WHERE id = %s AND tenant_id = %s
            """,
            (employee_id, tenant_id),
        )
        row = cur.fetchone()
    if not row:
        _record_failed_pin(token_id=token_id, employee_id=employee_id)
        _write_audit(
            tenant_id=tenant_id,
            integration_token_id=token_id,
            event_type="punch_failed",
            employee_id=employee_id,
            external_ref=external_ref,
            ip_address=ip_address,
            detail="employee_not_found",
            conn=conn,
        )
        raise EposPunchError("incorrect_pin", "Incorrect PIN", 403)
    if row[3] not in {"active", "onboarding"}:
        raise EposPunchError("employee_inactive", "Employee is not active", 403)
    if not _verify_pin(pin_hash=row[4], pin=(pin or "").strip()):
        _record_failed_pin(token_id=token_id, employee_id=employee_id)
        _write_audit(
            tenant_id=tenant_id,
            integration_token_id=token_id,
            event_type="punch_failed",
            employee_id=employee_id,
            external_ref=external_ref,
            ip_address=ip_address,
            detail="incorrect_pin",
            conn=conn,
        )
        raise EposPunchError("incorrect_pin", "Incorrect PIN", 403)

    if not any(
        s["id"] == site_id
        for s in eligible_sites_for_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    ):
        raise EposPunchError("site_not_assigned", "Employee is not assigned to this punch site", 403)

    _clear_failed_pin(token_id=token_id, employee_id=employee_id)

    prior = last_punch(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    work_state = work_state_from_last(prior)
    punch_type: PunchType
    if action == "toggle":
        punch_type = resolve_toggle_punch_type(work_state)
    else:
        punch_type = action

    try:
        _validate_punch_transition(
            tenant_id=tenant_id,
            employee_id=employee_id,
            punch_type=punch_type,
            conn=conn,
        )
    except ValueError as exc:
        raise EposPunchError("invalid_transition", str(exc), 409) from exc

    result = _insert_time_punch(
        tenant_id=tenant_id,
        employee_id=employee_id,
        punch_site_id=site_id,
        punch_type=punch_type,
        latitude=integration["latitude"],
        longitude=integration["longitude"],
        accuracy_meters=None,
        distance_meters=0.0,
        app_username=row[5] or f"employee:{employee_id}",
        ip_address=ip_address,
        user_agent=user_agent or "epos",
        punch_method="epos",
        conn=conn,
        external_ref=(external_ref or "").strip() or None,
        integration_token_id=token_id,
    )
    touch_integration_token(token_id=token_id, conn=conn)
    _write_audit(
        tenant_id=tenant_id,
        integration_token_id=token_id,
        event_type="punch_success",
        employee_id=employee_id,
        external_ref=external_ref,
        ip_address=ip_address,
        detail=punch_type,
        conn=conn,
    )
    return {
        "ok": True,
        "punch_id": result["id"],
        "employee_id": employee_id,
        "employee_name": f"{row[1]} {row[2]}".strip(),
        "site_id": site_id,
        "site_name": integration["site_name"],
        "punch_type": punch_type,
        "punch_method": "epos",
        "work_state": result["work_state"],
        "punched_at": result["punched_at"],
        "message": _punch_message(punch_type),
        "idempotent": False,
    }
