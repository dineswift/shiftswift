"""Digital Right to Work verification via IDSP or development mock."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

VISA_EXPIRY_KEYS = frozenset(
    {
        "visa_expiry_date",
        "visaexpirydate",
        "leave_expiry_date",
        "leaveexpirydate",
        "brp_expiry_date",
        "brpexpirydate",
        "status_end_date",
        "statusenddate",
        "permission_end_date",
        "permissionenddate",
    }
)
RTW_CHECK_EXPIRY_KEYS = frozenset(
    {
        "rtw_check_expiry_date",
        "check_expiry_date",
        "checkexpirydate",
        "permission_to_work_expiry",
        "permission_expiry_date",
        "work_until",
        "workuntil",
        "right_to_work_expiry",
        "righttoworkexpiry",
        "expiry_date",
        "expirydate",
    }
)


class IdspError(Exception):
    pass


def _as_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _first_date(payload: Any, keys: frozenset[str]) -> date | None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if str(key).lower().replace("-", "_") in keys:
                parsed = _as_date(value)
                if parsed:
                    return parsed
            nested = _first_date(value, keys)
            if nested:
                return nested
    elif isinstance(payload, list):
        for item in payload:
            nested = _first_date(item, keys)
            if nested:
                return nested
    return None


def parse_idsp_expiry_dates(payload: dict[str, Any] | None) -> dict[str, date | None]:
    data = payload or {}
    visa = _first_date(data, VISA_EXPIRY_KEYS)
    rtw = _first_date(data, RTW_CHECK_EXPIRY_KEYS)
    return {"visa_expiry_date": visa, "rtw_check_expiry_date": rtw}


def idsp_configured() -> bool:
    return bool(os.getenv("IDSP_API_KEY") and os.getenv("IDSP_API_URL"))


def verify_share_code(
    *,
    share_code: str,
    date_of_birth: date,
    employee_id: int,
    tenant_id: int,
) -> dict[str, Any]:
    share_code = share_code.strip().upper()
    if len(share_code) < 6:
        raise IdspError("Share code must be at least 6 characters")

    if idsp_configured():
        return _verify_via_idsp(share_code=share_code, date_of_birth=date_of_birth)

    return _verify_mock(
        share_code=share_code,
        date_of_birth=date_of_birth,
        employee_id=employee_id,
        tenant_id=tenant_id,
    )


def _verify_via_idsp(*, share_code: str, date_of_birth: date) -> dict[str, Any]:
    import httpx

    api_url = os.getenv("IDSP_API_URL", "").rstrip("/")
    api_key = os.getenv("IDSP_API_KEY", "")
    try:
        response = httpx.post(
            f"{api_url}/verify",
            json={
                "share_code": share_code,
                "date_of_birth": date_of_birth.isoformat(),
            },
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPError as exc:
        raise IdspError(f"IDSP verification request failed: {exc}") from exc

    outcome = data.get("outcome", data.get("status", "unknown")).lower()
    approved = outcome in {"accepted", "approved", "pass", "time_limited"}
    dates = parse_idsp_expiry_dates(data)
    visa_expiry = dates["visa_expiry_date"]
    rtw_expiry = dates["rtw_check_expiry_date"]
    return {
        "mode": "idsp",
        "outcome": "pass" if approved else "fail",
        "rtw_status": "verified" if approved else "failed",
        "visa_expiry_date": visa_expiry.isoformat() if visa_expiry else None,
        "rtw_check_expiry_date": rtw_expiry.isoformat() if rtw_expiry else None,
        "expiry_date": (rtw_expiry or visa_expiry).isoformat() if (rtw_expiry or visa_expiry) else None,
        "provider_reference": data.get("reference") or data.get("transaction_id"),
        "raw": data,
    }


def _verify_mock(
    *,
    share_code: str,
    date_of_birth: date,
    employee_id: int,
    tenant_id: int,
) -> dict[str, Any]:
    """Deterministic mock for local dev when IDSP is not configured."""
    seed = sum(ord(c) for c in share_code) + date_of_birth.toordinal() + employee_id + tenant_id
    approved = seed % 7 != 0
    visa_expiry = date.today() + timedelta(days=400 + (seed % 365))
    rtw_expiry = date.today() + timedelta(days=180 + (seed % 90))
    return {
        "mode": "mock",
        "outcome": "pass" if approved else "fail",
        "rtw_status": "verified" if approved else "failed",
        "visa_expiry_date": visa_expiry.isoformat() if approved else None,
        "rtw_check_expiry_date": rtw_expiry.isoformat() if approved else None,
        "expiry_date": rtw_expiry.isoformat() if approved else None,
        "provider_reference": f"MOCK-{share_code[:4]}-{employee_id}",
        "message": "IDSP not configured — mock verification for development only.",
    }


def persist_verification(
    *,
    conn: Any,
    tenant_id: int,
    employee_id: int,
    share_code: str,
    verification: dict[str, Any],
    verified_by: str,
) -> dict[str, Any]:
    rtw_status = verification.get("rtw_status", "pending")
    if rtw_status in {"approved", "pass"}:
        rtw_status = "verified"
    if rtw_status in {"rejected"}:
        rtw_status = "failed"
    visa_expiry = _as_date(verification.get("visa_expiry_date"))
    rtw_expiry = _as_date(verification.get("rtw_check_expiry_date") or verification.get("expiry_date"))
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO employee_sponsor_profiles (
              tenant_id, employee_id, is_sponsored_worker, share_code,
              visa_expiry_date, rtw_check_expiry_date, rtw_status, updated_at
            )
            VALUES (%s, %s, TRUE, %s, %s, %s, %s, NOW())
            ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
              share_code = EXCLUDED.share_code,
              visa_expiry_date = COALESCE(EXCLUDED.visa_expiry_date, employee_sponsor_profiles.visa_expiry_date),
              rtw_check_expiry_date = COALESCE(
                EXCLUDED.rtw_check_expiry_date, employee_sponsor_profiles.rtw_check_expiry_date
              ),
              rtw_status = EXCLUDED.rtw_status,
              is_sponsored_worker = TRUE,
              updated_at = NOW()
            """,
            (tenant_id, employee_id, share_code, visa_expiry, rtw_expiry, rtw_status),
        )
        cur.execute(
            """
            UPDATE employees SET is_sponsored = TRUE, updated_at = NOW()
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, employee_id),
        )
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'idsp_rtw_verification', 'employee', %s, %s::jsonb)
            """,
            (
                tenant_id,
                employee_id,
                json.dumps(
                    {
                        "share_code": share_code,
                        "rtw_status": rtw_status,
                        "expiry_date": rtw_expiry.isoformat() if rtw_expiry else None,
                        "visa_expiry_date": visa_expiry.isoformat() if visa_expiry else None,
                        "rtw_check_expiry_date": rtw_expiry.isoformat() if rtw_expiry else None,
                        "mode": verification.get("mode"),
                        "provider_reference": verification.get("provider_reference"),
                        "verified_by": verified_by,
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                ),
            ),
        )
    conn.commit()
    return {
        "employee_id": employee_id,
        "rtw_status": rtw_status,
        "expiry_date": rtw_expiry.isoformat() if rtw_expiry else None,
        "visa_expiry_date": visa_expiry.isoformat() if visa_expiry else None,
        "rtw_check_expiry_date": rtw_expiry.isoformat() if rtw_expiry else None,
        "provider_reference": verification.get("provider_reference"),
        "mode": verification.get("mode"),
        "message": verification.get("message"),
    }
