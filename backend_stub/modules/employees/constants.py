"""Employee lifecycle workspace — sections aligned to HR lifecycle chart."""

from __future__ import annotations

EMPLOYMENT_TYPES = [
    {"value": "full_time", "label": "Full time"},
    {"value": "part_time", "label": "Part time"},
    {"value": "zero_hours", "label": "Zero hours"},
    {"value": "fixed_term", "label": "Fixed term"},
    {"value": "casual", "label": "Casual"},
]

WORKER_TYPES = [
    {"value": "standard", "label": "Standard employee"},
    {"value": "sponsored", "label": "Sponsored worker (Sponsor Licence)"},
]

EMPLOYEE_DOCUMENT_CATEGORIES = [
    {"value": "contract", "label": "Employment contract"},
    {"value": "payslip", "label": "Payslip"},
    {"value": "id", "label": "ID / passport"},
    {"value": "rtw", "label": "Right to work"},
    {"value": "qualification", "label": "Qualification"},
    {"value": "policy", "label": "Signed policy / handbook"},
    {"value": "disciplinary", "label": "Disciplinary"},
    {"value": "general", "label": "General"},
    {"value": "other", "label": "Other"},
]

RTW_STATUSES = [
    {"value": "pending", "label": "Pending check"},
    {"value": "verified", "label": "Verified"},
    {"value": "time_limited", "label": "Time limited"},
    {"value": "failed", "label": "Failed"},
]

# Employee lifecycle flow (matches ShiftSwift HR workflow chart)
SECTION_ORDER = (
    "recruitment",
    "onboarding",
    "induction",
    "document_store",
    "development",
    "job_performance",
    "support",
    "performance_improvement",
    "compliance_reporting",
    "offboarding",
)

SECTION_STEPS = {
    "recruitment": 1,
    "onboarding": 2,
    "induction": 3,
    "document_store": 4,
    "development": 5,
    "job_performance": 6,
    "support": 7,
    "performance_improvement": 8,
    "compliance_reporting": 9,
    "offboarding": 10,
}

SECTION_LABELS = {
    "recruitment": "Recruitment",
    "onboarding": "On-boarding",
    "induction": "Personal information",
    "document_store": "Document store",
    "development": "Development",
    "job_performance": "Job performance",
    "support": "Notes",
    "performance_improvement": "Performance improvement",
    "compliance_reporting": "Compliance reporting",
    "offboarding": "Off-boarding",
}

SECTION_DESCRIPTIONS = {
    "recruitment": "Basic identity and employee type (standard or sponsored).",
    "onboarding": "Role, start date, employment type, contracted weekly hours (for rota warnings), and work location.",
    "induction": "Contact details, NI number, address, and emergency contact.",
    "document_store": "Contracts, ID, policies, and required HR evidence.",
    "development": "Training certificates — upload in Document store using Qualification category and expiry date.",
    "job_performance": "Salary for payroll CSV export. Appraisals via HR Templates (probation / annual review).",
    "support": "Notes and messages for this employee.",
    "performance_improvement": "Probation reviews, PIPs, and CPD — HR Templates; file signed copies in Document store.",
    "compliance_reporting": "Visa, CoS, and right-to-work reporting for sponsored workers.",
    "offboarding": "Leave date and exit admin when employment ends.",
}

SECTION_BRANCHES = {
    "job_performance": "Salary management",
    "support": "Health & wellbeing",
    "performance_improvement": "Training & CPD",
}

# form = editable fields, link = guidance panel, documents = document store UI
SECTION_KINDS = {
    "recruitment": "form",
    "onboarding": "form",
    "induction": "form",
    "document_store": "documents",
    "development": "link",
    "job_performance": "form",
    "support": "notes",
    "performance_improvement": "link",
    "compliance_reporting": "form",
    "offboarding": "form",
}

LINK_ONLY_SECTIONS = frozenset({"development", "support", "performance_improvement"})
DOCUMENT_SECTIONS = frozenset({"document_store"})

SECTION_FIELDS: dict[str, tuple[str, ...]] = {
    "recruitment": ("first_name", "last_name", "email", "worker_type"),
    "onboarding": (
        "start_date",
        "status",
        "job_title",
        "department",
        "employment_type",
        "contract_hours_weekly",
        "work_location",
        "probation_end_date",
    ),
    "induction": (
        "phone",
        "date_of_birth",
        "home_address",
        "ni_number",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relationship",
    ),
    "job_performance": ("salary",),
    "offboarding": ("termination_date", "termination_reason"),
}

COMPLIANCE_REPORTING_FIELDS = (
    "visa_type",
    "visa_expiry_date",
    "share_code",
    "cos_reference",
    "rtw_status",
)
