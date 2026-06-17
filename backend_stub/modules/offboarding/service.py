"""Offboarding workflows — ACAS appeal window and sponsorship cessation."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from core.events import emit_event

from modules.offboarding.errors import ActiveWorkflowExistsError, WorkflowStateError

ACAS_APPEAL_DAYS = 21


def start_offboarding(
    *,
    tenant_id: int,
    employee_id: int,
    reason: str,
    grievance_case_id: int | None,
    actor_username: str,
    actor_role: str,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM offboarding_workflows
            WHERE tenant_id = %s AND employee_id = %s AND status = 'in_progress'
            LIMIT 1
            """,
            (tenant_id, employee_id),
        )
        existing = cur.fetchone()
        if existing:
            raise ActiveWorkflowExistsError(workflow_id=int(existing[0]), employee_id=employee_id)

        cur.execute(
            """
            SELECT COALESCE(esp.is_sponsored_worker, e.is_sponsored, FALSE)
            FROM employees e
            LEFT JOIN employee_sponsor_profiles esp
              ON esp.tenant_id = e.tenant_id AND esp.employee_id = e.id
            WHERE e.tenant_id = %s AND e.id = %s
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
        is_sponsored = bool(row[0]) if row else False

        appeal_deadline = date.today() + timedelta(days=ACAS_APPEAL_DAYS)
        cur.execute(
            """
            INSERT INTO offboarding_workflows (
              tenant_id, employee_id, grievance_case_id, reason,
              acas_appeal_deadline, sponsorship_cessation_required
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, status, acas_appeal_deadline, sponsorship_cessation_required, started_at
            """,
            (tenant_id, employee_id, grievance_case_id, reason, appeal_deadline, is_sponsored),
        )
        wf = cur.fetchone()
        workflow_id = wf[0]
    conn.commit()

    emit_event(
        conn=conn,
        tenant_id=tenant_id,
        event_type="offboarding.started",
        entity_type="offboarding_workflows",
        entity_id=workflow_id,
        payload={
            "workflow_id": workflow_id,
            "employee_id": employee_id,
            "reason": reason,
            "sponsorship_cessation_required": is_sponsored,
            "acas_appeal_deadline": appeal_deadline.isoformat(),
        },
        actor_username=actor_username,
        actor_role=actor_role,
    )
    return {
        "id": workflow_id,
        "employee_id": employee_id,
        "status": wf[1],
        "acas_appeal_deadline": wf[2].isoformat() if wf[2] else None,
        "sponsorship_cessation_required": wf[3],
        "started_at": wf[4].isoformat() if wf[4] else None,
    }


def list_workflows(*, tenant_id: int, conn: Any, limit: int = 100) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT w.id, w.employee_id, w.grievance_case_id, w.reason, w.status,
                   w.acas_appeal_deadline, w.sponsorship_cessation_required,
                   w.sponsorship_cessation_reported_at, w.sponsorship_cessation_reference,
                   w.started_at, w.completed_at, w.cancellation_reason,
                   e.first_name, e.last_name, e.department
            FROM offboarding_workflows w
            JOIN employees e ON e.id = w.employee_id AND e.tenant_id = w.tenant_id
            WHERE w.tenant_id = %s
            ORDER BY w.started_at DESC
            LIMIT %s
            """,
            (tenant_id, limit),
        )
        items = []
        for row in cur.fetchall():
            employee_name = " ".join(filter(None, [row[12], row[13]])).strip()
            items.append(
                {
                    "id": row[0],
                    "employee_id": row[1],
                    "employee_name": employee_name or str(row[1]),
                    "employee_department": row[14],
                    "grievance_case_id": row[2],
                    "reason": row[3],
                    "status": row[4],
                    "acas_appeal_deadline": row[5].isoformat() if row[5] else None,
                    "sponsorship_cessation_required": row[6],
                    "sponsorship_cessation_reported_at": row[7].isoformat() if row[7] else None,
                    "sponsorship_cessation_reference": row[8],
                    "started_at": row[9].isoformat() if row[9] else None,
                    "completed_at": row[10].isoformat() if row[10] else None,
                    "cancellation_reason": row[11],
                }
            )
        return items


def report_sponsorship_cessation(
    *,
    tenant_id: int,
    workflow_id: int,
    report_reference: str,
    actor_username: str,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE offboarding_workflows
            SET sponsorship_cessation_reported_at = NOW(),
                sponsorship_cessation_reference = %s,
                status = 'completed',
                completed_at = NOW()
            WHERE tenant_id = %s AND id = %s
            RETURNING id, employee_id, sponsorship_cessation_reference, status
            """,
            (report_reference, tenant_id, workflow_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("offboarding workflow not found")
    conn.commit()
    return {
        "id": row[0],
        "employee_id": row[1],
        "sponsorship_cessation_reference": row[2],
        "status": row[3],
    }


def _fetch_workflow_row(
    *,
    tenant_id: int,
    workflow_id: int,
    conn: Any,
) -> tuple[Any, ...] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, employee_id, status, sponsorship_cessation_required,
                   sponsorship_cessation_reference, acas_appeal_deadline
            FROM offboarding_workflows
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, workflow_id),
        )
        return cur.fetchone()


def complete_workflow(
    *,
    tenant_id: int,
    workflow_id: int,
    actor_username: str,
    actor_role: str,
    conn: Any,
) -> dict[str, Any]:
    row = _fetch_workflow_row(tenant_id=tenant_id, workflow_id=workflow_id, conn=conn)
    if not row:
        raise LookupError("offboarding workflow not found")
    if row[2] != "in_progress":
        raise WorkflowStateError("Only in-progress workflows can be marked complete.")
    if row[3] and not row[4]:
        raise WorkflowStateError("Report sponsor cessation before completing this workflow.")

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE offboarding_workflows
            SET status = 'completed', completed_at = NOW()
            WHERE tenant_id = %s AND id = %s
            RETURNING id, employee_id, status, completed_at
            """,
            (tenant_id, workflow_id),
        )
        updated = cur.fetchone()
    conn.commit()

    emit_event(
        conn=conn,
        tenant_id=tenant_id,
        event_type="offboarding.completed",
        entity_type="offboarding_workflows",
        entity_id=workflow_id,
        payload={"workflow_id": workflow_id, "employee_id": updated[1]},
        actor_username=actor_username,
        actor_role=actor_role,
    )

    return {
        "id": updated[0],
        "employee_id": updated[1],
        "status": updated[2],
        "completed_at": updated[3].isoformat() if updated[3] else None,
    }


def cancel_workflow(
    *,
    tenant_id: int,
    workflow_id: int,
    reason: str | None,
    actor_username: str,
    actor_role: str,
    conn: Any,
) -> dict[str, Any]:
    row = _fetch_workflow_row(tenant_id=tenant_id, workflow_id=workflow_id, conn=conn)
    if not row:
        raise LookupError("offboarding workflow not found")
    if row[2] != "in_progress":
        raise WorkflowStateError("Only in-progress workflows can be cancelled.")

    normalized_reason = (reason or "").strip() or None

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE offboarding_workflows
            SET status = 'cancelled',
                completed_at = NOW(),
                cancellation_reason = %s
            WHERE tenant_id = %s AND id = %s
            RETURNING id, employee_id, status, cancellation_reason, completed_at
            """,
            (normalized_reason, tenant_id, workflow_id),
        )
        updated = cur.fetchone()
    conn.commit()

    emit_event(
        conn=conn,
        tenant_id=tenant_id,
        event_type="offboarding.cancelled",
        entity_type="offboarding_workflows",
        entity_id=workflow_id,
        payload={
            "workflow_id": workflow_id,
            "employee_id": updated[1],
            "cancellation_reason": normalized_reason,
        },
        actor_username=actor_username,
        actor_role=actor_role,
    )

    return {
        "id": updated[0],
        "employee_id": updated[1],
        "status": updated[2],
        "cancellation_reason": updated[3],
        "completed_at": updated[4].isoformat() if updated[4] else None,
    }
