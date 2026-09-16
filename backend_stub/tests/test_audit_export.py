"""Home Office audit export includes all employees, visa/RTW, and identity documents."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.compliance.audit_export import build_audit_export
from modules.compliance.audit_pdf import audit_export_pdf_bytes


class _ScriptingCursor:
    def __init__(self):
        self.sql = ""

    def execute(self, sql, params=None):
        self.sql = " ".join(str(sql).split())
        self.params = params or []

    def fetchone(self):
        if "information_schema.columns" in self.sql:
            return (1,)
        return None

    def fetchall(self):
        sql = self.sql.lower()
        if "right_to_work_checks" in sql:
            return [
                (
                    11,
                    9,
                    date(2026, 1, 15),
                    "Manual PDF upload",
                    "pass",
                    date(2026, 12, 1),
                    "hr",
                    "abc123",
                    "/tmp/rtw.pdf",
                    "Karun",
                    "Acharya",
                )
            ]
        if "employee_sponsor_profiles" in sql and "is_sponsored_worker" in sql:
            return [
                (
                    9,
                    "Karun",
                    "Acharya",
                    "Chef",
                    "active",
                    "Skilled Worker",
                    date(2027, 3, 1),
                    "SHARE1",
                    "COS123",
                    "verified",
                    date(2026, 12, 1),
                )
            ]
        if "employee_documents" in sql:
            return [
                (
                    21,
                    9,
                    "Karun",
                    "Acharya",
                    "BRP front",
                    "visa_brp",
                    "document_store",
                    None,
                    date(2027, 3, 1),
                    "sha1",
                    "/tmp/brp.jpg",
                    "brp.jpg",
                    date(2026, 2, 1),
                ),
                (
                    22,
                    9,
                    "Karun",
                    "Acharya",
                    "Contract",
                    "contract",
                    "document_store",
                    None,
                    None,
                    "sha2",
                    "/tmp/contract.pdf",
                    "contract.pdf",
                    date(2026, 2, 1),
                ),
            ]
        return []


def _conn() -> MagicMock:
    conn = MagicMock()
    cursor = _ScriptingCursor()
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn


def test_all_employees_export_includes_rtw_checks() -> None:
    pack = build_audit_export(tenant_id=1, employee_id=None, conn=_conn())
    assert pack["summary"]["rtw_checks"] == 1
    assert pack["sections"]["right_to_work_checks"][0]["employee_name"] == "Karun Acharya"
    assert pack["sections"]["right_to_work_checks"][0]["expiry_date"] == "2026-12-01"


def test_audit_pack_includes_sponsored_workers_and_identity_docs() -> None:
    pack = build_audit_export(tenant_id=1, employee_id=None, conn=_conn())
    assert pack["summary"]["sponsored_workers"] == 1
    worker = pack["sections"]["sponsored_workers"][0]
    assert worker["visa_expiry_date"] == "2027-03-01"
    assert worker["rtw_check_expiry_date"] == "2026-12-01"
    assert pack["summary"]["identity_documents"] == 1
    assert pack["sections"]["identity_documents"][0]["category"] == "visa_brp"
    assert pack["summary"]["employee_documents"] == 2


def test_audit_pdf_lists_visa_and_rtw_sections() -> None:
    pack = build_audit_export(tenant_id=1, employee_id=None, conn=_conn())
    pdf = audit_export_pdf_bytes(tenant_id=1, employee_id=None, conn=_conn(), pack=pack)
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500
    assert pack["sections"]["sponsored_workers"]
    assert pack["sections"]["identity_documents"]
