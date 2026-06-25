"""Employee workspace view — lifecycle sections with completion status."""

from __future__ import annotations

from typing import Any

from modules.documents.service import (
    list_employee_documents,
    requirements_status,
    validate_information_fields,
)
from modules.employees.constants import (
    COMPLIANCE_REPORTING_FIELDS,
    DOCUMENT_SECTIONS,
    LINK_ONLY_SECTIONS,
    SECTION_BRANCHES,
    SECTION_DESCRIPTIONS,
    SECTION_KINDS,
    SECTION_LABELS,
    SECTION_ORDER,
    SECTION_STEPS,
)
from modules.employees.repository import (
    fetch_employee,
    section_field_names,
    update_employee_fields,
    update_sponsorship_fields,
)

EDITABLE_KINDS = frozenset({"form", "documents"})


def _is_filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _documents_from_categories(categories: list[str] | None) -> list[dict[str, Any]]:
    return [{"category": category} for category in (categories or [])]


def _section_data(section: str, employee: dict[str, Any]) -> dict[str, Any]:
    if section == "compliance_reporting":
        sponsor = employee.get("sponsorship") or {}
        return {
            "visa_type": sponsor.get("visa_type"),
            "visa_expiry_date": sponsor.get("visa_expiry_date"),
            "share_code": sponsor.get("share_code"),
            "cos_reference": sponsor.get("cos_reference"),
            "rtw_status": sponsor.get("rtw_status", "pending"),
        }
    if section == "recruitment":
        data = {
            field: employee.get(field)
            for field in section_field_names(section)
            if field != "worker_type"
        }
        data["worker_type"] = "sponsored" if employee.get("is_sponsored") else "standard"
        return data
    return {field: employee.get(field) for field in section_field_names(section)}


def _section_complete(
    section: str,
    employee: dict[str, Any],
    *,
    requirements_complete: bool,
) -> bool:
    if section in LINK_ONLY_SECTIONS:
        return True
    if section == "recruitment":
        return _is_filled(employee.get("first_name")) and _is_filled(employee.get("last_name"))
    if section == "onboarding":
        return _is_filled(employee.get("job_title")) and _is_filled(employee.get("start_date"))
    if section == "induction":
        return (
            _is_filled(employee.get("phone"))
            and _is_filled(employee.get("home_address"))
            and _is_filled(employee.get("emergency_contact_name"))
            and _is_filled(employee.get("emergency_contact_phone"))
        )
    if section == "document_store":
        return requirements_complete
    if section == "job_performance":
        return _is_filled(employee.get("salary"))
    if section == "compliance_reporting":
        if not employee.get("is_sponsored"):
            return True
        sponsor = employee.get("sponsorship") or {}
        return _is_filled(sponsor.get("visa_type")) and (
            _is_filled(sponsor.get("share_code")) or _is_filled(sponsor.get("cos_reference"))
        )
    if section == "offboarding":
        if employee.get("status") != "terminated":
            return True
        return _is_filled(employee.get("termination_date"))
    return False


def _section_applicable(section: str, employee: dict[str, Any]) -> bool:
    if section == "compliance_reporting":
        return bool(employee.get("is_sponsored"))
    if section == "job_performance":
        return True
    if section == "offboarding":
        return employee.get("status") == "terminated"
    return True


def _build_sections(
    *,
    employee: dict[str, Any],
    requirements_complete: bool,
) -> list[dict[str, Any]]:
    sections = []
    for key in SECTION_ORDER:
        if not _section_applicable(key, employee):
            continue
        sections.append(
            {
                "key": key,
                "step": SECTION_STEPS[key],
                "label": SECTION_LABELS[key],
                "description": SECTION_DESCRIPTIONS[key],
                "branch": SECTION_BRANCHES.get(key),
                "kind": SECTION_KINDS[key],
                "complete": _section_complete(
                    key,
                    employee,
                    requirements_complete=requirements_complete,
                ),
                "data": _section_data(key, employee),
            }
        )
    return sections


def build_workspace(*, tenant_id: int, employee_id: int, conn: Any) -> dict[str, Any]:
    from admin_service import get_tenant_profile

    employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not employee:
        raise LookupError("employee not found")

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    employee["_payroll_enabled"] = bool(profile.get("payroll_enabled"))

    documents = list_employee_documents(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    from modules.document_signing.service import attach_signing_status

    documents = attach_signing_status(tenant_id=tenant_id, documents=documents, conn=conn)
    req_status = requirements_status(
        is_sponsored=bool(employee.get("is_sponsored")),
        documents=documents,
    )

    sections = _build_sections(employee=employee, requirements_complete=req_status["complete"])
    editable = [s for s in sections if s["kind"] in EDITABLE_KINDS]
    completed = sum(1 for s in editable if s["complete"])
    completion_pct = int(round((completed / len(editable)) * 100)) if editable else 0

    from modules.employees.portal_invites import enrich_employees_portal_status

    portal_meta = enrich_employees_portal_status(
        tenant_id=tenant_id,
        employees=[employee],
        conn=conn,
    )[0]

    return {
        "employee": {**employee, **portal_meta},
        "documents": documents,
        "document_requirements": req_status,
        "sections": sections,
        "lifecycle": [
            {
                "value": key,
                "step": SECTION_STEPS[key],
                "label": SECTION_LABELS[key],
                "description": SECTION_DESCRIPTIONS[key],
            }
            for key in SECTION_ORDER
        ],
        "completion_pct": completion_pct,
        "next_section": next((s["key"] for s in sections if not s["complete"] and s["kind"] in EDITABLE_KINDS), None),
        "payroll_enabled": employee["_payroll_enabled"],
    }


def list_completion_summary(
    employee: dict[str, Any],
    *,
    payroll_enabled: bool = False,
    document_categories: list[str] | None = None,
) -> dict[str, Any]:
    employee = {**employee, "_payroll_enabled": payroll_enabled}
    docs = _documents_from_categories(document_categories)
    req_status = requirements_status(
        is_sponsored=bool(employee.get("is_sponsored")),
        documents=docs,
    )
    sections = _build_sections(employee=employee, requirements_complete=req_status["complete"])
    editable = [s for s in sections if s["kind"] in EDITABLE_KINDS]
    completed = sum(1 for s in editable if s["complete"])
    completion_pct = int(round((completed / len(editable)) * 100)) if editable else 0
    return {
        "completion_pct": completion_pct,
        "next_section": next((s["key"] for s in sections if not s["complete"] and s["kind"] in EDITABLE_KINDS), None),
    }


def patch_section(
    *,
    tenant_id: int,
    employee_id: int,
    section: str,
    updates: dict[str, Any],
    actor_username: str,
    actor_role: str,
    conn: Any,
) -> dict[str, Any]:
    if section not in SECTION_ORDER or section in LINK_ONLY_SECTIONS or section in DOCUMENT_SECTIONS:
        raise ValueError("invalid section")

    from modules.employees.service import after_employee_updated, get_employee_row

    old_row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not old_row:
        raise LookupError("employee not found")

    if section == "compliance_reporting":
        if not old_row.get("is_sponsored"):
            raise ValueError("compliance reporting only applies to sponsored workers")
        filtered = {k: v for k, v in updates.items() if k in COMPLIANCE_REPORTING_FIELDS}
        if not filtered:
            raise ValueError("no fields to update")
        update_sponsorship_fields(
            tenant_id=tenant_id,
            employee_id=employee_id,
            updates=filtered,
            conn=conn,
        )
    else:
        allowed = section_field_names(section)
        filtered = {k: v for k, v in updates.items() if k in allowed}
        if section == "recruitment" and "worker_type" in filtered:
            filtered["is_sponsored"] = filtered.pop("worker_type") == "sponsored"
        if not filtered:
            raise ValueError("no fields to update")
        filtered = validate_information_fields(section, filtered)
        if section == "recruitment" and any(key in filtered for key in ("first_name", "last_name", "email")):
            from modules.employees.duplicates import assert_no_duplicate_employee

            assert_no_duplicate_employee(
                tenant_id=tenant_id,
                conn=conn,
                first_name=str(filtered.get("first_name", old_row["first_name"])),
                last_name=str(filtered.get("last_name", old_row["last_name"])),
                email=filtered.get("email", old_row.get("email")),
                exclude_employee_id=employee_id,
            )
        update_employee_fields(
            tenant_id=tenant_id,
            employee_id=employee_id,
            updates=filtered,
            conn=conn,
        )

    new_row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if new_row:
        after_employee_updated(
            tenant_id=tenant_id,
            employee_id=employee_id,
            old_row=old_row,
            new_row=new_row,
            actor_username=actor_username,
            actor_role=actor_role,
            conn=conn,
        )

    return build_workspace(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
