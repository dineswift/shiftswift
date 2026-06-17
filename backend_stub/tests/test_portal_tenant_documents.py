"""Portal access rules for company-wide tenant documents."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.documents.service import portal_document_visible, tenant_document_accessible_to_employee


def test_tenant_document_accessible_to_employee_company_wide() -> None:
    doc = {"employee_id": None}
    assert tenant_document_accessible_to_employee(doc, 42) is True


def test_tenant_document_accessible_to_employee_assigned_match() -> None:
    doc = {"employee_id": 42}
    assert tenant_document_accessible_to_employee(doc, 42) is True


def test_tenant_document_accessible_to_employee_assigned_other() -> None:
    doc = {"employee_id": 7}
    assert tenant_document_accessible_to_employee(doc, 42) is False


def test_portal_document_visible_respects_employee_visible_flag() -> None:
    assert portal_document_visible({"has_file": True, "employee_visible": False}) is False
    assert portal_document_visible({"has_file": True, "employee_visible": True}) is True


def test_portal_document_visible_hr_only_company_doc_hidden_by_default() -> None:
    doc = {"has_file": True, "employee_visible": False, "category": "disciplinary"}
    assert portal_document_visible(doc) is False
