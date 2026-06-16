"""Address geocoding for punch sites (OpenStreetMap Nominatim + UK postcode fallback)."""

from __future__ import annotations

import os
import re

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
POSTCODES_IO_URL = "https://api.postcodes.io/postcodes"
USER_AGENT = os.getenv("GEOCODE_USER_AGENT", "ShiftSwiftHR/1.0 (time-punch; contact=support@shiftswifthr.co.uk)")

UK_POSTCODE_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b", re.IGNORECASE)
MIN_GEOCODE_ADDRESS_LEN = 10


def normalize_geocode_address(address: str) -> str:
    """Collapse whitespace/newlines and strip common copy-paste artefacts."""
    query = (address or "").strip()
    if not query:
        return ""
    query = (
        query.replace("\u00a0", " ")
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )
    query = re.sub(r"[\r\n]+", ", ", query)
    query = re.sub(r"\s*,\s*", ", ", query)
    query = re.sub(r"\s{2,}", " ", query)
    query = re.sub(r"(,\s*)+", ", ", query)
    return query.strip(" ,")


def extract_uk_postcode(address: str) -> str | None:
    match = UK_POSTCODE_RE.search(normalize_geocode_address(address).upper())
    if not match:
        return None
    return match.group(1).upper()


def validate_geocode_address(address: str) -> tuple[bool, str | None]:
    """Return (ok, error_message). Requires a full UK address with a valid postcode."""
    query = normalize_geocode_address(address)
    if len(query) < MIN_GEOCODE_ADDRESS_LEN:
        return False, "Enter the full street address including town or city — not just a postcode."
    if not extract_uk_postcode(query):
        return False, "Include a valid UK postcode (e.g. M3 3AP or NG5 7EG)."
    return True, None


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
    query = normalize_geocode_address(address)
    valid, _ = validate_geocode_address(query)
    if not valid:
        return None
    postcode = extract_uk_postcode(query)
    if postcode:
        coords = _geocode_uk_postcode(postcode)
        if coords:
            return coords
        coords = _geocode_nominatim(f"{postcode}, United Kingdom")
        if coords:
            return coords
    coords = _geocode_nominatim(query)
    if coords:
        return coords
    if postcode:
        coords = _geocode_nominatim(f"{postcode}, Nottinghamshire, United Kingdom")
        if coords:
            return coords
    return None
