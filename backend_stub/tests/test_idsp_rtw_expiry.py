"""IDSP / share-code responses expose visa expiry and RTW check expiry separately."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.compliance.idsp_rtw import parse_idsp_expiry_dates


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


if __name__ == "__main__":
    test_parse_idsp_expiry_dates_from_latest_payload()
    test_parse_idsp_expiry_dates_falls_back_to_generic_expiry()
    print("ok")
