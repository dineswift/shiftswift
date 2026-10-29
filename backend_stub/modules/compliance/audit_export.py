"""Sponsor licence audit export pack and expiry alert jobs."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date, datetime
from typing import Any

from modules.documents.constants import IDENTITY_EXPIRY_CATEGORIES


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _employee_name(first_name: Any, last_name: Any, employee_id: Any) -> str:
    name = f"{first_name or ''} {last_name or ''}".strip()
    return name or f"Employee #{employee_id}"


def _column_exists(cur: Any, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        LIMIT 1
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def _append_employee_filter(sql: str, params: list[Any], employee_id: int | None, column: str) -> str:
    if employee_id:
        sql += f" AND {column} = %s"
        params.append(employee_id)
    return sql


def build_audit_export(*, tenant_id: int, employee_id: int | None, conn: Any) -> dict[str, Any]:
    """Compile a Home Office inspection pack: workers, RTW, visa docs, SMS, absences, adverts."""
    pack: dict[str, Any] = {
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "generated_on": date.today().isoformat(),
        "sections": {},
    }

    with conn.cursor() as cur:
        has_rtw_check_expiry = _column_exists(cur, "employee_sponsor_profiles", "rtw_check_expiry_date")

        rtw_sql = """
            SELECT rtw.id, rtw.employee_id, rtw.check_date, rtw.check_method, rtw.outcome,
                   rtw.expiry_date, rtw.checker_user_id, rtw.content_sha256, rtw.storage_path,
                   e.first_name, e.last_name
            FROM right_to_work_checks rtw
            LEFT JOIN employees e ON e.id = rtw.employee_id AND e.tenant_id = rtw.tenant_id
            WHERE rtw.tenant_id = %s
        """
        rtw_params: list[Any] = [tenant_id]
        rtw_sql = _append_employee_filter(rtw_sql, rtw_params, employee_id, "rtw.employee_id")
        rtw_sql += " ORDER BY rtw.check_date DESC LIMIT 500"
        cur.execute(rtw_sql, rtw_params)
        pack["sections"]["right_to_work_checks"] = [
            {
                "id": r[0],
                "employee_id": r[1],
                "employee_name": _employee_name(r[9], r[10], r[1]),
                "check_date": _iso(r[2]),
                "check_method": r[3],
                "outcome": r[4],
                "expiry_date": _iso(r[5]),
                "checker_user_id": r[6],
                "content_sha256": r[7],
                "storage_path": r[8],
                "has_file": bool(r[8]),
            }
            for r in cur.fetchall()
        ]

        sms_sql = """
            SELECT sms.employee_id, e.first_name, e.last_name, sms.field_name,
                   sms.old_value, sms.new_value, sms.changed_at,
                   sms.sms_reporting_deadline, sms.alert_status
            FROM sponsor_sms_change_log sms
            LEFT JOIN employees e ON e.id = sms.employee_id AND e.tenant_id = sms.tenant_id
            WHERE sms.tenant_id = %s
        """
        sms_params: list[Any] = [tenant_id]
        sms_sql = _append_employee_filter(sms_sql, sms_params, employee_id, "sms.employee_id")
        sms_sql += " ORDER BY sms.changed_at DESC LIMIT 500"
        cur.execute(sms_sql, sms_params)
        pack["sections"]["sms_change_log"] = [
            {
                "employee_id": r[0],
                "employee_name": _employee_name(r[1], r[2], r[0]),
                "field_name": r[3],
                "old_value": r[4],
                "new_value": r[5],
                "changed_at": _iso(r[6]),
                "sms_reporting_deadline": _iso(r[7]),
                "alert_status": r[8],
            }
            for r in cur.fetchall()
        ]

        expiry_select = ", esp.rtw_check_expiry_date" if has_rtw_check_expiry else ", NULL"
        workers_sql = f"""
            SELECT e.id, e.first_name, e.last_name, e.job_title, e.status,
                   esp.visa_type, esp.visa_expiry_date, esp.share_code, esp.cos_reference,
                   esp.rtw_status{expiry_select}
            FROM employees e
            JOIN employee_sponsor_profiles esp
              ON esp.employee_id = e.id AND esp.tenant_id = e.tenant_id
            WHERE e.tenant_id = %s AND esp.is_sponsored_worker = TRUE
        """
        workers_params: list[Any] = [tenant_id]
        workers_sql = _append_employee_filter(workers_sql, workers_params, employee_id, "e.id")
        workers_sql += " ORDER BY e.last_name, e.first_name LIMIT 500"
        cur.execute(workers_sql, workers_params)
        pack["sections"]["sponsored_workers"] = [
            {
                "employee_id": r[0],
                "employee_name": _employee_name(r[1], r[2], r[0]),
                "job_title": r[3],
                "status": r[4],
                "visa_type": r[5],
                "visa_expiry_date": _iso(r[6]),
                "share_code": r[7],
                "cos_reference": r[8],
                "rtw_status": r[9],
                "rtw_check_expiry_date": _iso(r[10]),
            }
            for r in cur.fetchall()
        ]

        absence_sql = """
            SELECT a.id, a.employee_id, e.first_name, e.last_name, a.consecutive_working_days,
                   a.alert_status, a.home_office_report_required_by, a.triggered_at
            FROM sponsor_absence_alerts a
            LEFT JOIN employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
            WHERE a.tenant_id = %s
        """
        absence_params: list[Any] = [tenant_id]
        absence_sql = _append_employee_filter(absence_sql, absence_params, employee_id, "a.employee_id")
        absence_sql += " ORDER BY a.triggered_at DESC LIMIT 200"
        cur.execute(absence_sql, absence_params)
        pack["sections"]["absence_alerts"] = [
            {
                "id": r[0],
                "employee_id": r[1],
                "employee_name": _employee_name(r[2], r[3], r[1]),
                "consecutive_working_days": r[4],
                "alert_status": r[5],
                "home_office_report_required_by": _iso(r[6]),
                "triggered_at": _iso(r[7]),
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT job_title, platform, advert_url, posted_date, job_reference
            FROM recruitment_advertisement_records
            WHERE tenant_id = %s ORDER BY posted_date DESC LIMIT 100
            """,
            (tenant_id,),
        )
        pack["sections"]["advertisement_records"] = [
            {
                "job_title": r[0],
                "platform": r[1],
                "advert_url": r[2],
                "posted_date": _iso(r[3]),
                "job_reference": r[4],
            }
            for r in cur.fetchall()
        ]

        trigger_sql = """
            SELECT t.id, t.employee_id, e.first_name, e.last_name, t.trigger_type,
                   t.description, t.deadline_date, t.status, t.created_at
            FROM sponsor_reporting_triggers t
            LEFT JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
            WHERE t.tenant_id = %s
        """
        trigger_params: list[Any] = [tenant_id]
        trigger_sql = _append_employee_filter(trigger_sql, trigger_params, employee_id, "t.employee_id")
        trigger_sql += " ORDER BY t.created_at DESC LIMIT 100"
        cur.execute(trigger_sql, trigger_params)
        pack["sections"]["reporting_triggers"] = [
            {
                "id": r[0],
                "employee_id": r[1],
                "employee_name": _employee_name(r[2], r[3], r[1]),
                "trigger_type": r[4],
                "description": r[5],
                "deadline_date": _iso(r[6]),
                "status": r[7],
                "created_at": _iso(r[8]),
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT event_type, entity_type, entity_id, payload, created_at
            FROM compliance_audit_events
            WHERE tenant_id = %s ORDER BY created_at DESC LIMIT 500
            """,
            (tenant_id,),
        )
        pack["sections"]["compliance_audit_events"] = [
            {
                "event_type": r[0],
                "entity_type": r[1],
                "entity_id": r[2],
                "payload": r[3],
                "created_at": _iso(r[4]),
            }
            for r in cur.fetchall()
        ]

        tenant_sql = """
            SELECT id, title, category, lifecycle_stage, document_url, employee_id,
                   expires_at, content_sha256, storage_path, original_filename, created_at
            FROM tenant_documents
            WHERE tenant_id = %s
        """
        tenant_params: list[Any] = [tenant_id]
        tenant_sql = _append_employee_filter(tenant_sql, tenant_params, employee_id, "employee_id")
        tenant_sql += " ORDER BY created_at DESC LIMIT 200"
        cur.execute(tenant_sql, tenant_params)
        pack["sections"]["tenant_documents"] = [
            {
                "id": r[0],
                "title": r[1],
                "category": r[2],
                "lifecycle_stage": r[3],
                "document_url": r[4],
                "employee_id": r[5],
                "expires_at": _iso(r[6]),
                "content_sha256": r[7],
                "storage_path": r[8],
                "has_file": bool(r[8]),
                "original_filename": r[9],
                "created_at": _iso(r[10]),
            }
            for r in cur.fetchall()
        ]

        emp_sql = """
            SELECT d.id, d.employee_id, e.first_name, e.last_name, d.title, d.category,
                   d.lifecycle_stage, d.document_url, d.expires_at, d.content_sha256,
                   d.storage_path, d.original_filename, d.created_at
            FROM employee_documents d
            LEFT JOIN employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id
            WHERE d.tenant_id = %s
        """
        emp_params: list[Any] = [tenant_id]
        emp_sql = _append_employee_filter(emp_sql, emp_params, employee_id, "d.employee_id")
        emp_sql += " ORDER BY d.created_at DESC LIMIT 500"
        cur.execute(emp_sql, emp_params)
        employee_documents = [
            {
                "id": r[0],
                "employee_id": r[1],
                "employee_name": _employee_name(r[2], r[3], r[1]),
                "title": r[4],
                "category": r[5],
                "lifecycle_stage": r[6],
                "document_url": r[7],
                "expires_at": _iso(r[8]),
                "content_sha256": r[9],
                "storage_path": r[10],
                "has_file": bool(r[10]),
                "original_filename": r[11],
                "created_at": _iso(r[12]),
            }
            for r in cur.fetchall()
        ]
        pack["sections"]["employee_documents"] = employee_documents
        pack["sections"]["identity_documents"] = [
            doc
            for doc in employee_documents
            if str(doc.get("category") or "").lower() in IDENTITY_EXPIRY_CATEGORIES
        ]

    pack["summary"] = {
        "sponsored_workers": len(pack["sections"]["sponsored_workers"]),
        "rtw_checks": len(pack["sections"]["right_to_work_checks"]),
        "sms_changes": len(pack["sections"]["sms_change_log"]),
        "absence_alerts": len(pack["sections"]["absence_alerts"]),
        "adverts": len(pack["sections"]["advertisement_records"]),
        "reporting_triggers": len(pack["sections"]["reporting_triggers"]),
        "tenant_documents": len(pack["sections"]["tenant_documents"]),
        "employee_documents": len(pack["sections"]["employee_documents"]),
        "identity_documents": len(pack["sections"]["identity_documents"]),
    }
    return pack


def _safe_zip_write(archive: zipfile.ZipFile, arcname: str, source: Any) -> None:
    try:
        if hasattr(source, "read_bytes"):
            archive.write(source, arcname)
        else:
            archive.writestr(arcname, source)
    except OSError:
        return


def build_audit_export_zip(*, tenant_id: int, employee_id: int | None, conn: Any) -> bytes:
    """JSON + PDF index plus ID / visa / RTW evidence files for an inspection."""
    from fastapi import HTTPException

    from modules.compliance.audit_pdf import audit_export_pdf_bytes
    from modules.documents.storage import resolve_rtw_file, resolve_stored_file

    pack = build_audit_export(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    pdf_bytes = audit_export_pdf_bytes(
        tenant_id=tenant_id, employee_id=employee_id, conn=conn, pack=pack
    )
    public_pack = json.loads(json.dumps(pack))
    for section in ("right_to_work_checks", "employee_documents", "tenant_documents", "identity_documents"):
        for row in public_pack["sections"].get(section, []):
            row.pop("storage_path", None)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.txt", AUDIT_PACK_README)
        archive.writestr("audit-pack.json", json.dumps(public_pack, indent=2))
        archive.writestr("audit-pack.pdf", pdf_bytes)
        for check in pack["sections"].get("right_to_work_checks") or []:
            if not check.get("storage_path"):
                continue
            try:
                path = resolve_rtw_file(tenant_id=tenant_id, storage_path=check.get("storage_path"))
            except HTTPException:
                continue
            check_id = check.get("id")
            employee_id_value = check.get("employee_id")
            check_date = check.get("check_date") or "unknown-date"
            _safe_zip_write(
                archive,
                f"files/rtw/{employee_id_value}/rtw-check-{check_id}_{check_date}.pdf",
                path,
            )
        for doc in pack["sections"].get("identity_documents") or []:
            if not doc.get("storage_path"):
                continue
            try:
                path = resolve_stored_file(tenant_id=tenant_id, storage_path=doc.get("storage_path"))
            except HTTPException:
                continue
            original = str(doc.get("original_filename") or f"{doc.get('id')}_{doc.get('title') or 'document'}")
            category = str(doc.get("category") or "identity")
            employee_id_value = doc.get("employee_id")
            _safe_zip_write(
                archive,
                f"files/identity/{employee_id_value}/{category}/{original}",
                path,
            )
    return buffer.getvalue()


AUDIT_PACK_README = """ShiftSwift HR — Home Office audit pack
=====================================

This zip is an inspection index plus copies of identity / right-to-work evidence
your team stored in ShiftSwift. It is a record pack, not a substitute for SMS
submissions or GOV.UK checks.

Contents
--------
audit-pack.pdf     Summary tables (sponsored workers, RTW, visa/ID, SMS, absences)
audit-pack.json    Full machine-readable index
files/rtw/         Immutable right-to-work check PDFs
files/identity/    ID / passport, visa / BRP, and right-to-work check copies

You remain responsible for performing checks and reporting through official
Home Office channels.
"""



def evaluate_visa_expiry_alerts(*, tenant_id: int, as_of: date, conn: Any) -> list[dict[str, Any]]:
    thresholds = [90, 60, 30, 7]
    alerts: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        for days in thresholds:
            target = as_of.toordinal() + days
            target_date = date.fromordinal(target)
            cur.execute(
                """
                SELECT esp.employee_id, esp.visa_expiry_date, e.first_name, e.last_name
                FROM employee_sponsor_profiles esp
                JOIN employees e ON e.id = esp.employee_id AND e.tenant_id = esp.tenant_id
                WHERE esp.tenant_id = %s
                  AND esp.is_sponsored_worker = TRUE
                  AND esp.visa_expiry_date = %s
                """,
                (tenant_id, target_date),
            )
            for employee_id, expiry, first_name, last_name in cur.fetchall():
                alerts.append(
                    {
                        "employee_id": employee_id,
                        "employee_name": f"{first_name} {last_name}",
                        "visa_expiry_date": expiry.isoformat(),
                        "days_until_expiry": days,
                        "threshold": days,
                    }
                )
                from core.notifications import build_email_payload

                email_payload = build_email_payload(
                    tenant_id=tenant_id,
                    conn=conn,
                    purpose="compliance",
                    payload={
                        "employee_id": employee_id,
                        "days": days,
                        "type": "visa_expiry",
                    },
                )
                cur.execute(
                    """
                    INSERT INTO notifications (tenant_id, channel, subject, body, payload, status)
                    VALUES (%s, 'email', %s, %s, %s::jsonb, 'queued')
                    """,
                    (
                        tenant_id,
                        f"Visa expiry in {days} days",
                        f"Sponsored worker {first_name} {last_name} visa expires on {expiry.isoformat()}.",
                        json.dumps(email_payload),
                    ),
                )
    conn.commit()
    return alerts


def evaluate_rtw_expiry_alerts(*, tenant_id: int, as_of: date, conn: Any) -> list[dict[str, Any]]:
    thresholds = [90, 60, 30, 7]
    alerts: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        has_profile_expiry = _column_exists(cur, "employee_sponsor_profiles", "rtw_check_expiry_date")
        for days in thresholds:
            target_date = date.fromordinal(as_of.toordinal() + days)
            if has_profile_expiry:
                cur.execute(
                    """
                    SELECT esp.employee_id, esp.rtw_check_expiry_date,
                           (
                             SELECT c.id FROM right_to_work_checks c
                             WHERE c.tenant_id = esp.tenant_id AND c.employee_id = esp.employee_id
                             ORDER BY c.check_date DESC, c.id DESC
                             LIMIT 1
                           )
                    FROM employee_sponsor_profiles esp
                    WHERE esp.tenant_id = %s AND esp.rtw_check_expiry_date = %s
                    """,
                    (tenant_id, target_date),
                )
                for employee_id, expiry, check_id in cur.fetchall():
                    alerts.append(
                        {
                            "employee_id": employee_id,
                            "rtw_check_id": check_id or employee_id,
                            "expiry_date": expiry.isoformat(),
                            "days_until_expiry": days,
                        }
                    )
                cur.execute(
                    """
                    SELECT DISTINCT ON (c.employee_id) c.employee_id, c.expiry_date, c.id
                    FROM right_to_work_checks c
                    WHERE c.tenant_id = %s AND c.expiry_date = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM employee_sponsor_profiles esp
                        WHERE esp.tenant_id = c.tenant_id AND esp.employee_id = c.employee_id
                          AND esp.rtw_check_expiry_date IS NOT NULL
                      )
                    ORDER BY c.employee_id, c.check_date DESC, c.id DESC
                    """,
                    (tenant_id, target_date),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT ON (employee_id) employee_id, expiry_date, id
                    FROM right_to_work_checks
                    WHERE tenant_id = %s AND expiry_date = %s
                    ORDER BY employee_id, check_date DESC
                    """,
                    (tenant_id, target_date),
                )
            for employee_id, expiry, check_id in cur.fetchall():
                alerts.append(
                    {
                        "employee_id": employee_id,
                        "rtw_check_id": check_id,
                        "expiry_date": expiry.isoformat(),
                        "days_until_expiry": days,
                    }
                )
    return alerts
