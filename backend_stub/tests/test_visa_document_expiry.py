"""Visa / BRP and right-to-work check documents use the same expiry flow as ID and passports."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.compliance.expiry_notify_jobs import ID_CATEGORIES
from modules.documents.constants import (
    EMPLOYEE_DOCUMENT_REQUIREMENTS,
    RTW_CHECK_CATEGORIES,
    VISA_CATEGORIES,
    VISA_RTW_CATEGORIES,
)
from modules.documents.service import requirements_status
from modules.employees.constants import EMPLOYEE_DOCUMENT_CATEGORIES


def test_employee_categories_include_visa_and_rtw_check() -> None:
    values = {item["value"] for item in EMPLOYEE_DOCUMENT_CATEGORIES}
    labels = {item["value"]: item["label"] for item in EMPLOYEE_DOCUMENT_CATEGORIES}
    assert "id" in values
    assert "visa_brp" in values
    assert "rtw" in values
    assert labels["visa_brp"] == "Visa / BRP"
    assert labels["rtw"] == "Right to work check"


def test_sponsored_workers_require_visa_and_rtw_check() -> None:
    required = [item["category"] for item in EMPLOYEE_DOCUMENT_REQUIREMENTS["sponsored"] if item["required"]]
    assert "id" in required
    assert "visa_brp" in required
    assert "rtw" in required


def test_rtw_check_does_not_satisfy_visa_requirement() -> None:
    status = requirements_status(
        is_sponsored=True,
        documents=[{"category": "contract"}, {"category": "id"}, {"category": "rtw"}],
    )
    visa = next(item for item in status["items"] if item["category"] == "visa_brp")
    rtw = next(item for item in status["items"] if item["category"] == "rtw")
    assert visa["satisfied"] is False
    assert rtw["satisfied"] is True
    assert status["complete"] is False


def test_visa_document_does_not_satisfy_rtw_check_requirement() -> None:
    status = requirements_status(
        is_sponsored=True,
        documents=[{"category": "contract"}, {"category": "id"}, {"category": "visa_brp"}],
    )
    rtw = next(item for item in status["items"] if item["category"] == "rtw")
    assert rtw["satisfied"] is False
    assert status["complete"] is False


def test_sponsored_complete_when_visa_and_rtw_check_present() -> None:
    status = requirements_status(
        is_sponsored=True,
        documents=[
            {"category": "contract"},
            {"category": "id"},
            {"category": "visa_brp"},
            {"category": "rtw"},
        ],
    )
    assert status["complete"] is True


def test_visa_and_rtw_check_are_in_expiry_alert_categories() -> None:
    assert "visa_brp" in ID_CATEGORIES
    assert "rtw" in ID_CATEGORIES
    assert "visa_brp" in VISA_CATEGORIES
    assert "rtw" in RTW_CHECK_CATEGORIES
    assert "rtw" in VISA_RTW_CATEGORIES
    assert "visa_brp" not in RTW_CHECK_CATEGORIES
    assert "rtw" not in VISA_CATEGORIES


def test_id_and_passport_still_required_for_standard_employees() -> None:
    status = requirements_status(
        is_sponsored=False,
        documents=[{"category": "contract"}, {"category": "id"}],
    )
    assert status["complete"] is True
    assert not any(item["category"] == "visa_brp" for item in status["items"] if item["required"])
    assert not any(item["category"] == "rtw" for item in status["items"] if item["required"])
