"""Platform global document catalog — Word, Excel-compatible CSV, and PDF forms."""

from __future__ import annotations

from typing import Any, Literal

FileFormat = Literal["docx", "csv", "xlsx"]

GLOBAL_DOCUMENT_CATEGORIES: dict[str, str] = {
    "rota": "Rota & scheduling",
    "timesheets": "Timesheets",
    "forms": "HR forms",
    "onboarding": "Onboarding",
    "leave": "Leave & absence",
    "offboarding": "Offboarding",
}


def _csv_weekly_rota() -> str:
    return (
        "Employee,Role,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Contracted hours,Notes\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
        ",,,,,,,,,\n"
    )


def _csv_monthly_timesheet() -> str:
    return (
        "Employee,Date,Day,Scheduled start,Scheduled end,Actual start,Actual end,"
        "Break (mins),Total hours,Role,Site,Notes\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
        ",,,,,,,,,,\n"
    )


def _csv_payroll_hours_summary() -> str:
    return (
        "Employee,Role,Ordinary hours,Overtime hours,Holiday hours,Sick hours,Total payable hours,Notes\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
        ",,,,,,,\n"
    )


_STAFF_DETAILS_MD = """# Staff details form

**Instructions:** Complete one form per employee. Store the signed copy in your document store or employee record.

## Personal details

| Field | Details |
| --- | --- |
| Full legal name | |
| Preferred name | |
| Date of birth | |
| National Insurance number | |
| Home address | |
| Personal email | |
| Mobile number | |
| Emergency contact name | |
| Emergency contact phone | |

## Employment details

| Field | Details |
| --- | --- |
| Job title | |
| Department / site | |
| Start date | |
| Employment type | Full-time / Part-time / Casual |
| Contracted hours per week | |
| Pay frequency | |
| Line manager | |

## Bank details (payroll)

| Field | Details |
| --- | --- |
| Account name | |
| Sort code | |
| Account number | |
| Building society roll number (if applicable) | |

## Right to work (HR use)

| Field | Details |
| --- | --- |
| Document type | |
| Document reference | |
| Expiry date (if applicable) | |
| Checked by | |
| Date checked | |

**Employee declaration:** I confirm the information above is accurate.

**Employee signature:** _________________________ **Date:** ___________

**HR received by:** _________________________ **Date:** ___________
"""

_ABSENCE_RECORD_MD = """# Absence record form

Use when an employee reports sickness or other absence. Keep records for at least 3 years.

## Employee

| Field | Details |
| --- | --- |
| Employee name | |
| Job title / site | |
| Line manager | |

## Absence

| Field | Details |
| --- | --- |
| First day absent | |
| Expected return date | |
| Reason (brief) | |
| Fit note received? | Yes / No / Not yet required |
| Fit note covers until | |

## Contact log

| Date | Contact method | Summary |
| --- | --- | --- |
| | | |
| | | |
| | | |

## Return to work

| Field | Details |
| --- | --- |
| Actual return date | |
| Return-to-work meeting held | Yes / No |
| Meeting date | |
| Further action | |

**Manager signature:** _________________________ **Date:** ___________
"""

_HOLIDAY_REQUEST_MD = """# Holiday / leave request form

| Field | Details |
| --- | --- |
| Employee name | |
| Job title / site | |
| Line manager | |
| Leave type | Annual leave / Unpaid / Other |
| First day of leave | |
| Last day of leave | |
| Total days requested | |
| Remaining entitlement (HR) | |

**Reason / notes (optional):**

_______________________________________________________________________________

**Employee signature:** _________________________ **Date:** ___________

## Manager decision

- [ ] Approved
- [ ] Approved with conditions
- [ ] Declined — reason: _______________________________________________

**Manager signature:** _________________________ **Date:** ___________
"""

_NEW_STARTER_CHECKLIST_MD = """# New starter checklist

**Employee name:** _________________________ **Start date:** ___________

## Before day one

- [ ] Contract / offer letter issued and signed
- [ ] Right to Work check completed and evidence filed
- [ ] DBS check (if required for role)
- [ ] Payroll details collected
- [ ] Uniform / equipment ordered
- [ ] Rota published for first two weeks
- [ ] Portal invite sent (if using employee app)

## Day one

- [ ] Welcome and site tour
- [ ] Health & safety briefing
- [ ] Fire exits and first aiders explained
- [ ] Role-specific training started
- [ ] Time clock / punch app set up

## First month

- [ ] Probation objectives agreed
- [ ] One-to-one check-in (week 1)
- [ ] One-to-one check-in (week 4)
- [ ] Mandatory policies acknowledged

**Completed by:** _________________________ **Date:** ___________
"""

_EXIT_CHECKLIST_MD = """# Leaver / exit checklist

**Employee name:** _________________________ **Last working day:** ___________

## HR & payroll

- [ ] Resignation / termination letter on file
- [ ] Final pay and holiday balance calculated
- [ ] P45 / payroll notified
- [ ] Benefits ended

## IT & access

- [ ] Portal / email access revoked
- [ ] Keys, fob, or uniform returned
- [ ] Company phone / laptop returned

## Compliance (sponsored workers)

- [ ] Sponsor reporting obligations reviewed
- [ ] Cessation reported to Home Office (if applicable)

## Handover

- [ ] Knowledge handover completed
- [ ] Exit interview completed (optional)

**Completed by:** _________________________ **Date:** ___________
"""


GLOBAL_DOCUMENTS: list[dict[str, Any]] = [
    {
        "id": "weekly_rota_planner",
        "title": "Weekly rota planner",
        "description": "Excel-compatible spreadsheet to plan shifts by employee and day. Import or copy into your payroll workflow.",
        "category": "rota",
        "file_format": "csv",
        "filename": "ShiftSwift_weekly_rota_planner.csv",
        "sort_order": 10,
        "csv_content": _csv_weekly_rota(),
    },
    {
        "id": "monthly_timesheet",
        "title": "Monthly timesheet",
        "description": "Row-per-shift timesheet with scheduled vs actual hours, breaks, and site — opens in Excel or Google Sheets.",
        "category": "timesheets",
        "file_format": "csv",
        "filename": "ShiftSwift_monthly_timesheet.csv",
        "sort_order": 20,
        "csv_content": _csv_monthly_timesheet(),
    },
    {
        "id": "payroll_hours_summary",
        "title": "Payroll hours summary",
        "description": "One row per employee summarising ordinary, overtime, holiday, and sick hours for your accountant.",
        "category": "timesheets",
        "file_format": "csv",
        "filename": "ShiftSwift_payroll_hours_summary.csv",
        "sort_order": 30,
        "csv_content": _csv_payroll_hours_summary(),
    },
    {
        "id": "staff_details_form",
        "title": "Staff details form",
        "description": "Collect personal, employment, bank, and right-to-work details for new starters.",
        "category": "forms",
        "file_format": "docx",
        "filename": "ShiftSwift_staff_details_form.docx",
        "sort_order": 40,
        "markdown": _STAFF_DETAILS_MD,
    },
    {
        "id": "absence_record_form",
        "title": "Absence record form",
        "description": "Log sickness absence, fit notes, contact during leave, and return-to-work meetings.",
        "category": "leave",
        "file_format": "docx",
        "filename": "ShiftSwift_absence_record_form.docx",
        "sort_order": 50,
        "markdown": _ABSENCE_RECORD_MD,
    },
    {
        "id": "holiday_request_form",
        "title": "Holiday request form",
        "description": "Employee leave request with manager approval section.",
        "category": "leave",
        "file_format": "docx",
        "filename": "ShiftSwift_holiday_request_form.docx",
        "sort_order": 60,
        "markdown": _HOLIDAY_REQUEST_MD,
    },
    {
        "id": "new_starter_checklist",
        "title": "New starter checklist",
        "description": "Before day one, day one, and first-month tasks for onboarding.",
        "category": "onboarding",
        "file_format": "docx",
        "filename": "ShiftSwift_new_starter_checklist.docx",
        "sort_order": 70,
        "markdown": _NEW_STARTER_CHECKLIST_MD,
    },
    {
        "id": "exit_checklist",
        "title": "Leaver exit checklist",
        "description": "HR, payroll, access, and sponsor-compliance steps when someone leaves.",
        "category": "offboarding",
        "file_format": "docx",
        "filename": "ShiftSwift_exit_checklist.docx",
        "sort_order": 80,
        "markdown": _EXIT_CHECKLIST_MD,
    },
]
