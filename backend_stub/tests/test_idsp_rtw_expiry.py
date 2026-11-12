"""IDSP / share-code responses expose visa expiry and RTW check expiry separately."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.compliance.idsp_rtw import parse_idsp_expiry_dates, resolve_share_code_date_of_birth


def test_parse_idsp_expiry_dates_from_latest_payload() -> None:
    dates = parse_idsp_expiry_dates(
        {
            "outcome": "pass",
            "rightToWorkCheck": {
                "visaExpiryDate": "2027-04-01",
                "checkExpiryDate": "2026-10-15",
            },
        }
    )
    assert dates["visa_expiry_date"] == date(2027, 4, 1)
    assert dates["rtw_check_expiry_date"] == date(2026, 10, 15)


def test_parse_idsp_expiry_dates_falls_back_to_generic_expiry() -> None:
    dates = parse_idsp_expiry_dates({"expiry_date": "2026-12-01"})
    assert dates["visa_expiry_date"] is None
    assert dates["rtw_check_expiry_date"] == date(2026, 12, 1)


def test_resolve_share_code_date_of_birth_prefers_stored() -> None:
    assert resolve_share_code_date_of_birth(
        provided=date(1990, 1, 1),
        stored="1995-06-15",
    ) == date(1995, 6, 15)


def test_resolve_share_code_date_of_birth_uses_payload_when_missing() -> None:
    assert resolve_share_code_date_of_birth(
        provided=date(1990, 1, 1),
        stored=None,
    ) == date(1990, 1, 1)


def test_resolve_share_code_date_of_birth_requires_a_value() -> None:
    try:
        resolve_share_code_date_of_birth(provided=None, stored=None)
    except ValueError as exc:
        assert "Date of birth is not on this employee record" in str(exc)
    else:
        raise AssertionError("expected ValueError")


if __name__ == "__main__":
    test_parse_idsp_expiry_dates_from_latest_payload()
    test_parse_idsp_expiry_dates_falls_back_to_generic_expiry()
    test_resolve_share_code_date_of_birth_prefers_stored()
    test_resolve_share_code_date_of_birth_uses_payload_when_missing()
    test_resolve_share_code_date_of_birth_requires_a_value()
    print("ok")
