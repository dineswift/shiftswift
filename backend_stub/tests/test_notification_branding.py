"""Employee notification display name — alias vs legal employer."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from core.email_templates import employee_portal_invite_email, rota_published_email
from modules.employees.notification_branding import (
    EMPLOYEE_NOTIFICATION_DEFAULT,
    employee_notification_from_name,
    merge_notification_preferences_json,
)


def test_employee_notification_from_name_uses_custom_alias() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = ({"employee_display_name": "Restaurant HR"},)

    assert employee_notification_from_name(tenant_id=1, conn=conn) == "Restaurant HR"


def test_employee_notification_from_name_falls_back_when_blank() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = ({"employee_display_name": "   "},)

    assert employee_notification_from_name(tenant_id=1, conn=conn) == EMPLOYEE_NOTIFICATION_DEFAULT


def test_merge_notification_preferences_preserves_delivery_and_alias() -> None:
    stored = {"rota_published": "off", "employee_display_name": "HR Team"}
    merged = merge_notification_preferences_json(
        stored=stored,
        preferences={"missed_punch_hr": "email_sms"},
    )
    assert merged["rota_published"] == "off"
    assert merged["missed_punch_hr"] == "email_sms"
    assert merged["employee_display_name"] == "HR Team"


def test_merge_notification_preferences_clears_alias_with_empty_string() -> None:
    stored = {"rota_published": "email", "employee_display_name": "Old Name"}
    merged = merge_notification_preferences_json(
        stored=stored,
        employee_display_name="",
    )
    assert "employee_display_name" not in merged


def test_portal_invite_uses_alias_in_intro_and_legal_name_in_gdpr() -> None:
    content = employee_portal_invite_email(
        employee_name="Alex",
        notification_from_name="HR Team",
        employer_legal_name="Himalayan Inn Ltd",
        setup_url="https://app.shiftswifthr.co.uk/reset-password.html?token=abc",
        login_url="https://app.shiftswifthr.co.uk/business-login.html",
        reset_hours=24,
    )
    assert "HR Team has invited you" in content.text
    assert "Himalayan Inn Ltd is your employer" in content.text
    assert "Himalayan Inn Ltd has invited you" not in content.text


def test_rota_published_email_uses_resolved_display_name() -> None:
    content = rota_published_email(
        employee_name="Alex",
        tenant_name="HR Team",
        week_label="10 – 16 Jun 2026",
        shift_lines=["Mon 10 Jun: 09:00–17:00 (Chef)"],
    )
    assert "HR Team has published your shifts" in content.text
