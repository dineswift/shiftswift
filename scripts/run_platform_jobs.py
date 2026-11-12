#!/usr/bin/env python3
"""Unified platform background jobs — compliance, visa/RTW expiry, domain events."""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend_stub"))

from core.events import process_pending_events  # noqa: E402
from sponsor_licence_compliance import (  # noqa: E402
    evaluate_day9_absence_alerts,
    refresh_sms_change_alert_statuses,
)
from modules.hr_templates.sync import sync_all_templates  # noqa: E402
from modules.rota.missed_punch import evaluate_missed_punch_alerts  # noqa: E402
from core.notifications import queue_notification  # noqa: E402
from trial_service import process_trial_reminders  # noqa: E402
from license_service import process_payment_failure_cycle  # noqa: E402


def _connect():
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required")
    return psycopg2.connect(url)


def _tenant_ids(conn) -> list[int]:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM tenants ORDER BY id")
        return [row[0] for row in cur.fetchall()]


def _queue_notification(conn, tenant_id: int, channel: str, subject: str, body: str, payload: dict) -> None:
    try:
        purpose = "compliance" if channel == "email" else "general"
        queue_notification(
            conn=conn,
            tenant_id=tenant_id,
            channel=channel,
            subject=subject,
            body=body,
            payload=payload,
            purpose=purpose,
        )
    except Exception as exc:
        print(json.dumps({"warning": "notification_queue_unavailable", "error": str(exc)}))


def main() -> int:
    as_of = date.today()
    conn = _connect()
    summary = {
        "absence_alerts": 0,
        "sms_statuses_updated": 0,
        "visa_expiry_alerts": 0,
        "rtw_expiry_alerts": 0,
        "events_processed": 0,
        "notifications": {"sent": 0, "failed": 0, "processed": 0},
        "hr_templates": {"created": 0, "updated": 0, "unchanged": 0},
        "trial_reminders": {"checked": 0, "reminders_sent": 0, "expired": 0},
        "payment_failure": {"checked": 0, "reminders_sent": 0, "holds_applied": 0},
        "portal_setup_reminders": {"tenants_checked": 0, "reminders_sent": 0, "pending_employees": 0},
        "payroll_hours_reports": {"tenants_checked": 0, "reports_sent": 0, "skipped": 0},
        "missed_punch_alerts": 0,
        "push_reminders": 0,
        "signin_reminders": 0,
        "document_expiry_alerts": 0,
        "sms_login_reminders": 0,
    }
    try:
        job_now = datetime.now(timezone.utc)
        for tenant_id in _tenant_ids(conn):
            alerts = evaluate_day9_absence_alerts(tenant_id=tenant_id, as_of=as_of, conn=conn)
            for alert in alerts:
                subject = "ShiftSwift HR: Day 9 sponsor absence alert"
                body = (
                    f"Sponsored worker #{alert['employee_id']} — "
                    f"{alert['consecutive_working_days']} consecutive working-day absences."
                )
                for channel in alert.get("channels", ["email"]):
                    _queue_notification(conn, tenant_id, channel, subject, body, alert)
                summary["absence_alerts"] += 1
            summary["sms_statuses_updated"] += refresh_sms_change_alert_statuses(
                tenant_id=tenant_id, as_of=as_of, conn=conn
            )
            from modules.compliance.expiry_notify_jobs import (
                dispatch_document_expiry_alerts,
                dispatch_rtw_expiry_alerts,
                dispatch_sms_login_reminder,
                dispatch_visa_expiry_alerts,
            )

            visa_alerts = dispatch_visa_expiry_alerts(tenant_id=tenant_id, as_of=as_of, conn=conn)
            summary["visa_expiry_alerts"] += len(visa_alerts)
            rtw_alerts = dispatch_rtw_expiry_alerts(tenant_id=tenant_id, as_of=as_of, conn=conn)
            summary["rtw_expiry_alerts"] += len(rtw_alerts)
            doc_alerts = dispatch_document_expiry_alerts(tenant_id=tenant_id, as_of=as_of, conn=conn)
            summary["document_expiry_alerts"] += len(doc_alerts)
            sms_login = dispatch_sms_login_reminder(tenant_id=tenant_id, now=job_now, conn=conn)
            if sms_login.get("sent"):
                summary["sms_login_reminders"] += 1
            missed = evaluate_missed_punch_alerts(tenant_id=tenant_id, conn=conn, now=job_now)
            summary["missed_punch_alerts"] += len(missed)
            from modules.push.shift_reminders import evaluate_shift_push_reminders

            push_sent = evaluate_shift_push_reminders(tenant_id=tenant_id, conn=conn, now=job_now)
            summary["push_reminders"] = summary.get("push_reminders", 0) + len(push_sent)
            from modules.employees.signin_reminders import evaluate_signin_reminders

            signin_sent = evaluate_signin_reminders(tenant_id=tenant_id, conn=conn, now=job_now)
            summary["signin_reminders"] = summary.get("signin_reminders", 0) + len(signin_sent)
        summary["events_processed"] = process_pending_events(conn=conn)
        summary["hr_templates"] = sync_all_templates(conn=conn)
        summary["trial_reminders"] = process_trial_reminders(conn=conn)
        summary["payment_failure"] = process_payment_failure_cycle(conn=conn)
        from config import load_settings
        from modules.employees.portal_invites import process_portal_setup_reminders

        summary["portal_setup_reminders"] = process_portal_setup_reminders(
            conn=conn,
            settings=load_settings(),
        )
        from modules.payroll_export.monthly_report import process_monthly_payroll_hours_reports

        summary["payroll_hours_reports"] = process_monthly_payroll_hours_reports(
            settings=load_settings(),
            conn=conn,
            as_of=as_of,
        )
        from core.notifications import process_queued_notifications

        summary["notifications"] = process_queued_notifications(conn=conn)
    finally:
        conn.close()
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
