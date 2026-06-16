"""Address geocoding for punch sites (OpenStreetMap Nominatim + UK postcode fallback)."""

from __future__ import annotations

import os
import re

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
POSTCODES_IO_URL = "https://api.postcodes.io/postcodes"
USER_AGENT = os.getenv("GEOCODE_USER_AGENT", "ShiftSwiftHR/1.0 (time-punch; contact=support@shiftswifthr.co.uk)")

UK_POSTCODE_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b", re.IGNORECASE)


def extract_uk_postcode(address: str) -> str | None:
    match = UK_POSTCODE_RE.search((address or "").upper())
    if not match:
        return None
    return match.group(1).upper()


def _geocode_nominatim(query: str) -> tuple[float, float] | None:
    try:
        with httpx.Client(timeout=12.0) as client:
            response = client.get(
                NOMINATIM_URL,
                params={"q": query, "format": "json", "limit": 1, "countrycodes": "gb"},
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if not rows:
        return None
    try:
        return float(rows[0]["lat"]), float(rows[0]["lon"])
    except (KeyError, TypeError, ValueError):
        return None


def _geocode_uk_postcode(postcode: str) -> tuple[float, float] | None:
    clean = postcode.replace(" ", "").upper()
    if len(clean) < 5:
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(f"{POSTCODES_IO_URL}/{clean}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    result = payload.get("result") if isinstance(payload, dict) else None
    if not result:
        return None
    try:
        lat = result.get("latitude")
        lng = result.get("longitude")
        if lat is None or lng is None:
            return None
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def geocode_address(address: str) -> tuple[float, float] | None:
    query = (address or "").strip()
    if len(query) < 5:
        return None
    postcode = extract_uk_postcode(query)
    if postcode:
        coords = _geocode_uk_postcode(postcode)
        if coords:
            return coords
    coords = _geocode_nominatim(query)
    if coords:
        return coords
    return None
