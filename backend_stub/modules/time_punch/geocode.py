"""Address geocoding for punch sites (OpenStreetMap Nominatim + UK postcode fallback)."""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
POSTCODES_IO_URL = "https://api.postcodes.io/postcodes"
USER_AGENT = os.getenv("GEOCODE_USER_AGENT", "ShiftSwiftHR/1.0 (time-punch; contact=support@shiftswifthr.co.uk)")

UK_POSTCODE_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b", re.IGNORECASE)
MIN_GEOCODE_ADDRESS_LEN = 10
UK_LAT_MIN = 49.0
UK_LAT_MAX = 61.5
UK_LNG_MIN = -9.0
UK_LNG_MAX = 2.5


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


def validate_uk_coords(latitude: float, longitude: float) -> bool:
    try:
        lat = float(latitude)
        lng = float(longitude)
    except (TypeError, ValueError):
        return False
    return UK_LAT_MIN <= lat <= UK_LAT_MAX and UK_LNG_MIN <= lng <= UK_LNG_MAX


def format_osm_address_line(address: dict[str, Any], fallback: str = "") -> str:
    """Build a single-line UK address from Nominatim addressdetails."""
    if not isinstance(address, dict):
        return normalize_geocode_address(fallback)
    parts: list[str] = []
    seen: set[str] = set()
    for key in ("house_number", "road", "suburb", "town", "city", "county", "postcode"):
        raw = address.get(key)
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        parts.append(text)
    if parts:
        return ", ".join(parts)
    return normalize_geocode_address(fallback)


def search_nominatim_addresses(query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Search UK addresses via OpenStreetMap Nominatim (proxied server-side)."""
    clean = normalize_geocode_address(query)
    if len(clean) < 3:
        return []
    capped = max(1, min(int(limit), 8))
    try:
        with httpx.Client(timeout=12.0) as client:
            response = client.get(
                NOMINATIM_URL,
                params={
                    "q": clean,
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "limit": capped,
                    "countrycodes": "gb",
                },
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError):
        return []
    if not isinstance(rows, list):
        return []
    items: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            lat = float(row["lat"])
            lng = float(row["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if not validate_uk_coords(lat, lng):
            continue
        address = row.get("address") if isinstance(row.get("address"), dict) else {}
        display_name = str(row.get("display_name") or "").strip()
        line = format_osm_address_line(address, display_name)
        if not line:
            continue
        items.append(
            {
                "display_name": display_name or line,
                "address_line": line,
                "latitude": lat,
                "longitude": lng,
                "postcode": address.get("postcode"),
            }
        )
    return items


def resolve_address_coords(
    address: str,
    *,
    latitude: float | None = None,
    longitude: float | None = None,
) -> tuple[float, float] | None:
    """Use stored OSM coordinates when present, otherwise geocode the address text."""
    if latitude is not None and longitude is not None and validate_uk_coords(latitude, longitude):
        return float(latitude), float(longitude)
    return geocode_address(address)


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
