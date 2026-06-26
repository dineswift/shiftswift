from __future__ import annotations

from unittest.mock import MagicMock, patch

from employee_portal_consent import hr_display_name


def test_hr_display_name_uses_signatory_for_billing_email() -> None:
    conn = MagicMock()
    with patch("modules.time_punch.service.resolve_employee", return_value=None), patch(
        "admin_service.get_tenant_profile",
        return_value={
            "signatory_name": "Alex Smith",
            "signatory_email": "ceo@acme.co.uk",
            "billing_email": "info@himalayaninn.co.uk",
        },
    ):
        display_name, first_name = hr_display_name(
            tenant_id=1,
            username="info@himalayaninn.co.uk",
            conn=conn,
        )
    assert display_name == "Alex Smith"
    assert first_name == "Alex"


def test_hr_display_name_uses_employee_record_when_present() -> None:
    conn = MagicMock()
    with patch(
        "modules.time_punch.service.resolve_employee",
        return_value={"first_name": "Priya", "last_name": "Sharma"},
    ):
        display_name, first_name = hr_display_name(
            tenant_id=1,
            username="priya@acme.co.uk",
            conn=conn,
        )
    assert display_name == "Priya Sharma"
    assert first_name == "Priya"


def test_hr_display_name_falls_back_to_username() -> None:
    conn = MagicMock()
    with patch("modules.time_punch.service.resolve_employee", return_value=None), patch(
        "admin_service.get_tenant_profile",
        return_value={
            "signatory_name": "Alex Smith",
            "signatory_email": "ceo@acme.co.uk",
            "billing_email": "info@himalayaninn.co.uk",
        },
    ):
        display_name, first_name = hr_display_name(
            tenant_id=1,
            username="other@acme.co.uk",
            conn=conn,
        )
    assert display_name == "Other"
    assert first_name == "Other"
