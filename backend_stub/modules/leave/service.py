"""Leave request service — booking, approval, and balance."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from modules.leave.constants import LEAVE_STATUSES, LEAVE_TYPE_LABELS, LEAVE_TYPES


def count_weekdays(*, start: date, end: date) -> float:
    if end < start:
        raise ValueError("End date must be on or after start date.")
    total = 0
    current = start
    while current <= end:
        if current.weekday() < 5:
            total += 1
        current += timedelta(days=1)
    return float(total)


def _leave_excuse_type(leave_type: str) -> str:
    return {
        "annual": "paid_annual_leave",
        "sick": "sick_authorized",
        "unpaid": "unpaid_authorized",
        "other": "unpaid_authorized",
    }.get(leave_type, "unpaid_authorized")


def sync_approved_leave_to_sponsor_absence(
    *,
    tenant_id: int,
    employee_id: int,
    request_id: int,
    leave_type: str,
    start_date: date,
    end_date: date,
    conn: Any,
) -> int:
    """Mirror approved leave onto sponsored_absence_days for sponsor licence tracking."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(is_sponsored, FALSE)
            FROM employees
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
        if not row or not row[0]:
            return 0

    from sponsor_licence_compliance import record_sponsored_absence_day

    excuse_type = _leave_excuse_type(leave_type)
    source = f"leave:{request_id}"
    synced = 0
    current = start_date
    while current <= end_date:
        if current.weekday() < 5:
            record_sponsored_absence_day(
                tenant_id=tenant_id,
                employee_id=employee_id,
                absence_date=current,
                excuse_type=excuse_type,
                source=source,
                conn=conn,
                commit=False,
            )
            synced += 1
        current += timedelta(days=1)
    return synced


def _serialize_row(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        request_id,
        employee_id,
        first_name,
        last_name,
        leave_type,
        start_date,
        end_date,
        days_requested,
        reason,
        status,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
    ) = row
    name = f"{first_name or ''} {last_name or ''}".strip()
    return {
        "id": int(request_id),
        "employee_id": int(employee_id),
        "employee_name": name,
        "leave_type": leave_type,
        "leave_type_label": LEAVE_TYPE_LABELS.get(str(leave_type), str(leave_type)),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "days_requested": float(days_requested),
        "reason": reason,
        "status": status,
        "reviewed_by": reviewed_by,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "review_note": review_note,
        "created_at": created_at.isoformat() if created_at else None,
    }


def leave_balance(*, tenant_id: int, employee_id: int, conn: Any, year: int | None = None) -> dict[str, Any]:
    target_year = year or date.today().year
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT annual_leave_days FROM employees
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Employee not found")
        allowance = float(row[0] or 28)
        cur.execute(
            """
            SELECT
              COALESCE(SUM(days_requested) FILTER (WHERE status = 'approved'), 0),
              COALESCE(SUM(days_requested) FILTER (WHERE status = 'pending'), 0)
            FROM leave_requests
            WHERE tenant_id = %s AND employee_id = %s AND leave_type = 'annual'
              AND EXTRACT(YEAR FROM start_date) = %s
            """,
            (tenant_id, employee_id, target_year),
        )
        used, pending = cur.fetchone()
    used_f = float(used or 0)
    pending_f = float(pending or 0)
    remaining = round(allowance - used_f - pending_f, 2)
    return {
        "year": target_year,
        "allowance_days": allowance,
        "used_days": used_f,
        "pending_days": pending_f,
        "remaining_days": remaining,
    }


def list_leave_requests(
    *,
    tenant_id: int,
    conn: Any,
    status: str | None = None,
    employee_id: int | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = """
        SELECT lr.id, lr.employee_id, e.first_name, e.last_name,
               lr.leave_type, lr.start_date, lr.end_date, lr.days_requested,
               lr.reason, lr.status, lr.reviewed_by, lr.reviewed_at, lr.review_note, lr.created_at
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id AND e.tenant_id = lr.tenant_id
        WHERE lr.tenant_id = %s
    """
    params: list[Any] = [tenant_id]
    if status:
        if status not in LEAVE_STATUSES:
            raise ValueError("Invalid status filter")
        query += " AND lr.status = %s"
        params.append(status)
    if employee_id is not None:
        query += " AND lr.employee_id = %s"
        params.append(employee_id)
    query += " ORDER BY lr.created_at DESC LIMIT %s"
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(query, params)
        return [_serialize_row(row) for row in cur.fetchall()]


def create_leave_request(
    *,
    tenant_id: int,
    employee_id: int,
    leave_type: str,
    start_date: date,
    end_date: date,
    reason: str | None,
    conn: Any,
) -> dict[str, Any]:
    leave_type = leave_type.strip().lower()
    if leave_type not in LEAVE_TYPES:
        raise ValueError("Invalid leave type")
    days = count_weekdays(start=start_date, end=end_date)
    if days <= 0:
        raise ValueError("Leave must include at least one working day (Mon–Fri).")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM employees
            WHERE tenant_id = %s AND id = %s AND status IN ('active', 'onboarding', 'suspended')
            """,
            (tenant_id, employee_id),
        )
        if not cur.fetchone():
            raise LookupError("Employee not found or not eligible for leave requests")

        cur.execute(
            """
            SELECT 1 FROM leave_requests
            WHERE tenant_id = %s AND employee_id = %s AND status = 'pending'
              AND NOT (end_date < %s OR start_date > %s)
            LIMIT 1
            """,
            (tenant_id, employee_id, start_date, end_date),
        )
        if cur.fetchone():
            raise ValueError("You already have a pending leave request overlapping these dates.")

        if leave_type == "annual":
            balance = leave_balance(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
            if days > balance["remaining_days"]:
                raise ValueError(
                    f"Not enough annual leave — {balance['remaining_days']:.1f} working day(s) remaining."
                )

        cur.execute(
            """
            INSERT INTO leave_requests (
              tenant_id, employee_id, leave_type, start_date, end_date,
              days_requested, reason, status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
            RETURNING id
            """,
            (tenant_id, employee_id, leave_type, start_date, end_date, days, (reason or "").strip() or None),
        )
        request_id = int(cur.fetchone()[0])
    conn.commit()
    items = list_leave_requests(tenant_id=tenant_id, conn=conn, employee_id=employee_id, limit=500)
    match = next((item for item in items if item["id"] == request_id), None)
    if not match:
        raise RuntimeError("Leave request created but could not be loaded")
    return match


def review_leave_request(
    *,
    tenant_id: int,
    request_id: int,
    decision: str,
    reviewed_by: str,
    review_note: str | None,
    conn: Any,
) -> dict[str, Any]:
    decision = decision.strip().lower()
    if decision not in {"approved", "rejected"}:
        raise ValueError("Decision must be approved or rejected.")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_id, leave_type, days_requested, status
            FROM leave_requests
            WHERE tenant_id = %s AND id = %s
            FOR UPDATE
            """,
            (tenant_id, request_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Leave request not found")
        employee_id, leave_type, days_requested, status = row
        if status != "pending":
            raise ValueError("Only pending requests can be reviewed.")
        if decision == "approved" and leave_type == "annual":
            balance = leave_balance(tenant_id=tenant_id, employee_id=int(employee_id), conn=conn)
            if float(days_requested) > balance["remaining_days"]:
                raise ValueError("Insufficient annual leave balance for approval.")
        cur.execute(
            """
            SELECT start_date, end_date FROM leave_requests
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, request_id),
        )
        period = cur.fetchone()
        start_date = period[0] if period else None
        end_date = period[1] if period else None
        cur.execute(
            """
            UPDATE leave_requests
            SET status = %s,
                reviewed_by = %s,
                reviewed_at = NOW(),
                review_note = %s,
                updated_at = NOW()
            WHERE tenant_id = %s AND id = %s
            """,
            (
                decision,
                reviewed_by.strip(),
                (review_note or "").strip() or None,
                tenant_id,
                request_id,
            ),
        )
    if decision == "approved" and start_date and end_date:
        try:
            sync_approved_leave_to_sponsor_absence(
                tenant_id=tenant_id,
                employee_id=int(employee_id),
                request_id=request_id,
                leave_type=str(leave_type),
                start_date=start_date,
                end_date=end_date,
                conn=conn,
            )
        except Exception:
            # Approval must still succeed even if sponsor mirroring fails.
            pass
    conn.commit()
    items = list_leave_requests(tenant_id=tenant_id, conn=conn, limit=500)
    match = next((item for item in items if item["id"] == request_id), None)
    if not match:
        raise RuntimeError("Leave request updated but could not be loaded")
    return match


def cancel_leave_request(
    *,
    tenant_id: int,
    request_id: int,
    employee_id: int,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE leave_requests
            SET status = 'cancelled', updated_at = NOW()
            WHERE tenant_id = %s AND id = %s AND employee_id = %s AND status = 'pending'
            RETURNING id
            """,
            (tenant_id, request_id, employee_id),
        )
        if not cur.fetchone():
            raise LookupError("Pending leave request not found")
    conn.commit()
    items = list_leave_requests(tenant_id=tenant_id, conn=conn, employee_id=employee_id, limit=500)
    match = next((item for item in items if item["id"] == request_id), None)
    if not match:
        raise RuntimeError("Leave request cancelled but could not be loaded")
    return match


def count_pending_leave_requests(*, tenant_id: int, conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM leave_requests
            WHERE tenant_id = %s AND status = 'pending'
            """,
            (tenant_id,),
        )
        return int(cur.fetchone()[0])
