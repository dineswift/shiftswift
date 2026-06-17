from __future__ import annotations

from unittest.mock import MagicMock, patch

from employee_portal_consent import employee_display_name, username_display_fallback


def test_username_display_fallback_strips_trailing_digits() -> None:
    assert username_display_fallback("bhandarishankar815@gmail.com") == "Bhandarishankar"


def test_employee_display_name_uses_hr_record() -> None:
    conn = MagicMock()
    with patch(
        "modules.time_punch.service.resolve_employee",
        return_value={
            "id": 1,
            "first_name": "Bhandarishankar",
            "last_name": "Bhusal",
            "email": "bhandarishankar815@gmail.com",
            "status": "active",
        },
    ):
        display_name, first_name = employee_display_name(
            tenant_id=1,
            username="bhandarishankar815@gmail.com",
            conn=conn,
        )
    assert display_name == "Bhandarishankar Bhusal"
    assert first_name == "Bhandarishankar"


def test_employee_display_name_falls_back_to_username() -> None:
    conn = MagicMock()
    with patch("modules.time_punch.service.resolve_employee", return_value=None):
        display_name, first_name = employee_display_name(
            tenant_id=1,
            username="bhandarishankar815@gmail.com",
            conn=conn,
        )
    assert display_name == "Bhandarishankar"
    assert first_name == "Bhandarishankar"
