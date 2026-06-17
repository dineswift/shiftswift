"""Time punch — geofence validation and punch records."""

from __future__ import annotations

import csv
import io
import math
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from modules.time_punch.geocode import geocode_address, normalize_geocode_address, resolve_address_coords, validate_geocode_address

UK_TZ = ZoneInfo("Europe/London")


def uk_day_range_bounds(
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[datetime | None, datetime | None]:
    """Inclusive local (Europe/London) calendar dates → UTC timestamptz bounds."""
    start = None
    end = None
    if date_from is not None:
        start = datetime.combine(date_from, time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    if date_to is not None:
        end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UK_TZ).astimezone(timezone.utc)
    return start, end


def uk_today() -> date:
    return datetime.now(UK_TZ).date()

PunchType = Literal["in", "out", "break_start", "break_end"]
PunchMethod = Literal["gps", "site_qr", "admin", "kiosk"]
WorkState = Literal["off", "clocked_in", "on_break"]
SITE_SCAN_VALID_MINUTES = 10
RAPID_RE_PUNCH_MINUTES = int(os.getenv("PUNCH_RAPID_REPUNCH_MINUTES", "10"))
PUNCH_QR_MAX_AGE_HOURS = int(os.getenv("PUNCH_QR_MAX_AGE_HOURS", "24"))
DEFAULT_RADIUS_M = int(os.getenv("PUNCH_GEOFENCE_RADIUS_M", "150"))


class PunchSyncError(ValueError):
    """Raised when a punch site cannot be synced from the tenant address."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def resolve_employee(*, tenant_id: int, username: str, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, email, status
            FROM employees
            WHERE tenant_id = %s AND lower(email) = lower(%s)
            LIMIT 1
            """,
            (tenant_id, username),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "first_name": row[1],
        "last_name": row[2],
        "email": row[3],
        "status": row[4],
    }


def _site_row(row: tuple[Any, ...]) -> dict[str, Any]:
    updated_at = row[9] if len(row) > 9 else None
    permitted_roles = row[10] if len(row) > 10 else "all"
    return {
        "id": row[0],
        "tenant_id": row[1],
        "name": row[2],
        "address": row[3],
        "latitude": row[4],
        "longitude": row[5],
        "radius_meters": row[6],
        "is_primary": bool(row[7]),
        "is_active": bool(row[8]),
        "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else updated_at,
        "permitted_roles": permitted_roles or "all",
    }


def _new_site_clock_token() -> str:
    return secrets.token_urlsafe(24)


def ensure_site_clock_token(*, tenant_id: int, site_id: int, conn: Any) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT site_clock_token FROM punch_sites WHERE id = %s AND tenant_id = %s",
            (site_id, tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Punch site not found")
        if row[0]:
            return str(row[0])
        token = _new_site_clock_token()
        cur.execute(
            """
            UPDATE punch_sites
            SET site_clock_token = %s,
                site_clock_token_issued_at = NOW(),
                updated_at = NOW()
            WHERE id = %s AND tenant_id = %s
            """,
            (token, site_id, tenant_id),
        )
    conn.commit()
    return token


def rotate_site_clock_token(*, tenant_id: int, site_id: int, conn: Any) -> str:
    token = _new_site_clock_token()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE punch_sites
            SET site_clock_token = %s,
                site_clock_token_issued_at = NOW(),
                updated_at = NOW()
            WHERE id = %s AND tenant_id = %s
            RETURNING id
            """,
            (token, site_id, tenant_id),
        )
        if not cur.fetchone():
            raise LookupError("Punch site not found")
    conn.commit()
    return token


def site_clock_url(*, clock_token: str) -> str:
    base = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    return f"{base}/punch.html?clock={clock_token}"


def site_kiosk_url(*, clock_token: str) -> str:
    base = os.getenv("APP_URL", "https://app.shiftswifthr.co.uk").rstrip("/")
    return f"{base}/punch-kiosk.html?clock={clock_token}"


def work_state_from_last(last: dict[str, Any] | None) -> WorkState:
    if not last:
        return "off"
    punch_type = last.get("punch_type")
    if punch_type in {"in", "break_end"}:
        return "clocked_in"
    if punch_type == "break_start":
        return "on_break"
    return "off"


def _parse_punched_at(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _detect_rapid_re_punch(*, last: dict[str, Any] | None, punch_type: PunchType) -> bool:
    """Flag clock-in shortly after clock-out (payroll / audit visibility)."""
    if punch_type != "in" or not last or last.get("punch_type") != "out":
        return False
    last_at = _parse_punched_at(last.get("punched_at"))
    if not last_at:
        return False
    now = datetime.now(timezone.utc)
    delta_seconds = (now - last_at).total_seconds()
    return 0 <= delta_seconds <= RAPID_RE_PUNCH_MINUTES * 60


def _validate_site_clock_token_freshness(site: dict[str, Any]) -> None:
    if PUNCH_QR_MAX_AGE_HOURS <= 0:
        return
    issued_at = _parse_punched_at(site.get("site_clock_token_issued_at"))
    if not issued_at:
        return
    age_hours = (datetime.now(timezone.utc) - issued_at).total_seconds() / 3600.0
    if age_hours > PUNCH_QR_MAX_AGE_HOURS:
        raise LookupError(
            "This premises QR code has expired — ask your manager to print a fresh code from Time punch."
        )


def _validate_punch_transition(*, tenant_id: int, employee_id: int, punch_type: PunchType, conn: Any) -> None:
    last = last_punch(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    state = work_state_from_last(last)
    allowed: dict[WorkState, set[PunchType]] = {
        "off": {"in"},
        "clocked_in": {"out", "break_start"},
        "on_break": {"break_end", "out"},
    }
    if punch_type not in allowed.get(state, set()):
        if punch_type == "in":
            raise ValueError("Already on shift — clock out first")
        if punch_type == "out":
            raise ValueError("Not clocked in")
        if punch_type == "break_start":
            raise ValueError("Clock in before starting a break")
        if punch_type == "break_end":
            raise ValueError("No break in progress")


def _insert_time_punch(
    *,
    tenant_id: int,
    employee_id: int,
    punch_site_id: int,
    punch_type: PunchType,
    latitude: float,
    longitude: float,
    accuracy_meters: float | None,
    distance_meters: float,
    app_username: str,
    ip_address: str | None,
    user_agent: str | None,
    punch_method: PunchMethod,
    conn: Any,
    rapid_re_punch: bool = False,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO time_punches (
              tenant_id, employee_id, punch_site_id, punch_type, punched_at,
              latitude, longitude, accuracy_meters, distance_meters, within_geofence,
              app_username, ip_address, user_agent, punch_method, rapid_re_punch
            )
            VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, TRUE, %s, %s, %s, %s, %s)
            RETURNING id, punched_at
            """,
            (
                tenant_id,
                employee_id,
                punch_site_id,
                punch_type,
                latitude,
                longitude,
                accuracy_meters,
                distance_meters,
                app_username,
                ip_address,
                user_agent,
                punch_method,
                rapid_re_punch,
            ),
        )
        row = cur.fetchone()
    conn.commit()
    punched_at = row[1]
    work_state = work_state_from_last({"punch_type": punch_type})
    on_shift = work_state != "off"
    return {
        "id": row[0],
        "punch_type": punch_type,
        "punched_at": punched_at.isoformat() if isinstance(punched_at, datetime) else punched_at,
        "distance_meters": round(float(distance_meters), 1),
        "clocked_in": on_shift,
        "on_break": work_state == "on_break",
        "work_state": work_state,
        "punch_method": punch_method,
        "rapid_re_punch": rapid_re_punch,
    }


def resolve_site_by_clock_token(*, clock_token: str, conn: Any) -> dict[str, Any] | None:
    clean = (clock_token or "").strip()
    if not clean:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                   COALESCE(permitted_roles, 'all'), site_clock_token_issued_at
            FROM punch_sites
            WHERE site_clock_token = %s AND is_active = TRUE
            LIMIT 1
            """,
            (clean,),
        )
        row = cur.fetchone()
    if not row:
        return None
    site = _site_row(row)
    site["site_clock_token_issued_at"] = (
        row[11].isoformat() if len(row) > 11 and isinstance(row[11], datetime) else row[11] if len(row) > 11 else None
    )
    return site


def employee_can_punch_at_site(*, tenant_id: int, employee_id: int, site_id: int, conn: Any) -> bool:
    sites = eligible_sites_for_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    return any(site["id"] == site_id for site in sites)


def scan_site_token(
    *,
    tenant_id: int,
    employee_id: int,
    clock_token: str,
    conn: Any,
) -> dict[str, Any]:
    """Validate a premises QR token for the logged-in employee (no punch recorded)."""
    site = resolve_site_by_clock_token(clock_token=clock_token, conn=conn)
    if not site:
        raise LookupError("Invalid or expired premises code")
    _validate_site_clock_token_freshness(site)
    if site["tenant_id"] != tenant_id:
        raise PermissionError("This premises code belongs to another business")
    if not employee_can_punch_at_site(
        tenant_id=tenant_id,
        employee_id=employee_id,
        site_id=site["id"],
        conn=conn,
    ):
        raise PermissionError(f"You are not assigned to punch at {site['name']}")
    return {
        "site_id": site["id"],
        "site_name": site["name"],
        "valid_until_minutes": SITE_SCAN_VALID_MINUTES,
        "message": (
            f"Premises verified — {site['name']}. "
            f"You can clock in or out without GPS for the next {SITE_SCAN_VALID_MINUTES} minutes."
        ),
    }


def format_permitted_roles(value: str | None) -> str:
    if not value or value == "all":
        return "All staff"
    return value.replace(",", ", ")


def list_punch_sites(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                   COALESCE(permitted_roles, 'all')
            FROM punch_sites
            WHERE tenant_id = %s
            ORDER BY is_primary DESC, name
            """,
            (tenant_id,),
        )
        return [_site_row(row) for row in cur.fetchall()]


def upsert_primary_punch_site(
    *,
    tenant_id: int,
    name: str,
    address: str,
    latitude: float,
    longitude: float,
    radius_meters: int = DEFAULT_RADIUS_M,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM punch_sites
            WHERE tenant_id = %s AND is_primary = TRUE
            LIMIT 1
            """,
            (tenant_id,),
        )
        existing = cur.fetchone()
        if existing:
            cur.execute(
                """
                UPDATE punch_sites SET
                  name = %s,
                  address = %s,
                  latitude = %s,
                  longitude = %s,
                  radius_meters = %s,
                  is_active = TRUE,
                  updated_at = NOW()
                WHERE id = %s
                RETURNING id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                          COALESCE(permitted_roles, 'all')
                """,
                (name, address, latitude, longitude, radius_meters, existing[0]),
            )
        else:
            cur.execute(
                """
                INSERT INTO punch_sites (
                  tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active
                )
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, TRUE)
                RETURNING id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                          COALESCE(permitted_roles, 'all')
                """,
                (tenant_id, name, address, latitude, longitude, radius_meters),
            )
        row = cur.fetchone()
    conn.commit()
    return _site_row(row)


def sync_primary_site_from_tenant_address(
    *,
    tenant_id: int,
    conn: Any,
    address_override: str | None = None,
    coords_override: tuple[float, float] | None = None,
    persist_address: bool = False,
) -> dict[str, Any]:
    from core.schema import table_columns

    address = normalize_geocode_address(str(address_override or ""))
    stored_lat: float | None = None
    stored_lng: float | None = None
    name = "Primary site"
    tenant_cols = table_columns(conn, "tenants")
    has_coords_cols = "registered_latitude" in tenant_cols and "registered_longitude" in tenant_cols
    if coords_override:
        stored_lat, stored_lng = coords_override

    if not address:
        coord_select = (
            ", registered_latitude, registered_longitude"
            if has_coords_cols
            else ", NULL AS registered_latitude, NULL AS registered_longitude"
        )
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT name, trading_name, registered_address{coord_select}
                FROM tenants WHERE id = %s
                """,
                (tenant_id,),
            )
            row = cur.fetchone()
        if not row:
            raise PunchSyncError("missing_address", "Business not found.")
        address = normalize_geocode_address(str(row[2] or ""))
        name = (row[1] or row[0] or name) if row else name
        if has_coords_cols and stored_lat is None and row[3] is not None and row[4] is not None:
            stored_lat = float(row[3])
            stored_lng = float(row[4])
    else:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, trading_name FROM tenants WHERE id = %s",
                (tenant_id,),
            )
            row = cur.fetchone()
        if row:
            name = row[1] or row[0] or name
        if persist_address:
            if has_coords_cols and coords_override:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE tenants
                        SET registered_address = %s,
                            registered_latitude = %s,
                            registered_longitude = %s
                        WHERE id = %s
                        """,
                        (address, coords_override[0], coords_override[1], tenant_id),
                    )
            else:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE tenants SET registered_address = %s WHERE id = %s",
                        (address, tenant_id),
                    )
            conn.commit()

    if not address:
        raise PunchSyncError(
            "missing_address",
            "Set your registered business address in Settings → Business profile, then sync again.",
        )
    resolve_lat = coords_override[0] if coords_override else stored_lat
    resolve_lng = coords_override[1] if coords_override else stored_lng
    valid, validation_error = validate_geocode_address(
        address,
        latitude=resolve_lat,
        longitude=resolve_lng,
    )
    if not valid:
        raise PunchSyncError("invalid_address", validation_error or "Invalid business address.")
    coords = resolve_address_coords(
        address,
        latitude=resolve_lat,
        longitude=resolve_lng,
    )
    if not coords:
        raise PunchSyncError(
            "geocode_failed",
            "Could not locate that address on the map. Search and select your address in Settings → Business info.",
        )
    lat, lng = coords
    site = upsert_primary_punch_site(
        tenant_id=tenant_id,
        name=f"{name} — main",
        address=address,
        latitude=lat,
        longitude=lng,
        conn=conn,
    )
    ensure_site_clock_token(tenant_id=tenant_id, site_id=site["id"], conn=conn)
    return site


def create_punch_site(
    *,
    tenant_id: int,
    name: str,
    address: str,
    radius_meters: int = DEFAULT_RADIUS_M,
    is_primary: bool = False,
    permitted_roles: str = "all",
    conn: Any,
) -> dict[str, Any]:
    clean_name = name.strip()
    clean_address = normalize_geocode_address(address)
    if not clean_name or not clean_address:
        raise ValueError("Name and address are required")
    valid, validation_error = validate_geocode_address(clean_address)
    if not valid:
        raise ValueError(validation_error or "Invalid address")
    coords = geocode_address(clean_address)
    if not coords:
        raise LookupError("Could not geocode address — check the address or try a fuller postcode")
    lat, lng = coords
    roles = (permitted_roles or "all").strip() or "all"
    with conn.cursor() as cur:
        if is_primary:
            cur.execute(
                "UPDATE punch_sites SET is_primary = FALSE WHERE tenant_id = %s AND is_primary = TRUE",
                (tenant_id,),
            )
        cur.execute(
            """
            INSERT INTO punch_sites (
              tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, permitted_roles
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s)
            RETURNING id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at,
                      COALESCE(permitted_roles, 'all')
            """,
            (tenant_id, clean_name, clean_address, lat, lng, radius_meters, is_primary, roles),
        )
        row = cur.fetchone()
    conn.commit()
    return _site_row(row)


def assign_employee_to_site(
    *,
    tenant_id: int,
    employee_id: int,
    punch_site_id: int,
    conn: Any,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO employee_punch_assignments (tenant_id, employee_id, punch_site_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (employee_id, punch_site_id) DO NOTHING
            """,
            (tenant_id, employee_id, punch_site_id),
        )
    conn.commit()


def eligible_sites_for_employee(*, tenant_id: int, employee_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ps.id, ps.tenant_id, ps.name, ps.address, ps.latitude, ps.longitude,
                   ps.radius_meters, ps.is_primary, ps.is_active
            FROM employee_punch_assignments epa
            JOIN punch_sites ps ON ps.id = epa.punch_site_id
            WHERE epa.tenant_id = %s AND epa.employee_id = %s AND ps.is_active = TRUE
            """,
            (tenant_id, employee_id),
        )
        assigned = [_site_row(row) for row in cur.fetchall()]
        if assigned:
            return assigned
        cur.execute(
            """
            SELECT id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at
            FROM punch_sites
            WHERE tenant_id = %s AND is_active = TRUE
            ORDER BY is_primary DESC, id
            """,
            (tenant_id,),
        )
        return [_site_row(row) for row in cur.fetchall()]


def _nearest_punch_site(
    *,
    latitude: float,
    longitude: float,
    sites: list[dict[str, Any]],
) -> tuple[dict[str, Any], float]:
    best_site: dict[str, Any] | None = None
    best_distance: float | None = None
    for site in sites:
        distance = haversine_meters(latitude, longitude, site["latitude"], site["longitude"])
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_site = site
    assert best_site is not None and best_distance is not None
    return best_site, best_distance


def preview_geofence(
    *,
    tenant_id: int,
    employee_id: int,
    latitude: float,
    longitude: float,
    accuracy_meters: float | None,
    conn: Any,
) -> dict[str, Any]:
    """Server-side geofence check — same distance rules as record_punch, without writing."""
    sites = eligible_sites_for_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not sites:
        raise LookupError("No punch sites configured for this business")

    best_site, best_distance = _nearest_punch_site(latitude=latitude, longitude=longitude, sites=sites)
    radius = float(best_site["radius_meters"])
    within = best_distance <= radius
    dist_int = int(round(best_distance))
    radius_int = int(radius)
    if within:
        message = f"Within {best_site['name']} ({dist_int}m from site, limit {radius_int}m)."
    else:
        message = f"You appear to be {dist_int}m from {best_site['name']}. Move closer to clock in."

    return {
        "within_geofence": within,
        "distance_meters": round(best_distance, 1),
        "site_name": best_site["name"],
        "site_id": best_site["id"],
        "radius_meters": radius_int,
        "accuracy_meters": accuracy_meters,
        "message": message,
    }


def last_punch(*, tenant_id: int, employee_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT tp.id, tp.punch_type, tp.punched_at, ps.name, tp.punch_site_id
            FROM time_punches tp
            JOIN punch_sites ps ON ps.id = tp.punch_site_id
            WHERE tp.tenant_id = %s AND tp.employee_id = %s
            ORDER BY tp.punched_at DESC
            LIMIT 1
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    punched_at = row[2]
    return {
        "id": row[0],
        "punch_type": row[1],
        "punched_at": punched_at.isoformat() if isinstance(punched_at, datetime) else punched_at,
        "site_name": row[3],
        "punch_site_id": row[4],
    }


def tenant_time_clock_enabled(*, tenant_id: int, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM punch_sites WHERE tenant_id = %s AND is_active = TRUE",
            (tenant_id,),
        )
        return int(cur.fetchone()[0]) > 0


def employee_time_clock_enabled(*, tenant_id: int, username: str, conn: Any) -> bool:
    """True when the employee can use geofenced clock in/out (active punch sites)."""
    employee = resolve_employee(tenant_id=tenant_id, username=username, conn=conn)
    if not employee:
        return False
    return bool(eligible_sites_for_employee(tenant_id=tenant_id, employee_id=employee["id"], conn=conn))


def employee_punch_status(*, tenant_id: int, employee_id: int, conn: Any) -> dict[str, Any]:
    from datetime import date

    from modules.rota.attendance import expected_shift_for_employee_on_date, list_employee_week_shifts
    from modules.rota.service import get_tenant_rota_week_start_day, week_start_on_or_before

    sites = eligible_sites_for_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    last = last_punch(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    work_state = work_state_from_last(last)
    clocked_in = work_state != "off"
    today = date.today()
    week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    week_start = week_start_on_or_before(today, week_start_day)
    expected_shift = expected_shift_for_employee_on_date(
        tenant_id=tenant_id,
        employee_id=employee_id,
        on_date=today,
        conn=conn,
    )
    week_shifts = list_employee_week_shifts(
        tenant_id=tenant_id,
        employee_id=employee_id,
        week_start=week_start,
        conn=conn,
    )
    from employee_portal_consent import tenant_display_name

    last_clock_out_at = None
    seconds_since_clock_out = None
    break_started_at = None
    if last:
        last_at = _parse_punched_at(last.get("punched_at"))
        if work_state == "on_break" and last_at:
            break_started_at = last.get("punched_at")
        if last.get("punch_type") == "out" and last_at:
            last_clock_out_at = last.get("punched_at")
            seconds_since_clock_out = max(0, int((datetime.now(timezone.utc) - last_at).total_seconds()))

    return {
        "clocked_in": clocked_in,
        "on_break": work_state == "on_break",
        "work_state": work_state,
        "last_punch": last,
        "last_clock_out_at": last_clock_out_at,
        "seconds_since_clock_out": seconds_since_clock_out,
        "break_started_at": break_started_at,
        "rapid_re_punch_window_minutes": RAPID_RE_PUNCH_MINUTES,
        "clock_in_cooldown_seconds": int(os.getenv("PUNCH_CLOCK_IN_COOLDOWN_SECONDS", "90")),
        "tenant_name": tenant_display_name(tenant_id=tenant_id, conn=conn),
        "assigned_sites": [
            {
                "id": s["id"],
                "name": s["name"],
                "address": s["address"],
                "radius_meters": s["radius_meters"],
            }
            for s in sites
        ],
        "expected_shift_today": expected_shift,
        "week_shifts": week_shifts,
        "week_start": week_start.isoformat(),
    }


def record_punch(
    *,
    tenant_id: int,
    employee_id: int,
    username: str,
    punch_type: PunchType,
    latitude: float,
    longitude: float,
    accuracy_meters: float | None,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    employee = resolve_employee(tenant_id=tenant_id, username=username, conn=conn)
    if not employee or employee["id"] != employee_id:
        raise LookupError("employee not found")
    if employee["status"] not in {"active", "onboarding"}:
        raise PermissionError("employee is not active")

    _validate_punch_transition(
        tenant_id=tenant_id,
        employee_id=employee_id,
        punch_type=punch_type,
        conn=conn,
    )

    sites = eligible_sites_for_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not sites:
        raise LookupError("No punch sites configured for this business")

    best_site, best_distance = _nearest_punch_site(latitude=latitude, longitude=longitude, sites=sites)
    within = best_distance <= float(best_site["radius_meters"])
    if not within:
        raise PermissionError(
            f"You must be within {best_site['radius_meters']}m of {best_site['name']} to punch "
            f"(currently ~{int(best_distance)}m away)"
        )

    prior = last_punch(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    rapid_re_punch = _detect_rapid_re_punch(last=prior, punch_type=punch_type)

    result = _insert_time_punch(
        tenant_id=tenant_id,
        employee_id=employee_id,
        punch_site_id=best_site["id"],
        punch_type=punch_type,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        distance_meters=best_distance,
        app_username=username,
        ip_address=ip_address,
        user_agent=user_agent,
        punch_method="gps",
        conn=conn,
        rapid_re_punch=rapid_re_punch,
    )
    result["site_name"] = best_site["name"]
    return result


def record_punch_via_site_token(
    *,
    tenant_id: int,
    employee_id: int,
    username: str,
    punch_type: PunchType,
    clock_token: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    employee = resolve_employee(tenant_id=tenant_id, username=username, conn=conn)
    if not employee or employee["id"] != employee_id:
        raise LookupError("employee not found")
    if employee["status"] not in {"active", "onboarding"}:
        raise PermissionError("employee is not active")

    _validate_punch_transition(
        tenant_id=tenant_id,
        employee_id=employee_id,
        punch_type=punch_type,
        conn=conn,
    )

    site = resolve_site_by_clock_token(clock_token=clock_token, conn=conn)
    if not site:
        raise LookupError("Invalid or expired premises code")
    _validate_site_clock_token_freshness(site)
    if site["tenant_id"] != tenant_id:
        raise PermissionError("This premises code belongs to another business")
    if not employee_can_punch_at_site(
        tenant_id=tenant_id,
        employee_id=employee_id,
        site_id=site["id"],
        conn=conn,
    ):
        raise PermissionError(f"You are not assigned to punch at {site['name']}")

    prior = last_punch(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    rapid_re_punch = _detect_rapid_re_punch(last=prior, punch_type=punch_type)

    result = _insert_time_punch(
        tenant_id=tenant_id,
        employee_id=employee_id,
        punch_site_id=site["id"],
        punch_type=punch_type,
        latitude=site["latitude"],
        longitude=site["longitude"],
        accuracy_meters=None,
        distance_meters=0.0,
        app_username=username,
        ip_address=ip_address,
        user_agent=user_agent,
        punch_method="site_qr",
        conn=conn,
        rapid_re_punch=rapid_re_punch,
    )
    result["site_name"] = site["name"]
    return result


def record_admin_punch(
    *,
    tenant_id: int,
    employee_id: int,
    punch_site_id: int,
    punch_type: PunchType,
    punched_at: datetime | None,
    admin_note: str | None,
    recorded_by: str,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, first_name, last_name, status FROM employees
            WHERE id = %s AND tenant_id = %s
            """,
            (employee_id, tenant_id),
        )
        employee = cur.fetchone()
        if not employee:
            raise LookupError("Employee not found")
        if employee[3] not in {"active", "onboarding"}:
            raise PermissionError("Employee is not active")

        _validate_punch_transition(
            tenant_id=tenant_id,
            employee_id=employee_id,
            punch_type=punch_type,
            conn=conn,
        )

        cur.execute(
            """
            SELECT id, tenant_id, name, address, latitude, longitude, radius_meters, is_primary, is_active, updated_at
            FROM punch_sites
            WHERE id = %s AND tenant_id = %s AND is_active = TRUE
            """,
            (punch_site_id, tenant_id),
        )
        site_row = cur.fetchone()
        if not site_row:
            raise LookupError("Punch site not found")
        site = _site_row(site_row)

        ts = punched_at or datetime.now(timezone.utc)
        if punched_at and punched_at.tzinfo is None:
            ts = punched_at.replace(tzinfo=timezone.utc)

        cur.execute(
            """
            INSERT INTO time_punches (
              tenant_id, employee_id, punch_site_id, punch_type, punched_at,
              latitude, longitude, accuracy_meters, distance_meters, within_geofence,
              app_username, admin_override, admin_note, recorded_by, punch_method
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, 0, TRUE, %s, TRUE, %s, %s, 'admin')
            RETURNING id, punched_at
            """,
            (
                tenant_id,
                employee_id,
                punch_site_id,
                punch_type,
                ts,
                site["latitude"],
                site["longitude"],
                recorded_by,
                admin_note,
                recorded_by,
            ),
        )
        row = cur.fetchone()
    conn.commit()
    punched_at_out = row[1]
    return {
        "id": row[0],
        "punch_type": punch_type,
        "punched_at": punched_at_out.isoformat() if isinstance(punched_at_out, datetime) else punched_at_out,
        "site_name": site["name"],
        "employee_name": f"{employee[1]} {employee[2]}".strip(),
        "admin_override": True,
        "punch_method": "admin",
    }


def _punch_row(row: tuple[Any, ...]) -> dict[str, Any]:
    punched_at = row[2]
    radius_meters = int(row[12]) if len(row) > 12 and row[12] is not None else None
    within_geofence = bool(row[13]) if len(row) > 13 else True
    distance = float(row[3]) if row[3] is not None else None
    if distance is not None and radius_meters is not None and not bool(row[9] if len(row) > 9 else False):
        within_geofence = distance <= radius_meters
    reviewed_at = row[16] if len(row) > 16 else None
    reviewed_by = row[17] if len(row) > 17 else None
    rapid_re_punch = bool(row[18]) if len(row) > 18 else False
    if isinstance(reviewed_at, datetime):
        reviewed_at = reviewed_at.isoformat()
    return {
        "id": row[0],
        "punch_type": row[1],
        "punched_at": punched_at.isoformat() if isinstance(punched_at, datetime) else punched_at,
        "distance_meters": distance,
        "employee_id": int(row[4]) if row[4] is not None else None,
        "employee_name": f"{row[5]} {row[6]}".strip(),
        "employee_email": row[7],
        "site_name": row[8],
        "admin_override": bool(row[9]) if len(row) > 9 else False,
        "admin_note": row[10] if len(row) > 10 else None,
        "punch_site_id": row[11] if len(row) > 11 else None,
        "radius_meters": radius_meters,
        "within_geofence": within_geofence,
        "accuracy_meters": float(row[14]) if len(row) > 14 and row[14] is not None else None,
        "punch_method": row[15] if len(row) > 15 and row[15] else "gps",
        "hr_reviewed_at": reviewed_at,
        "hr_reviewed_by": reviewed_by,
        "hr_review_pending": reviewed_at is None,
        "rapid_re_punch": rapid_re_punch,
    }


def list_recent_punches(
    *,
    tenant_id: int,
    conn: Any,
    limit: int = 100,
    employee_id: int | None = None,
    punch_site_id: int | None = None,
    punch_type: PunchType | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    review_status: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["tp.tenant_id = %s"]
    params: list[Any] = [tenant_id]
    if employee_id is not None:
        clauses.append("tp.employee_id = %s")
        params.append(employee_id)
    if punch_site_id is not None:
        clauses.append("tp.punch_site_id = %s")
        params.append(punch_site_id)
    if punch_type is not None:
        clauses.append("tp.punch_type = %s")
        params.append(punch_type)
    if review_status == "pending":
        clauses.append("tp.hr_reviewed_at IS NULL")
    elif review_status == "reviewed":
        clauses.append("tp.hr_reviewed_at IS NOT NULL")
    range_start, range_end = uk_day_range_bounds(date_from=date_from, date_to=date_to)
    if range_start is not None:
        clauses.append("tp.punched_at >= %s")
        params.append(range_start)
    if range_end is not None:
        clauses.append("tp.punched_at < %s")
        params.append(range_end)
    where = " AND ".join(clauses)
    params.append(limit)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT tp.id, tp.punch_type, tp.punched_at, tp.distance_meters,
                   tp.employee_id, e.first_name, e.last_name, e.email, ps.name,
                   COALESCE(tp.admin_override, FALSE), tp.admin_note,
                   tp.punch_site_id, ps.radius_meters, tp.within_geofence, tp.accuracy_meters,
                   COALESCE(tp.punch_method, 'gps'), tp.hr_reviewed_at, tp.hr_reviewed_by,
                   COALESCE(tp.rapid_re_punch, FALSE)
            FROM time_punches tp
            JOIN employees e ON e.id = tp.employee_id
            JOIN punch_sites ps ON ps.id = tp.punch_site_id
            WHERE {where}
            ORDER BY tp.punched_at DESC
            LIMIT %s
            """,
            params,
        )
        rows = cur.fetchall()
    return [_punch_row(row) for row in rows]


def review_punch(
    *,
    tenant_id: int,
    punch_id: int,
    reviewed_by: str,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE time_punches
            SET hr_reviewed_at = NOW(), hr_reviewed_by = %s
            WHERE id = %s AND tenant_id = %s AND hr_reviewed_at IS NULL
            RETURNING id
            """,
            (reviewed_by.strip(), punch_id, tenant_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Punch not found or already reviewed")
    conn.commit()
    return {"id": int(row[0]), "reviewed": True}


def review_punches_bulk(
    *,
    tenant_id: int,
    punch_ids: list[int],
    reviewed_by: str,
    conn: Any,
) -> dict[str, int]:
    if not punch_ids:
        return {"reviewed_count": 0}
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE time_punches
            SET hr_reviewed_at = NOW(), hr_reviewed_by = %s
            WHERE tenant_id = %s
              AND id = ANY(%s)
              AND hr_reviewed_at IS NULL
            """,
            (reviewed_by.strip(), tenant_id, punch_ids),
        )
        reviewed_count = cur.rowcount
    conn.commit()
    return {"reviewed_count": reviewed_count}


def export_punches_csv(
    *,
    tenant_id: int,
    conn: Any,
    limit: int = 5000,
    employee_id: int | None = None,
    punch_site_id: int | None = None,
    punch_type: PunchType | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    review_status: str | None = None,
) -> str:
    items = list_recent_punches(
        tenant_id=tenant_id,
        conn=conn,
        limit=limit,
        employee_id=employee_id,
        punch_site_id=punch_site_id,
        punch_type=punch_type,
        date_from=date_from,
        date_to=date_to,
        review_status=review_status,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Punched at",
            "Employee",
            "Email",
            "Type",
            "Site",
            "Distance (m)",
            "GPS accuracy (m)",
            "Method",
            "Admin override",
            "Admin note",
            "HR reviewed at",
            "HR reviewed by",
            "Rapid re-punch",
        ]
    )
    for item in items:
        method = item.get("punch_method") or "gps"
        method_label = {
            "gps": "GPS",
            "site_qr": "Premises QR",
            "admin": "Admin",
        }.get(method, method)
        punch_type_val = item.get("punch_type")
        type_label = {
            "in": "Clock in",
            "out": "Clock out",
            "break_start": "Break start",
            "break_end": "Break end",
        }.get(punch_type_val, punch_type_val or "")
        writer.writerow(
            [
                item.get("punched_at") or "",
                item.get("employee_name") or "",
                item.get("employee_email") or "",
                type_label,
                item.get("site_name") or "",
                item.get("distance_meters") if item.get("distance_meters") is not None else "",
                item.get("accuracy_meters") if item.get("accuracy_meters") is not None else "",
                method_label,
                "Yes" if item.get("admin_override") else "No",
                item.get("admin_note") or "",
                item.get("hr_reviewed_at") or "",
                item.get("hr_reviewed_by") or "",
                "Yes" if item.get("rapid_re_punch") else "No",
            ]
        )
    return buffer.getvalue()
