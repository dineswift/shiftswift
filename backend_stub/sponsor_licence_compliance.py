"""UK Sponsor Licence mandatory safeguards for ShiftSwift HR."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from psycopg2.extras import Json

UK_RTW_CHECKLIST_URL = os.getenv(
    "UK_RTW_CHECKLIST_URL",
    "https://www.gov.uk/government/publications/right-to-work-checklist",
)
UK_FIND_A_JOB_URL = os.getenv(
    "UK_FIND_A_JOB_URL",
    "https://www.gov.uk/find-a-job",
)
UK_RECRUIT_SKILLED_WORKER_URL = os.getenv(
    "UK_RECRUIT_SKILLED_WORKER_URL",
    "https://www.gov.uk/guidance/recruit-a-skilled-worker",
)
SPONSOR_ABSENCE_ALERT_DAY = int(os.getenv("SPONSOR_ABSENCE_ALERT_DAY", "9"))
SPONSOR_ABSENCE_REPORT_LIMIT_DAYS = int(os.getenv("SPONSOR_ABSENCE_REPORT_LIMIT_DAYS", "10"))
SMS_REPORTING_WINDOW_DAYS = int(os.getenv("SMS_REPORTING_WINDOW_DAYS", "10"))
SMS_DUE_SOON_DAYS = int(os.getenv("SMS_DUE_SOON_DAYS", "3"))
RTW_STORAGE_DIR = Path(os.getenv("RTW_STORAGE_DIR", "uploads/rtw_immutable"))
ADVERT_EVIDENCE_DIR = Path(os.getenv("ADVERT_EVIDENCE_DIR", "uploads/recruitment_adverts"))

SMS_REPORTABLE_FIELDS = frozenset({"job_title", "salary", "work_location"})

ABSENCE_EXCUSE_TYPES: dict[str, dict[str, Any]] = {
    "unauthorized": {
        "label": "Unauthorized / unexcused",
        "is_excused": False,
        "paid": False,
        "description": "Counts toward the Home Office 10 working-day absence threshold.",
    },
    "paid_annual_leave": {
        "label": "Paid annual leave (booked)",
        "is_excused": True,
        "paid": True,
        "description": "Pre-approved paid holiday — does not count toward sponsor reporting.",
    },
    "unpaid_authorized": {
        "label": "Unpaid leave (authorized)",
        "is_excused": True,
        "paid": False,
        "description": "Authorized unpaid absence — does not count if permission was granted.",
    },
    "sick_authorized": {
        "label": "Sick leave (authorized)",
        "is_excused": True,
        "paid": True,
        "description": "Medically authorized sick leave — does not count.",
    },
    "bank_holiday": {
        "label": "Bank holiday / site closed",
        "is_excused": True,
        "paid": True,
        "description": "Public holiday or scheduled site closure — non-working day.",
    },
    "maternity_paternity": {
        "label": "Maternity / paternity / parental",
        "is_excused": True,
        "paid": True,
        "description": "Statutory or contractual parental leave — does not count.",
    },
    "other_authorized": {
        "label": "Other authorized absence",
        "is_excused": True,
        "paid": False,
        "description": "Other approved absence with manager permission.",
    },
}


@dataclass
class RtwStoredDocument:
    check_id: int
    employee_id: int
    check_date: date
    content_sha256: str
    storage_path: str
    gov_checklist_url: str
    immutable_locked: bool


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


RTW_EXPIRING_SOON_DAYS = 30


def rtw_check_status(*, outcome: str, expiry_date: date | None, as_of: date | None = None) -> str:
    """Return verified | expiring_soon | needs_review for UI filters and stats."""
    today = as_of or date.today()
    if outcome == "fail":
        return "needs_review"
    if expiry_date is not None:
        days_left = (expiry_date - today).days
        if days_left < 0:
            return "needs_review"
        if days_left <= RTW_EXPIRING_SOON_DAYS:
            return "expiring_soon"
    if outcome in {"pass", "time_limited"}:
        return "verified"
    return "needs_review"


def rtw_document_type(check_method: str | None, outcome: str) -> str:
    method = (check_method or "").strip()
    if method:
        lower = method.lower()
        if "share" in lower or "online" in lower or "idsp" in lower or "evisa" in lower:
            return "eVisa share code"
        return method
    return {
        "pass": "Right to work verified",
        "time_limited": "Time-limited permission",
        "fail": "Failed check",
    }.get(outcome, "RTW check")


def rtw_document_number_masked(content_sha256: str) -> str:
    tail = (content_sha256 or "")[-4:] or "0000"
    return f"••••••••{tail}"


def _serialize_rtw_row(row: tuple, *, as_of: date | None = None) -> dict[str, Any]:
    (
        check_id,
        employee_id,
        check_date,
        check_method,
        checker_user_id,
        outcome,
        expiry_date,
        content_sha256,
        storage_path,
        created_at,
        first_name,
        last_name,
        job_title,
        department,
        is_sponsored,
        email,
    ) = row
    status = rtw_check_status(outcome=outcome, expiry_date=expiry_date, as_of=as_of)
    name = f"{first_name or ''} {last_name or ''}".strip() or f"Employee #{employee_id}"
    role = job_title or department or "Staff"
    today = as_of or date.today()
    days_until_expiry = (expiry_date - today).days if expiry_date else None
    filename = Path(storage_path).name if storage_path else f"rtw-check-{check_id}.pdf"
    return {
        "id": check_id,
        "employee_id": employee_id,
        "employee_name": name,
        "employee_short_name": _employee_short_name(first_name, last_name, employee_id),
        "employee_role": role,
        "is_sponsored": bool(is_sponsored),
        "employee_email": email,
        "check_date": check_date.isoformat() if check_date else None,
        "check_method": check_method,
        "checker_user_id": checker_user_id,
        "outcome": outcome,
        "expiry_date": expiry_date.isoformat() if expiry_date else None,
        "days_until_expiry": days_until_expiry,
        "status": status,
        "document_type": rtw_document_type(check_method, outcome),
        "document_number_masked": rtw_document_number_masked(content_sha256),
        "content_sha256": content_sha256,
        "filename": filename,
        "created_at": created_at.isoformat() if created_at else None,
        "immutable_locked": True,
    }


def _employee_short_name(first_name: str | None, last_name: str | None, employee_id: int) -> str:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    if first and last:
        return f"{first[0]}. {last.split()[0]}"
    if first:
        return first
    return f"#{employee_id}"


def list_rtw_checks(*, tenant_id: int, conn: Any, limit: int = 500) -> dict[str, Any]:
    today = date.today()
    query = """
        SELECT c.id, c.employee_id, c.check_date, c.check_method, c.checker_user_id,
               c.outcome, c.expiry_date, c.content_sha256, c.storage_path, c.created_at,
               e.first_name, e.last_name, e.job_title, e.department, e.email,
               COALESCE(esp.is_sponsored_worker, e.is_sponsored, FALSE) AS is_sponsored
        FROM right_to_work_checks c
        JOIN employees e ON e.tenant_id = c.tenant_id AND e.id = c.employee_id
        LEFT JOIN employee_sponsor_profiles esp
          ON esp.tenant_id = c.tenant_id AND esp.employee_id = c.employee_id
        WHERE c.tenant_id = %s
        ORDER BY c.check_date DESC, c.id DESC
        LIMIT %s
    """
    with conn.cursor() as cur:
        cur.execute(query, (tenant_id, limit))
        rows = cur.fetchall()
    items = [_serialize_rtw_row(row, as_of=today) for row in rows]
    stats = {
        "total": len(items),
        "verified": sum(1 for item in items if item["status"] == "verified"),
        "expiring_soon": sum(1 for item in items if item["status"] == "expiring_soon"),
        "needs_review": sum(1 for item in items if item["status"] == "needs_review"),
    }
    return {"items": items, "stats": stats}


def get_rtw_check(*, tenant_id: int, check_id: int, conn: Any) -> dict[str, Any]:
    query = """
        SELECT c.id, c.employee_id, c.check_date, c.check_method, c.checker_user_id,
               c.outcome, c.expiry_date, c.content_sha256, c.storage_path, c.created_at,
               e.first_name, e.last_name, e.job_title, e.department, e.email,
               COALESCE(esp.is_sponsored_worker, e.is_sponsored, FALSE) AS is_sponsored
        FROM right_to_work_checks c
        JOIN employees e ON e.tenant_id = c.tenant_id AND e.id = c.employee_id
        LEFT JOIN employee_sponsor_profiles esp
          ON esp.tenant_id = c.tenant_id AND esp.employee_id = c.employee_id
        WHERE c.tenant_id = %s AND c.id = %s
    """
    with conn.cursor() as cur:
        cur.execute(query, (tenant_id, check_id))
        row = cur.fetchone()
    if not row:
        raise LookupError("RTW check not found")
    item = _serialize_rtw_row(row)
    item["documents"] = [
        {
            "filename": item["filename"],
            "uploaded_at": item["check_date"],
            "download_path": f"/compliance/sponsor-licence/rtw-checks/{check_id}/file",
        }
    ]
    return item


def send_rtw_expiry_reminder(*, tenant_id: int, check_id: int, conn: Any) -> dict[str, Any]:
    from core.notifications import email_delivered, send_email_notification, smtp_configured

    check = get_rtw_check(tenant_id=tenant_id, check_id=check_id, conn=conn)
    if not check.get("expiry_date"):
        raise ValueError("This RTW record has no expiry date — no reminder needed.")
    email = check.get("employee_email")
    if not email:
        raise ValueError("Employee has no email address on file.")
    if not smtp_configured():
        raise ValueError("SMTP is not configured — cannot send RTW reminder email.")
    days_left = check.get("days_until_expiry")
    subject = "Right to Work document expiry reminder"
    body = (
        f"Dear {check['employee_name']},\n\n"
        f"Your Right to Work documentation expires on {check['expiry_date']}"
        f"{f' ({days_left} days remaining)' if days_left is not None else ''}.\n"
        "Please contact HR to arrange a re-check before this date.\n\n"
        "ShiftSwift HR"
    )
    delivery = send_email_notification(
        conn=conn,
        tenant_id=tenant_id,
        subject=subject,
        body=body,
        purpose="compliance",
        to=email,
        audience="employee",
        payload={"rtw_check_id": check_id, "employee_id": check["employee_id"]},
        deliver_now=True,
        commit=False,
    )
    if not email_delivered(delivery):
        err = delivery.get("delivery_error") or "Email delivery failed"
        raise ValueError(str(err))
    return {"message": f"Reminder sent to {check['employee_name']}.", "delivered": True}


def store_immutable_rtw_pdf(
    *,
    tenant_id: int,
    employee_id: int,
    pdf_bytes: bytes,
    check_date: date,
    check_method: str,
    outcome: str,
    checker_user_id: str,
    expiry_date: date | None = None,
    gov_checklist_version: str | None = None,
    conn: Any,
) -> RtwStoredDocument:
    """Persist a dated RTW PDF; records are append-only at DB layer."""
    if outcome not in {"pass", "time_limited", "fail"}:
        raise ValueError("invalid RTW outcome")
    if not pdf_bytes.startswith(b"%PDF"):
        raise ValueError("RTW evidence must be a PDF document")

    digest = _sha256_bytes(pdf_bytes)
    tenant_dir = RTW_STORAGE_DIR / str(tenant_id) / str(employee_id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{check_date.isoformat()}_{digest[:16]}.pdf"
    path = tenant_dir / filename
    if not path.exists():
        path.write_bytes(pdf_bytes)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO right_to_work_checks (
              tenant_id, employee_id, check_date, check_method,
              gov_checklist_url, gov_checklist_version, checker_user_id,
              outcome, expiry_date, immutable_locked, content_sha256, storage_path
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, %s, %s)
            RETURNING id
            """,
            (
                tenant_id,
                employee_id,
                check_date,
                check_method,
                UK_RTW_CHECKLIST_URL,
                gov_checklist_version,
                checker_user_id,
                outcome,
                expiry_date,
                digest,
                str(path),
            ),
        )
        check_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'rtw_check_stored', 'right_to_work_checks', %s, %s::jsonb)
            """,
            (
                tenant_id,
                check_id,
                {
                    "employee_id": employee_id,
                    "check_date": check_date.isoformat(),
                    "content_sha256": digest,
                    "gov_checklist_url": UK_RTW_CHECKLIST_URL,
                },
            ),
        )
    conn.commit()
    return RtwStoredDocument(
        check_id=check_id,
        employee_id=employee_id,
        check_date=check_date,
        content_sha256=digest,
        storage_path=str(path),
        gov_checklist_url=UK_RTW_CHECKLIST_URL,
        immutable_locked=True,
    )


def consecutive_unexcused_working_days(
    *,
    tenant_id: int,
    employee_id: int,
    as_of: date,
    conn: Any,
) -> int:
    """Count consecutive unexcused absences on working days ending at as_of."""
    streak = 0
    cursor_date = as_of
    with conn.cursor() as cur:
        while True:
            cur.execute(
                """
                SELECT c.is_working_day,
                       EXISTS (
                         SELECT 1 FROM sponsored_absence_days d
                         WHERE d.tenant_id = %s AND d.employee_id = %s
                           AND d.absence_date = %s AND d.is_excused = FALSE
                       ) AS absent
                FROM (
                  SELECT %s::date AS d
                ) q
                LEFT JOIN sponsor_working_calendar c
                  ON c.tenant_id = %s AND c.calendar_date = q.d
                """,
                (tenant_id, employee_id, cursor_date, cursor_date, tenant_id),
            )
            row = cur.fetchone()
            is_working_day = True if row[0] is None else bool(row[0])
            absent = bool(row[1])
            if not is_working_day:
                cursor_date -= timedelta(days=1)
                continue
            if not absent:
                break
            streak += 1
            cursor_date -= timedelta(days=1)
    return streak


def evaluate_day9_absence_alerts(*, tenant_id: int, as_of: date, conn: Any) -> list[dict[str, Any]]:
    """Create day-9 alerts for sponsored visa workers with unexcused absences."""
    alerts: list[dict[str, Any]] = []
    employee_ids = list_sponsored_employee_ids(tenant_id=tenant_id, conn=conn)

    for employee_id in employee_ids:
        streak = consecutive_unexcused_working_days(
            tenant_id=tenant_id,
            employee_id=employee_id,
            as_of=as_of,
            conn=conn,
        )
        if streak < SPONSOR_ABSENCE_ALERT_DAY:
            continue

        report_by = as_of + timedelta(days=SPONSOR_ABSENCE_REPORT_LIMIT_DAYS)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sponsor_absence_alerts (
                  tenant_id, employee_id, consecutive_working_days, alert_day,
                  alert_status, notified_channels, home_office_report_required_by
                ) VALUES (%s, %s, %s, %s, 'pending', ARRAY['email','sms'], %s)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                (tenant_id, employee_id, streak, SPONSOR_ABSENCE_ALERT_DAY, report_by),
            )
            row = cur.fetchone()
            if not row:
                continue
            alert_id = row[0]
            cur.execute(
                """
                INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
                VALUES (%s, 'sponsor_absence_day9_alert', 'sponsor_absence_alerts', %s, %s::jsonb)
                """,
                (
                    tenant_id,
                    alert_id,
                    {
                        "employee_id": employee_id,
                        "consecutive_working_days": streak,
                        "alert_day": SPONSOR_ABSENCE_ALERT_DAY,
                        "home_office_report_required_by": report_by.isoformat(),
                    },
                ),
            )
        conn.commit()
        alerts.append(
            {
                "alert_id": alert_id,
                "employee_id": employee_id,
                "consecutive_working_days": streak,
                "alert_day": SPONSOR_ABSENCE_ALERT_DAY,
                "channels": ["email", "sms"],
                "home_office_report_required_by": report_by.isoformat(),
            }
        )
    return alerts


def absence_type_catalog() -> list[dict[str, Any]]:
    return [
        {"value": key, **meta}
        for key, meta in ABSENCE_EXCUSE_TYPES.items()
    ]


def resolve_absence_fields(
    *,
    excuse_type: str | None,
    is_excused: bool | None = None,
) -> tuple[bool, str]:
    """Validate excuse type and derive is_excused for sponsor streak logic."""
    if excuse_type:
        normalized = excuse_type.strip().lower()
        if normalized not in ABSENCE_EXCUSE_TYPES:
            valid = ", ".join(sorted(ABSENCE_EXCUSE_TYPES))
            raise ValueError(f"invalid excuse_type '{excuse_type}'. Valid values: {valid}")
        meta = ABSENCE_EXCUSE_TYPES[normalized]
        return bool(meta["is_excused"]), normalized
    if is_excused is not None:
        return bool(is_excused), "other_authorized" if is_excused else "unauthorized"
    return False, "unauthorized"


def list_sponsored_employee_ids(*, tenant_id: int, conn: Any) -> list[int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT e.id
            FROM employees e
            LEFT JOIN employee_sponsor_profiles esp
              ON esp.tenant_id = e.tenant_id AND esp.employee_id = e.id
            WHERE e.tenant_id = %s
              AND COALESCE(esp.is_sponsored_worker, e.is_sponsored, FALSE) = TRUE
            ORDER BY e.id ASC
            """,
            (tenant_id,),
        )
        return [row[0] for row in cur.fetchall()]


def record_sponsored_absence_day(
    *,
    tenant_id: int,
    employee_id: int,
    absence_date: date,
    excuse_type: str | None = None,
    is_excused: bool | None = None,
    source: str = "admin",
    conn: Any,
    commit: bool = True,
) -> dict[str, Any]:
    resolved_excused, resolved_type = resolve_absence_fields(
        excuse_type=excuse_type,
        is_excused=is_excused,
    )
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM employees WHERE tenant_id = %s AND id = %s",
            (tenant_id, employee_id),
        )
        if not cur.fetchone():
            raise LookupError("employee not found")
        cur.execute(
            """
            INSERT INTO sponsored_absence_days (
              tenant_id, employee_id, absence_date, is_excused, excuse_type, source
            ) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, employee_id, absence_date) DO UPDATE SET
              is_excused = EXCLUDED.is_excused,
              excuse_type = EXCLUDED.excuse_type,
              source = EXCLUDED.source
            RETURNING id, is_excused, excuse_type, source, created_at
            """,
            (
                tenant_id,
                employee_id,
                absence_date,
                resolved_excused,
                resolved_type,
                source,
            ),
        )
        row = cur.fetchone()
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'sponsored_absence_recorded', 'sponsored_absence_days', %s, %s::jsonb)
            """,
            (
                tenant_id,
                row[0],
                {
                    "employee_id": employee_id,
                    "absence_date": absence_date.isoformat(),
                    "is_excused": resolved_excused,
                    "excuse_type": resolved_type,
                    "source": source,
                },
            ),
        )
    if commit:
        conn.commit()
    meta = ABSENCE_EXCUSE_TYPES[resolved_type]
    return {
        "id": row[0],
        "employee_id": employee_id,
        "absence_date": absence_date.isoformat(),
        "is_excused": row[1],
        "excuse_type": row[2],
        "excuse_label": meta["label"],
        "paid": meta["paid"],
        "source": row[3],
        "created_at": row[4].isoformat() if row[4] else None,
    }


def delete_sponsored_absence_day(
    *,
    tenant_id: int,
    employee_id: int,
    absence_date: date,
    conn: Any,
) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM sponsored_absence_days
            WHERE tenant_id = %s AND employee_id = %s AND absence_date = %s
            RETURNING id
            """,
            (tenant_id, employee_id, absence_date),
        )
        row = cur.fetchone()
    conn.commit()
    return row is not None


def list_sponsored_absence_days(
    *,
    tenant_id: int,
    conn: Any,
    employee_id: int | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = """
        SELECT d.id, d.employee_id, e.first_name, e.last_name,
               d.absence_date, d.is_excused, d.excuse_type, d.source, d.created_at
        FROM sponsored_absence_days d
        JOIN employees e ON e.tenant_id = d.tenant_id AND e.id = d.employee_id
        WHERE d.tenant_id = %s
    """
    params: list[Any] = [tenant_id]
    if employee_id is not None:
        query += " AND d.employee_id = %s"
        params.append(employee_id)
    if from_date is not None:
        query += " AND d.absence_date >= %s"
        params.append(from_date)
    if to_date is not None:
        query += " AND d.absence_date <= %s"
        params.append(to_date)
    query += " ORDER BY d.absence_date DESC, d.id DESC LIMIT %s"
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        excuse_type = row[6] or "unauthorized"
        meta = ABSENCE_EXCUSE_TYPES.get(excuse_type, ABSENCE_EXCUSE_TYPES["unauthorized"])
        items.append(
            {
                "id": row[0],
                "employee_id": row[1],
                "employee_name": f"{row[2]} {row[3]}".strip(),
                "absence_date": row[4].isoformat(),
                "is_excused": row[5],
                "excuse_type": excuse_type,
                "excuse_label": meta["label"],
                "paid": meta["paid"],
                "source": row[7],
                "created_at": row[8].isoformat() if row[8] else None,
            }
        )
    return items


def _absence_risk_level(streak: int) -> str:
    if streak >= SPONSOR_ABSENCE_ALERT_DAY:
        return "alert"
    if streak >= SPONSOR_ABSENCE_ALERT_DAY - 2:
        return "warning"
    return "clear"


def get_absence_streak_summaries(
    *,
    tenant_id: int,
    as_of: date,
    conn: Any,
    lookback_days: int = 30,
) -> list[dict[str, Any]]:
    from_date = as_of - timedelta(days=lookback_days)
    summaries: list[dict[str, Any]] = []
    for employee_id in list_sponsored_employee_ids(tenant_id=tenant_id, conn=conn):
        streak = consecutive_unexcused_working_days(
            tenant_id=tenant_id,
            employee_id=employee_id,
            as_of=as_of,
            conn=conn,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.first_name, e.last_name
                FROM employees e
                WHERE e.tenant_id = %s AND e.id = %s
                """,
                (tenant_id, employee_id),
            )
            name_row = cur.fetchone()
            cur.execute(
                """
                SELECT excuse_type, is_excused, COUNT(*)
                FROM sponsored_absence_days
                WHERE tenant_id = %s AND employee_id = %s
                  AND absence_date BETWEEN %s AND %s
                GROUP BY excuse_type, is_excused
                """,
                (tenant_id, employee_id, from_date, as_of),
            )
            breakdown_rows = cur.fetchall()
        excused_count = 0
        unexcused_count = 0
        paid_leave_days = 0
        unpaid_leave_days = 0
        by_type: dict[str, int] = {}
        for excuse_type, is_excused, count in breakdown_rows:
            key = excuse_type or ("other_authorized" if is_excused else "unauthorized")
            by_type[key] = by_type.get(key, 0) + count
            meta = ABSENCE_EXCUSE_TYPES.get(key, ABSENCE_EXCUSE_TYPES["unauthorized"])
            if is_excused:
                excused_count += count
                if meta["paid"]:
                    paid_leave_days += count
                else:
                    unpaid_leave_days += count
            else:
                unexcused_count += count
        summaries.append(
            {
                "employee_id": employee_id,
                "employee_name": f"{name_row[0]} {name_row[1]}".strip() if name_row else f"Employee #{employee_id}",
                "unexcused_streak": streak,
                "alert_day": SPONSOR_ABSENCE_ALERT_DAY,
                "risk_level": _absence_risk_level(streak),
                "lookback_days": lookback_days,
                "excused_days": excused_count,
                "unexcused_days": unexcused_count,
                "paid_leave_days": paid_leave_days,
                "unpaid_authorized_days": unpaid_leave_days,
                "by_excuse_type": by_type,
            }
        )
    summaries.sort(key=lambda item: (-item["unexcused_streak"], item["employee_id"]))
    return summaries


def _is_working_day(tenant_id: int, day: date, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT is_working_day
            FROM sponsor_working_calendar
            WHERE tenant_id = %s AND calendar_date = %s
            """,
            (tenant_id, day),
        )
        row = cur.fetchone()
    return True if row is None else bool(row[0])


def _has_absence_on_date(
    *,
    tenant_id: int,
    employee_id: int,
    day: date,
    conn: Any,
    unexcused_only: bool = False,
) -> bool:
    with conn.cursor() as cur:
        query = """
            SELECT 1 FROM sponsored_absence_days
            WHERE tenant_id = %s AND employee_id = %s AND absence_date = %s
        """
        if unexcused_only:
            query += " AND is_excused = FALSE"
        cur.execute(query, (tenant_id, employee_id, day))
        return cur.fetchone() is not None


def _absence_episode_dates(
    *,
    tenant_id: int,
    employee_id: int,
    as_of: date,
    conn: Any,
    max_calendar_days: int = 120,
) -> list[date]:
    dates: list[date] = []
    cursor = as_of
    scanned = 0
    while scanned < max_calendar_days:
        if _is_working_day(tenant_id, cursor, conn):
            if not _has_absence_on_date(tenant_id=tenant_id, employee_id=employee_id, day=cursor, conn=conn):
                break
            dates.append(cursor)
        cursor -= timedelta(days=1)
        scanned += 1
    dates.reverse()
    return dates


def _absence_status_label(*, unexcused_streak: int, is_excused_episode: bool) -> tuple[str, str]:
    if unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY:
        return "report_now", "Report now"
    if unexcused_streak > 0:
        if unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY - 2:
            return "monitor", "Monitor"
        return "monitor", "Monitor"
    if is_excused_episode:
        return "authorized", "Authorised"
    return "clear", "Clear"


def _absence_type_badge(*, unexcused_streak: int, excuse_label: str, is_excused: bool) -> tuple[str, str]:
    if unexcused_streak > 0:
        return "danger", "Unauthorised"
    if is_excused:
        if "sick" in excuse_label.lower():
            return "grey", "Sick"
        return "grey", "Authorised"
    return "grey", excuse_label or "Authorised"


def _build_absence_record(
    *,
    tenant_id: int,
    employee_id: int,
    as_of: date,
    conn: Any,
    include_timeline: bool = False,
) -> dict[str, Any] | None:
    episode_dates = _absence_episode_dates(
        tenant_id=tenant_id, employee_id=employee_id, as_of=as_of, conn=conn
    )
    if not episode_dates:
        return None
    unexcused_streak = consecutive_unexcused_working_days(
        tenant_id=tenant_id, employee_id=employee_id, as_of=as_of, conn=conn
    )
    start_date = episode_dates[0]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT e.first_name, e.last_name, e.job_title, e.department,
                   COALESCE(esp.is_sponsored_worker, e.is_sponsored, FALSE)
            FROM employees e
            LEFT JOIN employee_sponsor_profiles esp
              ON esp.tenant_id = e.tenant_id AND esp.employee_id = e.id
            WHERE e.tenant_id = %s AND e.id = %s
            """,
            (tenant_id, employee_id),
        )
        emp = cur.fetchone()
        cur.execute(
            """
            SELECT is_excused, excuse_type, source, created_at
            FROM sponsored_absence_days
            WHERE tenant_id = %s AND employee_id = %s AND absence_date = %s
            """,
            (tenant_id, employee_id, start_date),
        )
        first_day = cur.fetchone()
        cur.execute(
            """
            SELECT is_excused, excuse_type
            FROM sponsored_absence_days
            WHERE tenant_id = %s AND employee_id = %s AND absence_date = %s
            """,
            (tenant_id, employee_id, episode_dates[-1]),
        )
        latest_day = cur.fetchone()
        cur.execute(
            """
            SELECT id, consecutive_working_days, alert_status, triggered_at,
                   home_office_report_required_by, acknowledged_by, acknowledged_at,
                   home_office_report_reference, reported_at
            FROM sponsor_absence_alerts
            WHERE tenant_id = %s AND employee_id = %s
            ORDER BY triggered_at DESC
            LIMIT 1
            """,
            (tenant_id, employee_id),
        )
        alert_row = cur.fetchone()
    if not emp:
        return None
    first_name, last_name, job_title, department, is_sponsored = emp
    name = f"{first_name or ''} {last_name or ''}".strip() or f"Employee #{employee_id}"
    excuse_type = (latest_day[1] if latest_day else first_day[1] if first_day else "unauthorized") or "unauthorized"
    meta = ABSENCE_EXCUSE_TYPES.get(excuse_type, ABSENCE_EXCUSE_TYPES["unauthorized"])
    is_excused = bool(latest_day[0]) if latest_day else bool(first_day[0]) if first_day else False
    is_excused_episode = unexcused_streak == 0
    status_key, status_label = _absence_status_label(
        unexcused_streak=unexcused_streak, is_excused_episode=is_excused_episode
    )
    type_tone, type_label = _absence_type_badge(
        unexcused_streak=unexcused_streak, excuse_label=meta["label"], is_excused=is_excused
    )
    working_days = len(episode_dates)
    progress_pct = min(100, int((unexcused_streak / SPONSOR_ABSENCE_ALERT_DAY) * 100)) if unexcused_streak else min(
        100, int((working_days / SPONSOR_ABSENCE_ALERT_DAY) * 100)
    )
    progress_hint = (
        "Report required"
        if unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY
        else f"{max(0, SPONSOR_ABSENCE_ALERT_DAY - unexcused_streak)} days remaining"
        if unexcused_streak > 0
        else "Authorised leave"
    )
    logged_source = (first_day[2] if first_day else "admin") or "admin"
    logged_at = first_day[3] if first_day else None
    record = {
        "employee_id": employee_id,
        "employee_name": name,
        "employee_short_name": _employee_short_name(first_name, last_name, employee_id),
        "employee_role": job_title or department or "Staff",
        "is_sponsored": bool(is_sponsored),
        "start_date": start_date.isoformat(),
        "episode_end_date": episode_dates[-1].isoformat(),
        "working_days": working_days,
        "unexcused_streak": unexcused_streak,
        "excuse_type": excuse_type,
        "excuse_label": meta["label"],
        "is_excused": is_excused,
        "type_label": type_label,
        "type_tone": type_tone,
        "status_key": status_key,
        "status_label": status_label,
        "progress_pct": progress_pct,
        "progress_hint": progress_hint,
        "logged_by": logged_source.replace("_", " ").title(),
        "logged_at": logged_at.isoformat() if logged_at else None,
        "alert_id": alert_row[0] if alert_row else None,
        "alert_status": alert_row[2] if alert_row else None,
        "home_office_report_reference": alert_row[7] if alert_row else None,
        "reported_at": alert_row[8].isoformat() if alert_row and alert_row[8] else None,
        "is_critical": unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY,
    }
    if include_timeline:
        record["timeline"] = _absence_timeline(
            start_date=start_date,
            unexcused_streak=unexcused_streak,
            logged_by=record["logged_by"],
            logged_at=logged_at,
            alert_row=alert_row,
            as_of=as_of,
        )
        record["panel_badge"] = (
            f"Day {unexcused_streak} — Act now"
            if unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY
            else f"Day {unexcused_streak} — Monitor"
            if unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY - 2
            else None
        )
    return record


def _fmt_short_date(value: date | datetime) -> str:
    if isinstance(value, datetime):
        value = value.date()
    return f"{value.day} {value.strftime('%b')}"


def _absence_timeline(
    *,
    start_date: date,
    unexcused_streak: int,
    logged_by: str,
    logged_at: datetime | None,
    alert_row: tuple | None,
    as_of: date,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = [
        {
            "key": "logged",
            "label": "Absence logged",
            "sub": f"{_fmt_short_date(start_date)} · {logged_by}",
            "tone": "ok",
        }
    ]
    if unexcused_streak >= 5:
        events.append(
            {
                "key": "day5",
                "label": "Day-5 alert sent",
                "sub": "Email to admin",
                "tone": "warn",
            }
        )
    if unexcused_streak >= SPONSOR_ABSENCE_ALERT_DAY:
        alert_date = alert_row[3].date() if alert_row and alert_row[3] else as_of
        events.append(
            {
                "key": "day9",
                "label": "Day-9 alert — action required",
                "sub": f"{_fmt_short_date(alert_date)} · SMS report due today",
                "tone": "danger",
            }
        )
    if alert_row and alert_row[2] in {"reported", "acknowledged"}:
        events.append(
            {
                "key": "resolved",
                "label": "SMS reported" if alert_row[2] == "reported" else "Returned to work",
                "sub": _fmt_short_date(alert_row[6]) if alert_row[6] else "Resolved",
                "tone": "ok",
            }
        )
    else:
        events.append(
            {
                "key": "awaiting",
                "label": "Awaiting resolution",
                "sub": "Return to work or SMS report",
                "tone": "muted",
            }
        )
    return events


def absence_monitoring_dashboard(*, tenant_id: int, conn: Any, as_of: date | None = None) -> dict[str, Any]:
    today = as_of or date.today()
    month_start = today.replace(day=1)
    sponsored_ids = list_sponsored_employee_ids(tenant_id=tenant_id, conn=conn)
    active: list[dict[str, Any]] = []
    for employee_id in sponsored_ids:
        record = _build_absence_record(
            tenant_id=tenant_id, employee_id=employee_id, as_of=today, conn=conn
        )
        if record:
            active.append(record)
    active.sort(key=lambda item: (-item["unexcused_streak"], -item["working_days"], item["employee_id"]))

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM sponsor_absence_alerts
            WHERE tenant_id = %s
              AND alert_status IN ('reported', 'acknowledged')
              AND triggered_at >= %s
            """,
            (tenant_id, month_start),
        )
        resolved_count = cur.fetchone()[0]
        cur.execute(
            """
            SELECT a.id, a.employee_id, e.first_name, e.last_name, e.job_title, e.department,
                   COALESCE(esp.is_sponsored_worker, e.is_sponsored, FALSE),
                   a.consecutive_working_days, a.alert_status, a.triggered_at, a.acknowledged_at
            FROM sponsor_absence_alerts a
            JOIN employees e ON e.tenant_id = a.tenant_id AND e.id = a.employee_id
            LEFT JOIN employee_sponsor_profiles esp
              ON esp.tenant_id = a.tenant_id AND esp.employee_id = a.employee_id
            WHERE a.tenant_id = %s
              AND a.alert_status IN ('reported', 'acknowledged')
            ORDER BY COALESCE(a.acknowledged_at, a.triggered_at) DESC
            LIMIT 10
            """,
            (tenant_id,),
        )
        resolved_rows = cur.fetchall()

    resolved: list[dict[str, Any]] = []
    for row in resolved_rows:
        first_name, last_name = row[2], row[3]
        name = f"{first_name or ''} {last_name or ''}".strip()
        resolution = "SMS reported" if row[8] == "reported" else "Returned"
        resolved.append(
            {
                "employee_id": row[1],
                "employee_name": name,
                "employee_short_name": _employee_short_name(first_name, last_name, row[1]),
                "employee_role": row[4] or row[5] or "Staff",
                "is_sponsored": bool(row[6]),
                "days": row[7],
                "resolution": resolution,
                "reported": "Yes" if row[8] == "reported" else "N/A",
            }
        )

    day9_alerts = sum(1 for item in active if item["unexcused_streak"] >= SPONSOR_ABSENCE_ALERT_DAY)
    primary_alert = next((item for item in active if item["is_critical"]), None)

    return {
        "as_of": today.isoformat(),
        "stats": {
            "day9_alerts": day9_alerts,
            "active_absences": len(active),
            "resolved_this_month": resolved_count,
            "sponsored_workers": len(sponsored_ids),
        },
        "primary_alert": primary_alert,
        "active": active,
        "resolved": resolved,
    }


def get_absence_monitoring_detail(
    *, tenant_id: int, employee_id: int, conn: Any, as_of: date | None = None
) -> dict[str, Any]:
    today = as_of or date.today()
    record = _build_absence_record(
        tenant_id=tenant_id,
        employee_id=employee_id, as_of=today, conn=conn, include_timeline=True
    )
    if not record:
        raise LookupError("No active absence record for this employee")
    return record


def mark_absence_sms_reported(
    *,
    tenant_id: int,
    employee_id: int,
    acknowledged_by: str,
    conn: Any,
    home_office_report_reference: str | None = None,
) -> dict[str, Any]:
    reference = (home_office_report_reference or "").strip() or None
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sponsor_absence_alerts
            SET alert_status = 'reported',
                acknowledged_by = %s,
                acknowledged_at = NOW(),
                home_office_report_reference = %s,
                reported_at = NOW()
            WHERE tenant_id = %s AND employee_id = %s
              AND alert_status IN ('pending', 'sent')
            RETURNING id
            """,
            (acknowledged_by.strip(), reference, tenant_id, employee_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("No open day-9 alert for this employee")
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'sponsor_absence_sms_reported', 'sponsor_absence_alerts', %s, %s::jsonb)
            """,
            (
                tenant_id,
                row[0],
                {
                    "employee_id": employee_id,
                    "acknowledged_by": acknowledged_by.strip(),
                    "home_office_report_reference": reference,
                },
            ),
        )
    conn.commit()
    return {
        "message": "Marked as reported to the Home Office.",
        "alert_id": row[0],
        "home_office_report_reference": reference,
    }


def mark_absence_returned(
    *, tenant_id: int, employee_id: int, acknowledged_by: str, conn: Any, as_of: date | None = None
) -> dict[str, Any]:
    today = as_of or date.today()
    episode_dates = _absence_episode_dates(
        tenant_id=tenant_id, employee_id=employee_id, as_of=today, conn=conn
    )
    if not episode_dates:
        raise LookupError("No active absence episode to resolve")
    with conn.cursor() as cur:
        for day in episode_dates:
            cur.execute(
                """
                DELETE FROM sponsored_absence_days
                WHERE tenant_id = %s AND employee_id = %s AND absence_date = %s
                """,
                (tenant_id, employee_id, day),
            )
        cur.execute(
            """
            UPDATE sponsor_absence_alerts
            SET alert_status = 'acknowledged',
                acknowledged_by = %s,
                acknowledged_at = NOW()
            WHERE tenant_id = %s AND employee_id = %s
              AND alert_status IN ('pending', 'sent', 'reported')
            """,
            (acknowledged_by.strip(), tenant_id, employee_id),
        )
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'sponsor_absence_returned', 'employees', %s, %s::jsonb)
            """,
            (
                tenant_id,
                employee_id,
                {
                    "employee_id": employee_id,
                    "acknowledged_by": acknowledged_by.strip(),
                    "cleared_dates": [d.isoformat() for d in episode_dates],
                },
            ),
        )
    conn.commit()
    return {"message": "Marked returned to work and cleared active absence days.", "cleared_days": len(episode_dates)}


def list_working_calendar(
    *,
    tenant_id: int,
    conn: Any,
    from_date: date | None = None,
    to_date: date | None = None,
    non_working_only: bool = False,
    limit: int = 366,
) -> list[dict[str, Any]]:
    query = """
        SELECT calendar_date, is_working_day
        FROM sponsor_working_calendar
        WHERE tenant_id = %s
    """
    params: list[Any] = [tenant_id]
    if from_date is not None:
        query += " AND calendar_date >= %s"
        params.append(from_date)
    if to_date is not None:
        query += " AND calendar_date <= %s"
        params.append(to_date)
    if non_working_only:
        query += " AND is_working_day = FALSE"
    query += " ORDER BY calendar_date ASC LIMIT %s"
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [
        {
            "calendar_date": row[0].isoformat(),
            "is_working_day": row[1],
            "label": "Working day" if row[1] else "Non-working / bank holiday",
        }
        for row in rows
    ]


def upsert_working_calendar(
    *,
    tenant_id: int,
    entries: list[dict[str, Any]],
    conn: Any,
) -> dict[str, int]:
    if not entries:
        raise ValueError("at least one calendar entry is required")
    applied = 0
    with conn.cursor() as cur:
        for entry in entries:
            calendar_date = entry["calendar_date"]
            if isinstance(calendar_date, str):
                calendar_date = date.fromisoformat(calendar_date)
            is_working_day = bool(entry.get("is_working_day", True))
            cur.execute(
                """
                INSERT INTO sponsor_working_calendar (tenant_id, calendar_date, is_working_day)
                VALUES (%s, %s, %s)
                ON CONFLICT (tenant_id, calendar_date) DO UPDATE SET
                  is_working_day = EXCLUDED.is_working_day
                """,
                (tenant_id, calendar_date, is_working_day),
            )
            applied += 1
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'working_calendar_updated', 'sponsor_working_calendar', %s, %s::jsonb)
            """,
            (
                tenant_id,
                tenant_id,
                {"entries_applied": applied},
            ),
        )
    conn.commit()
    return {"applied": applied}


def log_sms_reportable_change(
    *,
    tenant_id: int,
    employee_id: int,
    field_name: str,
    old_value: str | None,
    new_value: str | None,
    changed_by: str,
    conn: Any,
) -> dict[str, Any] | None:
    if field_name not in SMS_REPORTABLE_FIELDS:
        return None
    if (old_value or "") == (new_value or ""):
        return None

    changed_at = _utcnow()
    deadline = (changed_at.date() + timedelta(days=SMS_REPORTING_WINDOW_DAYS))
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sponsor_sms_change_log (
              tenant_id, employee_id, field_name, old_value, new_value,
              changed_at, changed_by, sms_reporting_deadline, alert_status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'open')
            RETURNING id
            """,
            (tenant_id, employee_id, field_name, old_value, new_value, changed_at, changed_by, deadline),
        )
        log_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'sms_reportable_change', 'sponsor_sms_change_log', %s, %s::jsonb)
            """,
            (
                tenant_id,
                log_id,
                Json(
                    {
                        "employee_id": employee_id,
                        "field_name": field_name,
                        "old_value": old_value,
                        "new_value": new_value,
                        "sms_reporting_deadline": deadline.isoformat(),
                    }
                ),
            ),
        )
    conn.commit()
    return {
        "id": log_id,
        "field_name": field_name,
        "sms_reporting_deadline": deadline.isoformat(),
        "alert_status": "open",
    }


def refresh_sms_change_alert_statuses(*, tenant_id: int, as_of: date, conn: Any) -> int:
    updated = 0
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sponsor_sms_change_log
            SET alert_status = 'overdue'
            WHERE tenant_id = %s
              AND alert_status IN ('open', 'due_soon')
              AND sms_reporting_deadline < %s
            """,
            (tenant_id, as_of),
        )
        updated += cur.rowcount
        due_soon_from = as_of + timedelta(days=SMS_DUE_SOON_DAYS)
        cur.execute(
            """
            UPDATE sponsor_sms_change_log
            SET alert_status = 'due_soon'
            WHERE tenant_id = %s
              AND alert_status = 'open'
              AND sms_reporting_deadline <= %s
              AND sms_reporting_deadline >= %s
            """,
            (tenant_id, due_soon_from, as_of),
        )
        updated += cur.rowcount
    conn.commit()
    return updated


def compliance_dashboard(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    today = _utcnow().date()
    expiring_cutoff = today + timedelta(days=30)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM right_to_work_checks
            WHERE tenant_id = %s AND (expiry_date IS NULL OR expiry_date >= %s)
            """,
            (tenant_id, today),
        )
        valid_rtw = cur.fetchone()[0]
        cur.execute(
            """
            SELECT COUNT(*) FROM right_to_work_checks
            WHERE tenant_id = %s AND expiry_date IS NOT NULL AND expiry_date < %s
            """,
            (tenant_id, today),
        )
        expired_rtw = cur.fetchone()[0]
        cur.execute(
            """
            SELECT COUNT(*) FROM right_to_work_checks
            WHERE tenant_id = %s
              AND expiry_date IS NOT NULL
              AND expiry_date >= %s
              AND expiry_date <= %s
            """,
            (tenant_id, today, expiring_cutoff),
        )
        rtw_expiring_soon = cur.fetchone()[0]
        cur.execute(
            """
            SELECT COUNT(*) FROM sponsored_absence_days
            WHERE tenant_id = %s
            """,
            (tenant_id,),
        )
        absence_days_recorded = cur.fetchone()[0]
        cur.execute(
            """
            SELECT COUNT(*) FROM sponsor_reporting_triggers
            WHERE tenant_id = %s AND status = 'open'
            """,
            (tenant_id,),
        )
        open_reporting_triggers = cur.fetchone()[0]
        cur.execute(
            """
            SELECT id, employee_id, consecutive_working_days, alert_status, home_office_report_required_by
            FROM sponsor_absence_alerts
            WHERE tenant_id = %s AND alert_status IN ('pending', 'sent')
            ORDER BY triggered_at DESC LIMIT 20
            """,
            (tenant_id,),
        )
        absence_alerts = [
            {
                "id": r[0],
                "employee_id": r[1],
                "consecutive_working_days": r[2],
                "alert_status": r[3],
                "home_office_report_required_by": r[4].isoformat() if r[4] else None,
            }
            for r in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT id, employee_id, field_name, old_value, new_value,
                   sms_reporting_deadline, alert_status
            FROM sponsor_sms_change_log
            WHERE tenant_id = %s AND alert_status IN ('open', 'due_soon', 'overdue')
            ORDER BY sms_reporting_deadline ASC LIMIT 50
            """,
            (tenant_id,),
        )
        sms_changes = [
            {
                "id": r[0],
                "employee_id": r[1],
                "field_name": r[2],
                "old_value": r[3],
                "new_value": r[4],
                "sms_reporting_deadline": r[5].isoformat(),
                "alert_status": r[6],
            }
            for r in cur.fetchall()
        ]
        advert_summary = _advertisement_summary(tenant_id, today, cur)
    recent_adverts = list_advertisement_records(tenant_id=tenant_id, conn=conn, limit=10)
    absence_streaks = get_absence_streak_summaries(tenant_id=tenant_id, as_of=today, conn=conn)
    sponsored_worker_count = len(list_sponsored_employee_ids(tenant_id=tenant_id, conn=conn))
    top_absence_warning = next(
        (s for s in absence_streaks if s.get("risk_level") in {"warning", "alert"}),
        None,
    )
    advert_logged = (advert_summary.get("sponsored_vacancy_records") or 0) + (
        advert_summary.get("active_records") or 0
    )
    return {
        "gov_rtw_checklist_url": UK_RTW_CHECKLIST_URL,
        "gov_recruitment_links": recruitment_reference_links(),
        "rtw": {
            "valid_checks": valid_rtw,
            "expired_checks": expired_rtw,
            "expiring_within_30_days": rtw_expiring_soon,
            "total_checks": valid_rtw + expired_rtw,
        },
        "absence_alerts": absence_alerts,
        "absence_streaks": absence_streaks,
        "absence_excuse_types": absence_type_catalog(),
        "sms_change_alerts": sms_changes,
        "advertisement_records": advert_summary,
        "recent_advertisement_records": recent_adverts,
        "duty_overview": {
            "sponsored_worker_count": sponsored_worker_count,
            "rtw_total_checks": valid_rtw + expired_rtw,
            "rtw_expiring_within_30_days": rtw_expiring_soon,
            "absence_open_alerts": len(absence_alerts),
            "absence_top_warning": top_absence_warning,
            "absence_days_recorded": absence_days_recorded,
            "sms_pending": len(sms_changes),
            "advert_logged": advert_logged,
            "open_reporting_triggers": open_reporting_triggers,
        },
    }


def recruitment_reference_links() -> list[dict[str, str]]:
    return [
        {
            "title": "GOV.UK Find a Job",
            "url": UK_FIND_A_JOB_URL,
            "note": "Official job listing service — retain advert links for sponsor audits.",
        },
        {
            "title": "Recruit a skilled worker (sponsor guidance)",
            "url": UK_RECRUIT_SKILLED_WORKER_URL,
            "note": "Home Office guidance on recruitment and advertising duties.",
        },
        {
            "title": "Right to Work checklist",
            "url": UK_RTW_CHECKLIST_URL,
            "note": "Use alongside advert records when onboarding sponsored hires.",
        },
    ]


def _advertisement_summary(tenant_id: int, today: date, cur: Any) -> dict[str, int]:
    cur.execute(
        """
        SELECT COUNT(*) FROM recruitment_advertisement_records
        WHERE tenant_id = %s AND record_status = 'active'
        """,
        (tenant_id,),
    )
    active = cur.fetchone()[0]
    cur.execute(
        """
        SELECT COUNT(*) FROM recruitment_advertisement_records
        WHERE tenant_id = %s
          AND record_status = 'active'
          AND closing_date IS NOT NULL
          AND closing_date < %s
        """,
        (tenant_id, today),
    )
    overdue_closed = cur.fetchone()[0]
    cur.execute(
        """
        SELECT COUNT(*) FROM recruitment_advertisement_records
        WHERE tenant_id = %s AND is_sponsored_vacancy = TRUE
        """,
        (tenant_id,),
    )
    sponsored = cur.fetchone()[0]
    return {
        "active_records": active,
        "sponsored_vacancy_records": sponsored,
        "needs_review": overdue_closed,
    }


def _serialize_advert_row(row: tuple) -> dict[str, Any]:
    (
        record_id,
        job_reference,
        job_title,
        platform,
        advert_url,
        advert_reference,
        posted_date,
        closing_date,
        is_sponsored,
        record_status,
        additional_links,
        notes,
        evidence_storage_path,
    ) = row
    return {
        "id": record_id,
        "job_reference": job_reference,
        "job_title": job_title,
        "platform": platform,
        "advert_url": advert_url,
        "advert_reference": advert_reference,
        "posted_date": posted_date.isoformat() if posted_date else None,
        "closing_date": closing_date.isoformat() if closing_date else None,
        "is_sponsored_vacancy": is_sponsored,
        "record_status": record_status,
        "additional_links": additional_links or [],
        "notes": notes,
        "has_evidence": bool(evidence_storage_path),
    }


def list_advertisement_records(
    *,
    tenant_id: int,
    conn: Any,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = """
        SELECT id, job_reference, job_title, platform, advert_url, advert_reference,
               posted_date, closing_date, is_sponsored_vacancy, record_status,
               additional_links, notes, evidence_storage_path
        FROM recruitment_advertisement_records
        WHERE tenant_id = %s
    """
    params: list[Any] = [tenant_id]
    if status:
        query += " AND record_status = %s"
        params.append(status)
    query += " ORDER BY posted_date DESC, id DESC LIMIT %s"
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
        record_ids = [r[0] for r in rows]
        links_by_record: dict[int, list[dict[str, str]]] = {rid: [] for rid in record_ids}
        if record_ids:
            cur.execute(
                """
                SELECT advert_record_id, link_label, link_url, link_type
                FROM recruitment_advertisement_links
                WHERE tenant_id = %s AND advert_record_id = ANY(%s)
                ORDER BY id ASC
                """,
                (tenant_id, record_ids),
            )
            for link_row in cur.fetchall():
                links_by_record[link_row[0]].append(
                    {
                        "label": link_row[1],
                        "url": link_row[2],
                        "type": link_row[3],
                    }
                )
    results = []
    for row in rows:
        item = _serialize_advert_row(row)
        item["links"] = links_by_record.get(item["id"], [])
        results.append(item)
    return results


def create_advertisement_record(
    *,
    tenant_id: int,
    job_title: str,
    platform: str,
    advert_url: str,
    posted_date: date,
    conn: Any,
    job_reference: str | None = None,
    soc_code: str | None = None,
    vacancy_id: int | None = None,
    advert_reference: str | None = None,
    closing_date: date | None = None,
    is_sponsored_vacancy: bool = True,
    rlmt_applicable: bool = True,
    minimum_advertising_days: int = 28,
    additional_links: list[dict[str, str]] | None = None,
    extra_links: list[dict[str, str]] | None = None,
    notes: str | None = None,
    created_by: str = "system",
) -> dict[str, Any]:
    if not advert_url.startswith(("http://", "https://")):
        raise ValueError("advert_url must be a valid http(s) link")
    links_json = additional_links or []
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recruitment_advertisement_records (
              tenant_id, job_reference, job_title, soc_code, vacancy_id, platform,
              advert_url, advert_reference, posted_date, closing_date,
              is_sponsored_vacancy, rlmt_applicable, minimum_advertising_days,
              additional_links, notes, created_by
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            RETURNING id
            """,
            (
                tenant_id,
                job_reference,
                job_title,
                soc_code,
                vacancy_id,
                platform,
                advert_url,
                advert_reference,
                posted_date,
                closing_date,
                is_sponsored_vacancy,
                rlmt_applicable,
                minimum_advertising_days,
                __import__("json").dumps(links_json),
                notes,
                created_by,
            ),
        )
        record_id = cur.fetchone()[0]
        for link in extra_links or []:
            url = str(link.get("url") or "").strip()
            if not url:
                continue
            cur.execute(
                """
                INSERT INTO recruitment_advertisement_links (
                  advert_record_id, tenant_id, link_label, link_url, link_type
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    record_id,
                    tenant_id,
                    str(link.get("label") or "Related link"),
                    url,
                    str(link.get("type") or "listing"),
                ),
            )
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'advertisement_record_created', 'recruitment_advertisement_records', %s, %s::jsonb)
            """,
            (
                tenant_id,
                record_id,
                {
                    "job_title": job_title,
                    "platform": platform,
                    "advert_url": advert_url,
                    "posted_date": posted_date.isoformat(),
                },
            ),
        )
    conn.commit()
    return get_advertisement_record(tenant_id=tenant_id, record_id=record_id, conn=conn)


def get_advertisement_record(*, tenant_id: int, record_id: int, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, job_reference, job_title, platform, advert_url, advert_reference,
                   posted_date, closing_date, is_sponsored_vacancy, record_status,
                   additional_links, notes, evidence_storage_path
            FROM recruitment_advertisement_records
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, record_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("advertisement record not found")
        cur.execute(
            """
            SELECT link_label, link_url, link_type
            FROM recruitment_advertisement_links
            WHERE tenant_id = %s AND advert_record_id = %s
            ORDER BY id ASC
            """,
            (tenant_id, record_id),
        )
        links = [{"label": r[0], "url": r[1], "type": r[2]} for r in cur.fetchall()]
    item = _serialize_advert_row(row)
    item["links"] = links
    return item


def store_advertisement_evidence(
    *,
    tenant_id: int,
    record_id: int,
    file_bytes: bytes,
    original_filename: str,
    conn: Any,
) -> dict[str, Any]:
    if not file_bytes:
        raise ValueError("Evidence file is empty")
    if not file_bytes.startswith(b"%PDF"):
        raise ValueError("Advert evidence must be a PDF document")

    digest = _sha256_bytes(file_bytes)
    tenant_dir = ADVERT_EVIDENCE_DIR / str(tenant_id) / str(record_id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    filename = f"evidence_{digest[:16]}.pdf"
    path = tenant_dir / filename
    if not path.exists():
        path.write_bytes(file_bytes)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM recruitment_advertisement_records
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, record_id),
        )
        if not cur.fetchone():
            raise LookupError("advertisement record not found")
        cur.execute(
            """
            UPDATE recruitment_advertisement_records
            SET evidence_storage_path = %s, updated_at = NOW()
            WHERE tenant_id = %s AND id = %s
            """,
            (str(path), tenant_id, record_id),
        )
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'advertisement_evidence_uploaded', 'recruitment_advertisement_records', %s, %s::jsonb)
            """,
            (
                tenant_id,
                record_id,
                {"original_filename": original_filename, "content_sha256": digest},
            ),
        )
    conn.commit()
    return {"message": "Advert evidence uploaded.", "has_evidence": True}


def add_advertisement_link(
    *,
    tenant_id: int,
    record_id: int,
    link_label: str,
    link_url: str,
    link_type: str = "listing",
    conn: Any,
) -> dict[str, str]:
    if not link_url.startswith(("http://", "https://")):
        raise ValueError("link_url must be a valid http(s) link")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM recruitment_advertisement_records
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, record_id),
        )
        if not cur.fetchone():
            raise LookupError("advertisement record not found")
        cur.execute(
            """
            INSERT INTO recruitment_advertisement_links (
              advert_record_id, tenant_id, link_label, link_url, link_type
            ) VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (record_id, tenant_id, link_label, link_url, link_type),
        )
        link_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO compliance_audit_events (tenant_id, event_type, entity_type, entity_id, payload)
            VALUES (%s, 'advertisement_link_added', 'recruitment_advertisement_links', %s, %s::jsonb)
            """,
            (
                tenant_id,
                link_id,
                {"advert_record_id": record_id, "link_label": link_label, "link_url": link_url},
            ),
        )
    conn.commit()
    return {"label": link_label, "url": link_url, "type": link_type}
