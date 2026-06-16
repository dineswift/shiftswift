"""Tenant admin workspace — profile, employees, document store."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from employee_audit import log_employee_data_event

ADVERT_PLATFORMS = [
    {"value": "GOV.UK Find a Job", "label": "GOV.UK Find a Job"},
    {"value": "Company careers site", "label": "Company careers site"},
    {"value": "Indeed", "label": "Indeed"},
    {"value": "LinkedIn", "label": "LinkedIn"},
    {"value": "Reed", "label": "Reed"},
    {"value": "Totaljobs", "label": "Totaljobs"},
    {"value": "Other", "label": "Other"},
]

from modules.documents.constants import TENANT_DOCUMENT_CATEGORIES as DOCUMENT_CATEGORIES

EMPLOYEE_STATUSES = [
    {"value": "active", "label": "Active"},
    {"value": "onboarding", "label": "Onboarding"},
    {"value": "suspended", "label": "Suspended"},
    {"value": "inactive", "label": "Inactive"},
    {"value": "terminated", "label": "Terminated"},
]

TENANT_PROFILE_FIELDS = (
    "name",
    "trading_name",
    "company_number",
    "registered_address",
    "registered_latitude",
    "registered_longitude",
    "phone",
    "billing_email",
    "vat_number",
    "signatory_name",
    "signatory_title",
    "signatory_email",
    "payroll_accountant_email",
    "payroll_hours_report_enabled",
    "rota_mode",
    "rota_week_start_day",
)

NOTIFICATION_PREF_DEFAULTS: dict[str, str] = {
    "rtw_expiry": "email",
    "absence_day5": "email",
    "absence_day9": "email_sms",
    "rota_published": "email",
    "missed_punch_hr": "email",
    "missed_punch_employee": "email",
}

NOTIFICATION_PREF_EVENTS = (
    {"id": "rtw_expiry", "label": "RTW expiry approaching"},
    {"id": "absence_day5", "label": "Absence day-5 warning"},
    {"id": "absence_day9", "label": "Absence day-9 alert"},
    {"id": "rota_published", "label": "Rota published"},
    {"id": "missed_punch_hr", "label": "Missed clock-in (HR alert)"},
    {"id": "missed_punch_employee", "label": "Missed clock-in (employee reminder)"},
)

VALID_NOTIFICATION_DELIVERY = frozenset({"email", "email_sms", "off"})


from modules.employees.repository import (
    _row_to_employee,
    build_employee_insert,
    fetch_employee,
    list_employee_summaries,
)
from modules.employees.workspace import list_completion_summary


def _parse_optional_coord(value: Any, *, min_v: float, max_v: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid map coordinates.") from exc
    if not min_v <= number <= max_v:
        raise ValueError("Map coordinates are out of range.")
    return number


def attach_rota_mode_fields(profile: dict[str, Any], *, tenant_id: int, conn: Any) -> dict[str, Any]:
    from plan_features import apply_rota_features

    stored = profile.get("rota_mode")
    rota: dict[str, object] = {}
    apply_rota_features(
        rota,
        stored_mode=stored,
        rota_advanced_addon=bool(profile.get("rota_advanced_addon")),
        rota_multi_site_addon=bool(profile.get("rota_multi_site_addon")),
    )
    profile["rota_mode_preference"] = stored
    profile["rota_mode"] = rota["rota_mode"]
    profile["rota_mode_options"] = rota["rota_mode_options"]
    profile["rota_mode_default"] = rota["rota_mode_default"]
    profile["rota_advanced_addon"] = rota["rota_advanced_addon"]
    profile["rota_multi_site_addon"] = rota["rota_multi_site_addon"]
    profile["rota_advanced_enabled"] = rota["rota_advanced_enabled"]
    profile["rota_multi_site_enabled"] = rota["rota_multi_site_enabled"]
    return profile


def get_tenant_profile(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    from core.schema import column_expr

    rota_mode_col = column_expr(conn, table="tenants", column="rota_mode", alias=None)
    rota_advanced_col = column_expr(
        conn,
        table="tenants",
        column="rota_advanced_addon",
        alias=None,
        null_sql="FALSE AS rota_advanced_addon",
    )
    rota_multi_col = column_expr(
        conn,
        table="tenants",
        column="rota_multi_site_addon",
        alias=None,
        null_sql="FALSE AS rota_multi_site_addon",
    )
    rota_week_start_col = column_expr(
        conn,
        table="tenants",
        column="rota_week_start_day",
        alias=None,
        null_sql="0 AS rota_week_start_day",
    )
    crm_addon_col = column_expr(
        conn,
        table="tenants",
        column="crm_addon",
        alias=None,
        null_sql="FALSE AS crm_addon",
    )
    registered_lat_col = column_expr(
        conn,
        table="tenants",
        column="registered_latitude",
        alias=None,
        null_sql="NULL AS registered_latitude",
    )
    registered_lng_col = column_expr(
        conn,
        table="tenants",
        column="registered_longitude",
        alias=None,
        null_sql="NULL AS registered_longitude",
    )
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, trading_name, company_number, registered_address, phone,
                   billing_email, vat_number, signatory_name, signatory_title, signatory_email,
                   subscription_plan, subscription_status, max_employees,
                   payroll_plan_id, payroll_enabled,
                   holds_sponsor_licence, sponsor_licence_acknowledged_at,
                   sponsor_licence_acknowledged_by, sponsor_licence_ack_version,
                   payroll_accountant_email, payroll_hours_report_enabled,
                   {rota_mode_col}, {rota_advanced_col}, {rota_multi_col}, {rota_week_start_col},
                   {crm_addon_col}, {registered_lat_col}, {registered_lng_col}
            FROM tenants WHERE id = %s
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
        profile = {
            "id": row[0],
            "name": row[1],
            "trading_name": row[2],
            "company_number": row[3],
            "registered_address": row[4],
            "phone": row[5],
            "billing_email": row[6],
            "vat_number": row[7],
            "signatory_name": row[8],
            "signatory_title": row[9],
            "signatory_email": row[10],
            "subscription_plan": row[11],
            "subscription_status": row[12],
            "max_employees": row[13],
            "payroll_plan_id": row[14],
            "payroll_enabled": row[15],
            "holds_sponsor_licence": bool(row[16]),
            "sponsor_licence_acknowledged": row[17] is not None,
            "sponsor_licence_acknowledged_at": row[17].isoformat() if row[17] else None,
            "sponsor_licence_acknowledged_by": row[18],
            "sponsor_licence_ack_version": row[19],
            "payroll_accountant_email": row[20],
            "payroll_hours_report_enabled": bool(row[21]),
            "rota_mode": row[22],
            "rota_advanced_addon": bool(row[23]),
            "rota_multi_site_addon": bool(row[24]),
            "rota_week_start_day": int(row[25] or 0),
            "crm_addon": bool(row[26]),
            "registered_latitude": float(row[27]) if row[27] is not None else None,
            "registered_longitude": float(row[28]) if row[28] is not None else None,
        }
    return attach_rota_mode_fields(profile, tenant_id=tenant_id, conn=conn)


def update_tenant_profile(
    *,
    tenant_id: int,
    updates: dict[str, Any],
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    from core.schema import table_columns

    allowed = {k: v for k, v in updates.items() if k in TENANT_PROFILE_FIELDS}
    tenant_cols = table_columns(conn, "tenants")
    if "registered_latitude" not in tenant_cols:
        allowed.pop("registered_latitude", None)
        allowed.pop("registered_longitude", None)

    parsed_lat: float | None = None
    parsed_lng: float | None = None
    if "registered_latitude" in allowed or "registered_longitude" in allowed:
        from modules.time_punch.geocode import validate_uk_coords

        lat_raw = allowed.pop("registered_latitude", None)
        lng_raw = allowed.pop("registered_longitude", None)
        parsed_lat = _parse_optional_coord(lat_raw, min_v=49.0, max_v=61.5)
        parsed_lng = _parse_optional_coord(lng_raw, min_v=-9.0, max_v=2.5)
        if (parsed_lat is None) ^ (parsed_lng is None):
            raise ValueError("Select your address from the OpenStreetMap search results to pin it on the map.")
        if parsed_lat is not None and parsed_lng is not None and not validate_uk_coords(parsed_lat, parsed_lng):
            raise ValueError("Map coordinates are outside the UK.")
        allowed["registered_latitude"] = parsed_lat
        allowed["registered_longitude"] = parsed_lng
    elif "registered_address" in allowed and "registered_latitude" in tenant_cols:
        allowed["registered_latitude"] = None
        allowed["registered_longitude"] = None

    if "registered_address" in allowed:
        from modules.time_punch.geocode import normalize_geocode_address, validate_geocode_address

        trimmed = normalize_geocode_address(str(allowed["registered_address"] or ""))
        allowed["registered_address"] = trimmed or None
        if allowed["registered_address"]:
            valid, validation_error = validate_geocode_address(
                allowed["registered_address"],
                latitude=parsed_lat,
                longitude=parsed_lng,
            )
            if not valid:
                raise ValueError(validation_error or "Invalid registered address")

    if not allowed:
        return get_tenant_profile(tenant_id=tenant_id, conn=conn)

    if "rota_mode" in allowed:
        from core.schema import table_columns
        from plan_features import validate_rota_mode_choice

        tenant_cols = table_columns(conn, "tenants")
        if "rota_mode" not in tenant_cols:
            allowed.pop("rota_mode", None)
        else:
            advanced_expr = (
                "rota_advanced_addon"
                if "rota_advanced_addon" in tenant_cols
                else "FALSE"
            )
            multi_expr = (
                "rota_multi_site_addon"
                if "rota_multi_site_addon" in tenant_cols
                else "FALSE"
            )
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT {advanced_expr}, {multi_expr}
                    FROM tenants WHERE id = %s
                    """,
                    (tenant_id,),
                )
                addon_row = cur.fetchone()
                if not addon_row:
                    raise LookupError("tenant not found")
            try:
                allowed["rota_mode"] = validate_rota_mode_choice(
                    rota_mode=allowed["rota_mode"],
                    rota_advanced_addon=bool(addon_row[0]),
                    rota_multi_site_addon=bool(addon_row[1]),
                )
            except ValueError as exc:
                raise ValueError(str(exc)) from exc

    if "rota_week_start_day" in allowed:
        from core.schema import table_columns
        from modules.rota.service import normalize_week_start_day

        if "rota_week_start_day" not in table_columns(conn, "tenants"):
            allowed.pop("rota_week_start_day", None)
        else:
            allowed["rota_week_start_day"] = normalize_week_start_day(allowed["rota_week_start_day"])

    sets = ", ".join(f"{key} = %s" for key in allowed)
    values = list(allowed.values()) + [tenant_id]
    with conn.cursor() as cur:
        cur.execute(f"UPDATE tenants SET {sets} WHERE id = %s", values)
        conn.commit()

    punch_site_sync: dict[str, Any] | None = None
    if allowed.get("registered_address"):
        try:
            from modules.time_punch.service import PunchSyncError, sync_primary_site_from_tenant_address

            site = sync_primary_site_from_tenant_address(tenant_id=tenant_id, conn=conn)
            punch_site_sync = {
                "ok": True,
                "site_id": site["id"],
                "site_name": site["name"],
            }
        except PunchSyncError as exc:
            punch_site_sync = {"ok": False, "code": exc.code, "message": str(exc)}
        except Exception as exc:
            punch_site_sync = {"ok": False, "code": "sync_error", "message": str(exc)}

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    if punch_site_sync is not None:
        profile["punch_site_sync"] = punch_site_sync

    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="update",
        entity_type="tenant_profile",
        entity_id=tenant_id,
        field_name=",".join(allowed.keys()),
        new_value="updated",
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    return profile


def get_notification_preferences(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT notify_on_rota_publish, notification_preferences
            FROM tenants
            WHERE id = %s
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
        notify_on_rota_publish = bool(row[0])
        stored = row[1] if isinstance(row[1], dict) else {}

    preferences = dict(NOTIFICATION_PREF_DEFAULTS)
    for key, value in (stored or {}).items():
        if key in NOTIFICATION_PREF_DEFAULTS and value in VALID_NOTIFICATION_DELIVERY:
            preferences[key] = value
    if not notify_on_rota_publish:
        preferences["rota_published"] = "off"

    from modules.employees.notification_branding import parse_employee_display_name_from_stored

    return {
        "preferences": preferences,
        "employee_display_name": parse_employee_display_name_from_stored(stored),
        "employee_display_name_default": "Your employer",
        "notify_on_rota_publish": notify_on_rota_publish,
        "events": list(NOTIFICATION_PREF_EVENTS),
    }


def update_notification_preferences(
    *,
    tenant_id: int,
    preferences: dict[str, str] | None = None,
    employee_display_name: str | None = None,
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT notification_preferences
            FROM tenants
            WHERE id = %s
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
        stored = row[0]

    from modules.employees.notification_branding import merge_notification_preferences_json

    merged_json = merge_notification_preferences_json(
        stored=stored,
        preferences=preferences,
        employee_display_name=employee_display_name,
    )
    notify_on_rota_publish = merged_json.get("rota_published", "email") != "off"
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenants
            SET notification_preferences = %s::jsonb,
                notify_on_rota_publish = %s
            WHERE id = %s
            """,
            (json.dumps(merged_json), notify_on_rota_publish, tenant_id),
        )
        conn.commit()

    field_names = []
    if preferences:
        field_names.extend(sorted(preferences.keys()))
    if employee_display_name is not None:
        field_names.append("employee_display_name")

    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="update",
        entity_type="notification_preferences",
        entity_id=tenant_id,
        field_name=",".join(field_names) or "updated",
        new_value="updated",
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    return get_notification_preferences(tenant_id=tenant_id, conn=conn)


def tenant_notification_delivery_enabled(*, tenant_id: int, event_id: str, conn: Any) -> bool:
    if event_id not in NOTIFICATION_PREF_DEFAULTS:
        return False
    prefs = get_notification_preferences(tenant_id=tenant_id, conn=conn)
    return prefs["preferences"].get(event_id, "email") != "off"


def list_employees(*, tenant_id: int, conn: Any, limit: int = 200) -> list[dict[str, Any]]:
    from modules.documents.service import fetch_document_categories_by_employee
    from modules.employees.portal_invites import enrich_employees_portal_status

    items = list_employee_summaries(tenant_id=tenant_id, conn=conn, limit=limit)
    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    payroll_enabled = bool(profile.get("payroll_enabled"))
    categories_by_employee = fetch_document_categories_by_employee(tenant_id=tenant_id, conn=conn)
    enriched = []
    for item in items:
        summary = list_completion_summary(
            item,
            payroll_enabled=payroll_enabled,
            document_categories=categories_by_employee.get(item["id"], []),
        )
        enriched.append({**item, **summary})
    return enrich_employees_portal_status(tenant_id=tenant_id, employees=enriched, conn=conn)


def create_employee(
    *,
    tenant_id: int,
    data: dict[str, Any],
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    from modules.employees.duplicates import DuplicateEmployeeError, assert_no_duplicate_employee

    assert_no_duplicate_employee(
        tenant_id=tenant_id,
        conn=conn,
        first_name=str(data["first_name"]),
        last_name=str(data["last_name"]),
        email=data.get("email"),
    )

    try:
        with conn.cursor() as cur:
            insert_sql, insert_values = build_employee_insert(
                tenant_id=tenant_id,
                data=data,
                conn=conn,
            )
            cur.execute(insert_sql, insert_values)
            row = cur.fetchone()
            conn.commit()
            emp = _row_to_employee(row)
    except Exception as exc:
        from modules.employees.duplicates import find_employee_email_conflict

        if getattr(exc, "pgcode", None) == "23505":
            conflict = find_employee_email_conflict(
                tenant_id=tenant_id,
                email=data.get("email"),
                conn=conn,
            )
            if conflict:
                raise DuplicateEmployeeError(
                    "An employee with this work email already exists. "
                    "Open their existing record instead of creating a duplicate.",
                    conflict="email",
                    existing_employee_id=conflict["id"],
                ) from exc
        raise
    from modules.employees.service import after_employee_created

    after_employee_created(
        tenant_id=tenant_id,
        employee=emp,
        data=data,
        actor_username=actor_username,
        actor_role=actor_role,
        conn=conn,
    )
    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="create",
        entity_type="employee",
        entity_id=emp["id"],
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    from billing_seat_sync import maybe_sync_tenant_stripe_seats

    maybe_sync_tenant_stripe_seats(tenant_id=tenant_id, conn=conn)
    return emp


def update_employee(
    *,
    tenant_id: int,
    employee_id: int,
    updates: dict[str, Any],
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    allowed_keys = {
        "first_name",
        "last_name",
        "email",
        "job_title",
        "salary",
        "work_location",
        "start_date",
        "status",
        "is_sponsored",
        "phone",
        "date_of_birth",
        "home_address",
        "ni_number",
        "department",
        "employment_type",
        "contract_hours_weekly",
        "probation_end_date",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relationship",
        "termination_date",
        "termination_reason",
    }
    status_reason = updates.pop("status_reason", None)
    allowed = {k: v for k, v in updates.items() if k in allowed_keys}
    if not allowed:
        return get_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)

    from modules.employees.service import after_employee_updated, get_employee_row

    from modules.employees.repository import _row_to_employee, update_employee_fields

    old_row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not old_row:
        raise LookupError("employee not found")

    if any(key in allowed for key in ("first_name", "last_name", "email")):
        from modules.employees.duplicates import assert_no_duplicate_employee

        assert_no_duplicate_employee(
            tenant_id=tenant_id,
            conn=conn,
            first_name=str(allowed.get("first_name", old_row["first_name"])),
            last_name=str(allowed.get("last_name", old_row["last_name"])),
            email=allowed.get("email", old_row.get("email")),
            exclude_employee_id=employee_id,
        )

    emp = update_employee_fields(
        tenant_id=tenant_id,
        employee_id=employee_id,
        updates=allowed,
        conn=conn,
    )
    new_row = get_employee_row(tenant_id=tenant_id, employee_id=employee_id, conn=conn)

    after_employee_updated(
        tenant_id=tenant_id,
        employee_id=employee_id,
        old_row=old_row,
        new_row=new_row or emp,
        actor_username=actor_username,
        actor_role=actor_role,
        conn=conn,
        reason=status_reason,
    )
    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="update",
        entity_type="employee",
        entity_id=employee_id,
        field_name=",".join(allowed.keys()),
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    if "status" in allowed:
        from billing_seat_sync import maybe_sync_tenant_stripe_seats

        maybe_sync_tenant_stripe_seats(tenant_id=tenant_id, conn=conn)
    return emp


def get_employee(*, tenant_id: int, employee_id: int, conn: Any) -> dict[str, Any]:
    employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not employee:
        raise LookupError("employee not found")
    return employee


def delete_employee(
    *,
    tenant_id: int,
    employee_id: int,
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM employees WHERE tenant_id = %s AND id = %s RETURNING id",
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("employee not found")
        conn.commit()
    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="delete",
        entity_type="employee",
        entity_id=employee_id,
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    from billing_seat_sync import maybe_sync_tenant_stripe_seats

    maybe_sync_tenant_stripe_seats(tenant_id=tenant_id, conn=conn)


def list_documents(
    *,
    tenant_id: int,
    conn: Any,
    limit: int = 200,
    category: str | None = None,
    lifecycle_stage: str | None = None,
) -> list[dict[str, Any]]:
    from modules.documents.service import list_tenant_documents

    return list_tenant_documents(
        tenant_id=tenant_id,
        conn=conn,
        category=category,
        lifecycle_stage=lifecycle_stage,
        limit=limit,
    )


def create_document(
    *,
    tenant_id: int,
    data: dict[str, Any],
    uploaded_by: str,
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    from modules.documents.service import create_tenant_document

    doc = create_tenant_document(
        tenant_id=tenant_id,
        data=data,
        uploaded_by=uploaded_by,
        conn=conn,
    )
    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="create",
        entity_type="tenant_document",
        entity_id=doc["id"],
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    return doc


def update_document(
    *,
    tenant_id: int,
    document_id: int,
    updates: dict[str, Any],
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> dict[str, Any]:
    from modules.documents.service import update_tenant_document

    doc = update_tenant_document(
        tenant_id=tenant_id,
        document_id=document_id,
        updates=updates,
        conn=conn,
    )
    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="update",
        entity_type="tenant_document",
        entity_id=document_id,
        field_name=",".join(updates.keys()),
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )
    return doc


def delete_document(
    *,
    tenant_id: int,
    document_id: int,
    actor_username: str,
    actor_role: str,
    ip_address: str | None,
    user_agent: str | None,
    conn: Any,
) -> None:
    from modules.documents.service import delete_tenant_document

    delete_tenant_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
    log_employee_data_event(
        tenant_id=tenant_id,
        actor_username=actor_username,
        actor_role=actor_role,
        action="delete",
        entity_type="tenant_document",
        entity_id=document_id,
        ip_address=ip_address,
        user_agent=user_agent,
        conn=conn,
    )


def admin_overview(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    from datetime import date

    from modules.rota import service as rota_service
    from modules.rota.service import get_tenant_rota_week_start_day, week_start_on_or_before
    from plan_features import effective_features_for_tenant, plan_display_name
    from sponsor_licence_compliance import RTW_EXPIRING_SOON_DAYS
    from trial_service import trial_snapshot

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    trial = trial_snapshot(tenant_id=tenant_id, conn=conn)
    today = date.today()
    rota_week_start_day = get_tenant_rota_week_start_day(tenant_id=tenant_id, conn=conn)
    week_start = week_start_on_or_before(today, rota_week_start_day)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM employees WHERE tenant_id = %s AND status = 'active'",
            (tenant_id,),
        )
        active_employees = int(cur.fetchone()[0])
        cur.execute(
            "SELECT COUNT(*) FROM employees WHERE tenant_id = %s AND status = 'onboarding'",
            (tenant_id,),
        )
        onboarding_employees = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM tenant_documents WHERE tenant_id = %s", (tenant_id,))
        document_count = int(cur.fetchone()[0])
        cur.execute(
            "SELECT COUNT(*) FROM employees WHERE tenant_id = %s AND is_sponsored = TRUE",
            (tenant_id,),
        )
        sponsored_employees = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*) FROM recruitment_vacancies
            WHERE tenant_id = %s AND status NOT IN ('closed', 'rejected', 'offer_accepted', 'onboarding_started')
            """,
            (tenant_id,),
        )
        open_vacancies = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM recruitment_applications ra
            JOIN recruitment_vacancies rv ON rv.id = ra.vacancy_id
            WHERE ra.tenant_id = %s AND ra.screening_status = 'pending'
              AND rv.status NOT IN ('closed', 'rejected')
            """,
            (tenant_id,),
        )
        pending_applicants = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*) FROM right_to_work_checks
            WHERE tenant_id = %s
            """,
            (tenant_id,),
        )
        rtw_total = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM right_to_work_checks
            WHERE tenant_id = %s AND expiry_date IS NOT NULL AND expiry_date < %s
            """,
            (tenant_id, today),
        )
        rtw_expired = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM right_to_work_checks
            WHERE tenant_id = %s
              AND expiry_date IS NOT NULL
              AND expiry_date >= %s
              AND expiry_date <= %s
            """,
            (tenant_id, today, today + timedelta(days=RTW_EXPIRING_SOON_DAYS)),
        )
        rtw_expiring_soon = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*) FROM sponsor_absence_alerts
            WHERE tenant_id = %s AND alert_status IN ('pending', 'sent')
            """,
            (tenant_id,),
        )
        day9_alerts = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM sponsored_absence_days
            WHERE tenant_id = %s AND absence_date >= %s
            """,
            (tenant_id, today.replace(day=1)),
        )
        active_absences = int(cur.fetchone()[0])

        cur.execute(
            "SELECT COUNT(*) FROM punch_sites WHERE tenant_id = %s AND is_active = TRUE",
            (tenant_id,),
        )
        punch_sites = int(cur.fetchone()[0])
        from modules.time_punch.service import uk_day_range_bounds, uk_today

        today_start, _ = uk_day_range_bounds(date_from=uk_today())
        cur.execute(
            """
            SELECT COUNT(*), MAX(punched_at)
            FROM time_punches
            WHERE tenant_id = %s AND punched_at >= %s
            """,
            (tenant_id, today_start),
        )
        punch_row = cur.fetchone()
        today_punches = int(punch_row[0])
        last_punch_at = punch_row[1].isoformat() if punch_row[1] else None

        cur.execute(
            """
            SELECT status, version
            FROM rota_weeks
            WHERE tenant_id = %s AND week_start = %s
            LIMIT 1
            """,
            (tenant_id, week_start),
        )
        rota_row = cur.fetchone()
        rota_status = rota_row[0] if rota_row else None
        cur.execute(
            """
            SELECT COUNT(*) FROM rota_shifts s
            JOIN rota_weeks w ON w.id = s.rota_week_id
            WHERE s.tenant_id = %s AND w.week_start = %s
            """,
            (tenant_id, week_start),
        )
        rota_shifts = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*) FROM grievance_cases
            WHERE tenant_id = %s AND status <> 'closed'
            """,
            (tenant_id,),
        )
        open_grievances = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM disciplinary_cases
            WHERE tenant_id = %s AND status <> 'closed'
            """,
            (tenant_id,),
        )
        open_disciplinary = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM offboarding_workflows
            WHERE tenant_id = %s AND status = 'in_progress'
            """,
            (tenant_id,),
        )
        offboarding_in_progress = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM employee_contracts
            WHERE tenant_id = %s AND status IN ('generated', 'sent')
            """,
            (tenant_id,),
        )
        contracts_pending = int(cur.fetchone()[0])

        from modules.leave.service import count_pending_leave_requests

        pending_leave_requests = count_pending_leave_requests(tenant_id=tenant_id, conn=conn)

        from modules.rota.missed_punch import count_missed_punch_alerts_on_date

        missed_punch_today = count_missed_punch_alerts_on_date(
            tenant_id=tenant_id, on_date=date.today(), conn=conn
        )

        from modules.documents.service import qualification_certificate_summary

        qualification_certs = qualification_certificate_summary(tenant_id=tenant_id, conn=conn)

    plan_flags = effective_features_for_tenant(
        plan_id=profile["subscription_plan"],
        payroll_enabled=bool(profile["payroll_enabled"]),
        sponsored_employees=sponsored_employees,
        subscription_status=profile.get("subscription_status"),
        trial_access_allowed=bool(trial.get("access_allowed")),
    )
    from plan_features import ROTA_MODE_LABELS, ROTA_MODES, UPGRADE_MESSAGES, apply_rota_features

    apply_rota_features(
        plan_flags,
        stored_mode=profile.get("rota_mode_preference"),
        rota_advanced_addon=bool(profile.get("rota_advanced_addon")),
        rota_multi_site_addon=bool(profile.get("rota_multi_site_addon")),
    )
    plan_flags["rota_mode_labels"] = ROTA_MODE_LABELS
    plan_flags["rota_modes_all"] = list(ROTA_MODES)
    plan_flags["upgrade_messages"] = UPGRADE_MESSAGES
    plan_flags["crm_addon"] = bool(profile.get("crm_addon"))

    rtw_needs_review = rtw_expired
    rtw_verified = max(rtw_total - rtw_expired - rtw_expiring_soon, 0)
    open_actions: list[dict[str, Any]] = []

    if day9_alerts:
        open_actions.append(
            {
                "severity": "critical",
                "title": f"{day9_alerts} day-9 absence alert{'s' if day9_alerts != 1 else ''}",
                "detail": "Sponsored worker absence requires Home Office reporting.",
                "href": "#compliance",
                "section": "compliance",
            }
        )
    if rtw_needs_review:
        open_actions.append(
            {
                "severity": "critical",
                "title": f"{rtw_needs_review} RTW check{'s' if rtw_needs_review != 1 else ''} need review",
                "detail": "Expired right to work documentation.",
                "href": "#compliance-rtw",
                "section": "compliance",
            }
        )
    if rtw_expiring_soon:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{rtw_expiring_soon} RTW expiring within 30 days",
                "detail": "Schedule reverification before expiry.",
                "href": "#compliance-rtw",
                "section": "compliance",
            }
        )
    if pending_leave_requests:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{pending_leave_requests} leave request{'s' if pending_leave_requests != 1 else ''} awaiting approval",
                "detail": "Review holiday and absence requests from staff.",
                "href": "#leave",
                "section": "leave",
            }
        )
    qual_alerts = qualification_certs.get("expired", 0) + qualification_certs.get("expiring_soon", 0)
    if qualification_certs.get("expired"):
        open_actions.append(
            {
                "severity": "critical",
                "title": f"{qualification_certs['expired']} expired training certificate{'s' if qualification_certs['expired'] != 1 else ''}",
                "detail": "Upload renewed certificates in employee Document store (Qualification category).",
                "href": "#employees",
                "section": "employees",
            }
        )
    elif qualification_certs.get("expiring_soon"):
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{qualification_certs['expiring_soon']} training certificate{'s' if qualification_certs['expiring_soon'] != 1 else ''} expiring within 30 days",
                "detail": "Check employee Document store — Qualification category with expiry dates.",
                "href": "#employees",
                "section": "employees",
            }
        )
    if not punch_sites:
        open_actions.append(
            {
                "severity": "warn",
                "title": "No punch sites configured",
                "detail": "Sync your business address to enable geofenced clock in/out.",
                "href": "#time-punch",
                "section": "time-punch",
            }
        )
    if rota_status != "published":
        open_actions.append(
            {
                "severity": "warn" if rota_shifts else "info",
                "title": "This week's rota not published" if rota_shifts else "No rota shifts this week",
                "detail": "Staff see shifts only after you publish the rota.",
                "href": "#rota",
                "section": "rota",
            }
        )
    if missed_punch_today:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{missed_punch_today} missed clock-in{'s' if missed_punch_today != 1 else ''} today",
                "detail": "Scheduled staff have not punched in within 15 minutes of shift start.",
                "href": "#rota",
                "section": "rota",
            }
        )
    if contracts_pending:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{contracts_pending} employment contract{'s' if contracts_pending != 1 else ''} awaiting signature",
                "detail": "Send or chase contract signatures from the employment contracts workspace.",
                "href": "#employment-contracts",
                "section": "employment-contracts",
            }
        )
    if open_disciplinary:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{open_disciplinary} open disciplinary case{'s' if open_disciplinary != 1 else ''}",
                "detail": "Review investigation progress and hearing outcomes.",
                "href": "#disciplinary",
                "section": "disciplinary",
            }
        )
    if open_grievances:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{open_grievances} open grievance case{'s' if open_grievances != 1 else ''}",
                "detail": "Review investigation progress and ACAS deadlines.",
                "href": "#grievance",
                "section": "grievance",
            }
        )
    if offboarding_in_progress:
        open_actions.append(
            {
                "severity": "info",
                "title": f"{offboarding_in_progress} offboarding in progress",
                "detail": "Complete ACAS appeal window and sponsor cessation steps.",
                "href": "#offboarding",
                "section": "offboarding",
            }
        )
    if open_vacancies:
        open_actions.append(
            {
                "severity": "info",
                "title": f"{open_vacancies} open vacanc{'ies' if open_vacancies != 1 else 'y'}",
                "detail": f"{pending_applicants} applicant{'s' if pending_applicants != 1 else ''} awaiting screening."
                if pending_applicants
                else "No pending applicants.",
                "href": "#recruitment",
                "section": "recruitment",
            }
        )
    if onboarding_employees:
        open_actions.append(
            {
                "severity": "info",
                "title": f"{onboarding_employees} employee{'s' if onboarding_employees != 1 else ''} onboarding",
                "detail": "Complete lifecycle steps before marking active.",
                "href": "#employees",
                "section": "employees",
            }
        )

    from modules.employees.portal_invites import count_pending_portal_setups

    portal_setup_pending = count_pending_portal_setups(tenant_id=tenant_id, conn=conn)
    if portal_setup_pending:
        open_actions.append(
            {
                "severity": "warn",
                "title": f"{portal_setup_pending} employee portal setup{'s' if portal_setup_pending != 1 else ''} pending",
                "detail": "Invited employees have not set their portal password yet. Ask them to check junk mail or resend the link.",
                "href": "#employees/portal-pending",
                "section": "employees",
            }
        )

    severity_rank = {"critical": 0, "warn": 1, "info": 2}
    open_actions.sort(key=lambda item: severity_rank.get(item["severity"], 9))

    return {
        "tenant_name": profile["name"],
        "trading_name": profile.get("trading_name"),
        "subscription_plan": profile["subscription_plan"],
        "plan_display_name": plan_display_name(profile["subscription_plan"]),
        "subscription_status": profile["subscription_status"],
        "max_employees": profile["max_employees"],
        "active_employees": active_employees,
        "document_count": document_count,
        "payroll_plan_id": profile["payroll_plan_id"],
        "trial_active": bool(plan_flags.get("trial_active")),
        "days_remaining": trial.get("days_remaining"),
        "rota_week_start_day": rota_week_start_day,
        "rota_week_start_day_name": rota_service.WEEKDAY_NAMES[rota_week_start_day],
        "holds_sponsor_licence": bool(profile.get("holds_sponsor_licence")),
        "sponsor_licence_acknowledged": bool(profile.get("sponsor_licence_acknowledged")),
        "open_actions_count": len(open_actions),
        "open_actions": open_actions[:8],
        "modules": {
            "employees": {
                "active": active_employees,
                "onboarding": onboarding_employees,
                "portal_setup_pending": portal_setup_pending,
                "limit": profile["max_employees"],
            },
            "recruitment": {
                "open_vacancies": open_vacancies,
                "pending_applicants": pending_applicants,
            },
            "rtw": {
                "total": rtw_total,
                "verified": rtw_verified,
                "expiring_soon": rtw_expiring_soon,
                "needs_review": rtw_needs_review,
            },
            "absence": {
                "day9_alerts": day9_alerts,
                "active_this_month": active_absences,
            },
            "time_punch": {
                "sites": punch_sites,
                "today_punches": today_punches,
                "last_punch_at": last_punch_at,
            },
            "rota": {
                "week_start": week_start.isoformat(),
                "status": rota_status or "none",
                "shift_count": rota_shifts,
            },
            "grievance": {"open_cases": open_grievances},
            "disciplinary": {"open_cases": open_disciplinary},
            "offboarding": {"in_progress": offboarding_in_progress},
            "contracts": {"pending_signature": contracts_pending},
            "documents": {"count": document_count},
            "leave": {"pending_requests": pending_leave_requests},
            "qualifications": qualification_certs,
        },
        "nav_badges": {
            "compliance": day9_alerts + rtw_expired + rtw_expiring_soon,
            "leave": pending_leave_requests,
            "disciplinary": open_disciplinary,
            "employees": qual_alerts,
        },
        **plan_flags,
    }
