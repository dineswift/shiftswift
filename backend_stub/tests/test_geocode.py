"""Geocoding helpers for punch sites."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.geocode import extract_uk_postcode, geocode_address


def test_extract_uk_postcode() -> None:
    assert extract_uk_postcode("1 Spinningfields, Manchester M3 3AP") == "M3 3AP"
    assert extract_uk_postcode("London SW1A 1AA") == "SW1A 1AA"
    assert extract_uk_postcode("No postcode here") is None


@pytest.mark.skipif(True, reason="Requires network access to postcodes.io")
def test_geocode_address_accepts_uk_postcode_only() -> None:
    coords = geocode_address("M3 3AP, Manchester")
    assert coords is not None
    lat, lng = coords
    assert 53.0 < lat < 54.0
    assert -3.0 < lng < -2.0


def test_geocode_address_prefers_postcode_before_nominatim(monkeypatch) -> None:
    calls: list[str] = []

    def fake_postcode(postcode: str):
        calls.append(f"postcode:{postcode}")
        return 53.005292, -1.126752

    def fake_nominatim(query: str):
        calls.append(f"nominatim:{query}")
        return None

    monkeypatch.setattr("modules.time_punch.geocode._geocode_uk_postcode", fake_postcode)
    monkeypatch.setattr("modules.time_punch.geocode._geocode_nominatim", fake_nominatim)

    coords = geocode_address("156 Front street, Arnold, Nottingham, NG5 7EG")
    assert coords == (53.005292, -1.126752)
    assert calls[0].startswith("postcode:")
    assert all(not call.startswith("nominatim:") for call in calls)
