"""Document store constants — categories, lifecycle stages, requirements."""

from __future__ import annotations

DOCUMENT_LIFECYCLE_STAGES = [
    {"value": "recruitment", "label": "Recruitment"},
    {"value": "onboarding", "label": "On-boarding"},
    {"value": "active", "label": "Active"},
    {"value": "offboarding", "label": "Off-boarding"},
    {"value": "induction", "label": "Personal information"},
    {"value": "document_store", "label": "Document store"},
    {"value": "compliance", "label": "Compliance"},
    {"value": "general", "label": "General"},
    {"value": "policy", "label": "Policy (tenant-wide)"},
]

DOCUMENT_FORM_LIFECYCLE_STAGES = [
    {"value": "recruitment", "label": "Recruitment"},
    {"value": "onboarding", "label": "On-boarding"},
    {"value": "active", "label": "Active"},
    {"value": "offboarding", "label": "Off-boarding"},
]

EXPIRY_ALERT_DAY_OPTIONS = [
    {"value": 30, "label": "30 days before"},
    {"value": 60, "label": "60 days before"},
    {"value": 90, "label": "90 days before"},
]

VALID_EXPIRY_ALERT_DAYS = frozenset({30, 60, 90})

TENANT_DOCUMENT_CATEGORIES = [
    {"value": "general", "label": "General"},
    {"value": "contract", "label": "Contract"},
    {"value": "rtw", "label": "RTW document"},
    {"value": "visa_brp", "label": "Visa / BRP"},
    {"value": "dbs", "label": "DBS check"},
    {"value": "training", "label": "Training certificate"},
    {"value": "disciplinary", "label": "Disciplinary"},
    {"value": "payslip", "label": "Payslip"},
    {"value": "policy", "label": "Policy & handbook"},
    {"value": "payroll", "label": "Payroll"},
    {"value": "other", "label": "Other"},
]

EMPLOYEE_DOCUMENT_CATEGORIES = [
    {"value": "contract", "label": "Contract"},
    {"value": "payslip", "label": "Payslip"},
    {"value": "id", "label": "ID / passport"},
    {"value": "rtw", "label": "RTW document"},
    {"value": "visa_brp", "label": "Visa / BRP"},
    {"value": "dbs", "label": "DBS check"},
    {"value": "qualification", "label": "Training certificate"},
    {"value": "training", "label": "Training certificate"},
    {"value": "policy", "label": "Signed policy / handbook"},
    {"value": "disciplinary", "label": "Disciplinary"},
    {"value": "general", "label": "General"},
    {"value": "other", "label": "Other"},
]

# Categories visible in the employee self-service portal when employee_visible is not explicitly set.
EMPLOYEE_SELF_SERVICE_CATEGORIES = frozenset(
    {"contract", "policy", "general", "qualification", "training", "payslip", "other"}
)

EMPLOYEE_DOCUMENT_CATEGORY_LABELS = {item["value"]: item["label"] for item in EMPLOYEE_DOCUMENT_CATEGORIES}

EMPLOYEE_DOCUMENT_REQUIREMENTS = {
    "standard": (
        {"category": "contract", "label": "Signed employment contract", "required": True},
        {"category": "id", "label": "Photo ID or passport copy", "required": True},
        {"category": "policy", "label": "Handbook / H&S acknowledgement", "required": False},
    ),
    "sponsored": (
        {"category": "contract", "label": "Signed employment contract", "required": True},
        {"category": "id", "label": "Photo ID or passport copy", "required": True},
        {"category": "rtw", "label": "Right to work evidence", "required": True},
        {"category": "policy", "label": "Handbook / H&S acknowledgement", "required": False},
    ),
}

VALID_EMPLOYEE_CATEGORIES = frozenset(item["value"] for item in EMPLOYEE_DOCUMENT_CATEGORIES)
VALID_TENANT_CATEGORIES = frozenset(item["value"] for item in TENANT_DOCUMENT_CATEGORIES)
VALID_LIFECYCLE_STAGES = frozenset(item["value"] for item in DOCUMENT_LIFECYCLE_STAGES)
