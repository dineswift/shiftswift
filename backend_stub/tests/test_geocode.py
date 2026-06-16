"""Geocoding helpers for punch sites."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.time_punch.geocode import (
    extract_uk_postcode,
    format_osm_address_line,
    geocode_address,
    normalize_geocode_address,
    resolve_address_coords,
    validate_geocode_address,
    validate_uk_coords,
)


def test_extract_uk_postcode() -> None:
    assert extract_uk_postcode("1 Spinningfields, Manchester M3 3AP") == "M3 3AP"
    assert extract_uk_postcode("London SW1A 1AA") == "SW1A 1AA"
    assert extract_uk_postcode("No postcode here") is None


def test_validate_geocode_address() -> None:
    ok, err = validate_geocode_address("M3 3AP")
    assert ok is False
    assert err

    ok, err = validate_geocode_address("1 Spinningfields, Manchester M3 3AP")
    assert ok is True
    assert err is None

    ok, err = validate_geocode_address("156 Front Street, Arnold, Nottingham, NG5 7EG")
    assert ok is True
    assert err is None

    ok, err = validate_geocode_address("156 Front street, Nottingham, NG5 7EG")
    assert ok is True
    assert err is None

    ok, err = validate_geocode_address("156 Front street\nNottingham\nNG5 7EG")
    assert ok is True
    assert err is None

    assert (
        normalize_geocode_address("156 Front street\nNottingham, NG5 7EG")
        == "156 Front street, Nottingham, NG5 7EG"
    )

    ok, err = validate_geocode_address("No postcode street, Nottingham")
    assert ok is False
    assert "postcode" in (err or "").lower()

    ok, err = validate_geocode_address("Front Street, Arnold", latitude=53.005292, longitude=-1.126752)
    assert ok is True
    assert err is None


def test_format_osm_address_line() -> None:
    line = format_osm_address_line(
        {
            "house_number": "156",
            "road": "Front Street",
            "town": "Arnold",
            "postcode": "NG5 7EG",
        },
        "fallback",
    )
    assert line == "156, Front Street, Arnold, NG5 7EG"


def test_validate_uk_coords() -> None:
    assert validate_uk_coords(53.005292, -1.126752) is True
    assert validate_uk_coords(40.0, -1.0) is False


def test_resolve_address_coords_prefers_stored() -> None:
    coords = resolve_address_coords(
        "156 Front street, Nottingham, NG5 7EG",
        latitude=53.005292,
        longitude=-1.126752,
    )
    assert coords == (53.005292, -1.126752)


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
