"""Platform master dashboard — tenant register, MRR, and tenant detail."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from billing_plans import get_plan
from billing_pricing import calculate_monthly_quote, estimate_monthly_total
from plan_features import effective_features_for_tenant, plan_display_name, plan_tier
from trial_service import ACTIVE_STATUSES, TRIALING_STATUSES, days_until_trial_end

DisplayStatus = Literal["trialing", "active", "overdue", "cancelled", "suspended", "deleted"]
FilterStatus = Literal["all", "trialing", "active", "overdue", "cancelled", "suspended", "deleted"]

ACTIVE_EMPLOYEE_STATUSES = ("active", "onboarding", "suspended")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def display_status(
    *,
    subscription_status: str | None,
    license_state: str | None = None,
    payment_failed_at: datetime | None = None,
    platform_status: str | None = None,
    deleted_at: datetime | None = None,
) -> DisplayStatus:
    if deleted_at is not None:
        return "deleted"
    if (platform_status or "active").strip().lower() == "suspended":
        return "suspended"
    status = (subscription_status or "").strip().lower()
    license = (license_state or "active").strip().lower()
    if status in {"cancelled"}:
        return "cancelled"
    if status in {"past_due", "unpaid", "payment_hold", "trial_expired"}:
        return "overdue"
    if payment_failed_at is not None or license == "hold":
        return "overdue"
    if status in TRIALING_STATUSES:
        return "trialing"
    if status in ACTIVE_STATUSES:
        return "active"
    return "trialing"


def delete_eligibility(
    *,
    subscription_status: str | None,
    platform_status: str | None,
    deleted_at: datetime | None = None,
    license_state: str | None = None,
    payment_failed_at: datetime | None = None,
) -> tuple[bool, str | None]:
    """Paying tenants must be platform-suspended before soft delete."""
    if deleted_at:
        return False, "Tenant is already deleted"
    platform = (platform_status or "active").strip().lower()
    if platform == "suspended":
        return True, None
    billing_status = display_status(
        subscription_status=subscription_status,
        license_state=license_state,
        payment_failed_at=payment_failed_at,
        platform_status=platform_status,
        deleted_at=deleted_at,
    )
    if billing_status in ("active", "overdue"):
        return False, "Suspend this paying account before deleting it."
    return True, None


def _is_test_tenant(name: str | None, billing_email: str | None) -> bool:
    email = (billing_email or "").strip().lower()
    if email.endswith("@example.com") or email.endswith("@test.com") or "+test@" in email:
        return True
    label = (name or "").strip().lower()
    if not label:
        return False
    if label.startswith("test ") or label in {"test", "test co", "test co ltd", "test company"}:
        return True
    return "test co" in label or label.endswith(" (test)")


def _staff_label(
    *,
    active_count: int,
    staff_limit: int,
    hr_login_email: str | None,
    hr_last_login: datetime | None,
) -> str:
    if not (hr_login_email or "").strip():
        return "no HR user yet"
    if not hr_last_login:
        return "no HR login yet"
    if staff_limit:
        return f"{active_count} of {staff_limit}"
    return str(active_count)


def _format_last_active(last_login: datetime | None, *, as_of: datetime | None = None) -> dict[str, Any]:
    if not last_login:
        return {"label": "Never", "tone": "muted", "days_ago": None}
    now = as_of or _utcnow()
    if last_login.tzinfo is None:
        last_login = last_login.replace(tzinfo=timezone.utc)
    delta = now - last_login
    days = delta.days
    if days <= 0 and delta.total_seconds() < 86400:
        time_label = last_login.astimezone(timezone.utc).strftime("%H:%M")
        return {"label": f"Today · {time_label}", "tone": "good", "days_ago": 0}
    if days == 1:
        return {"label": "Yesterday", "tone": "warn", "days_ago": 1}
    if days <= 7:
        return {"label": f"{days}d ago", "tone": "warn", "days_ago": days}
    return {"label": f"{days}d ago", "tone": "muted", "days_ago": days}


def _location_label(registered_address: str | None, trading_name: str | None, name: str) -> str:
    address = (registered_address or "").strip()
    if address:
        parts = [part.strip() for part in address.replace("\n", ",").split(",") if part.strip()]
        if len(parts) >= 2:
            return f"{parts[-2]}, {parts[-1]}"
        return parts[0]
    trading = (trading_name or "").strip()
    if trading and trading.lower() != name.lower():
        return trading
    return "United Kingdom"


def _tenant_mrr_gbp(
    *,
    plan_id: str | None,
    subscription_status: str | None,
    active_employees: int,
) -> float | None:
    status = display_status(subscription_status=subscription_status)
    if status not in {"active", "overdue"}:
        return None
    plan = get_plan(plan_id or "")
    if not plan:
        return None
    return round(estimate_monthly_total(plan, active_employees=active_employees), 2)


def _renewal_or_trial_label(
    *,
    subscription_status: str | None,
    trial_ends_at: datetime | None,
    as_of: datetime | None = None,
) -> str | None:
    status = display_status(subscription_status=subscription_status)
    if status == "trialing" and trial_ends_at:
        return trial_ends_at.date().isoformat()
    if status == "active":
        return None
    if trial_ends_at:
        return trial_ends_at.date().isoformat()
    return None


def _avg_trial_days_left(rows: list[dict[str, Any]]) -> int | None:
    values = [row["trial_days_remaining"] for row in rows if row.get("trial_days_remaining") is not None]
    if not values:
        return None
    return int(round(sum(values) / len(values)))


def _created_rank(value: str | datetime | None) -> float:
    if value is None:
        return 0.0
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return 0.0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _pick_canonical_tenant_id(tenants: list[dict[str, Any]]) -> int:
    """Prefer the tenant whose HR login matches billing email, then any HR login, then newest."""
    if not tenants:
        raise ValueError("No tenants to pick from")

    def sort_key(row: dict[str, Any]) -> tuple[int, int, float]:
        billing = (row.get("billing_email") or "").strip().lower()
        login = (row.get("hr_login_email") or "").strip().lower()
        email_match = 0 if billing and login and billing == login else 1
        has_login = 0 if login else 1
        return (email_match, has_login, -_created_rank(row.get("created_at")))

    return sorted(tenants, key=sort_key)[0]["id"]


def annotate_duplicate_billing_emails(tenants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mark duplicate trial workspaces that share the same billing email."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for tenant in tenants:
        email = (tenant.get("billing_email") or "").strip().lower()
        if not email:
            tenant["duplicate_billing_email"] = False
            tenant["is_canonical_tenant"] = True
            continue
        groups.setdefault(email, []).append(tenant)

    for group in groups.values():
        if len(group) == 1:
            group[0]["duplicate_billing_email"] = False
            group[0]["is_canonical_tenant"] = True
            continue
        keeper_id = _pick_canonical_tenant_id(group)
        for tenant in group:
            tenant["duplicate_billing_email"] = True
            tenant["is_canonical_tenant"] = tenant["id"] == keeper_id
    return tenants


def _serialize_tenant_row(row: tuple[Any, ...], *, as_of: datetime | None = None) -> dict[str, Any]:
    (
        tenant_id,
        name,
        trading_name,
        company_number,
        registered_address,
        phone,
        billing_email,
        subscription_plan,
        subscription_status,
        trial_ends_at,
        max_employees,
        license_state,
        payment_failed_at,
        holds_sponsor_licence,
        created_at,
        platform_status,
        deleted_at,
        internal_notes,
        billing_mode,
        billing_notes,
        active_employees,
        portal_pending,
        last_login,
        compliance_alerts,
        hr_login_email,
        hr_last_login,
    ) = row

    now = as_of or _utcnow()
    days_left = days_until_trial_end(trial_ends_at=trial_ends_at, as_of=now)
    status = display_status(
        subscription_status=subscription_status,
        license_state=license_state,
        payment_failed_at=payment_failed_at,
        platform_status=platform_status,
        deleted_at=deleted_at,
    )
    staff_limit = int(max_employees or 0)
    active_count = int(active_employees or 0)
    mrr = _tenant_mrr_gbp(
        plan_id=subscription_plan,
        subscription_status=subscription_status,
        active_employees=active_count,
    )
    last_active = _format_last_active(last_login, as_of=now)
    can_delete, delete_blocked_reason = delete_eligibility(
        subscription_status=subscription_status,
        platform_status=platform_status,
        deleted_at=deleted_at,
        license_state=license_state,
        payment_failed_at=payment_failed_at,
    )

    return {
        "id": int(tenant_id),
        "name": name or f"Tenant {tenant_id}",
        "location": _location_label(registered_address, trading_name, name or ""),
        "plan_id": subscription_plan,
        "plan_tier": plan_tier(subscription_plan),
        "plan_label": plan_display_name(subscription_plan),
        "status": status,
        "subscription_status": subscription_status,
        "trial_ends_at": trial_ends_at.isoformat() if isinstance(trial_ends_at, datetime) else trial_ends_at,
        "trial_days_remaining": max(days_left, 0) if days_left is not None and status == "trialing" else days_left,
        "renewal_or_trial_date": _renewal_or_trial_label(
            subscription_status=subscription_status,
            trial_ends_at=trial_ends_at,
            as_of=now,
        ),
        "employees_active": active_count,
        "employees_limit": staff_limit,
        "employees_pending_portal": int(portal_pending or 0),
        "staff_label": _staff_label(
            active_count=active_count,
            staff_limit=staff_limit,
            hr_login_email=hr_login_email,
            hr_last_login=hr_last_login,
        ),
        "mrr_gbp": mrr,
        "mrr_label": f"£{mrr:.0f}" if mrr is not None else "—",
        "last_active": last_active,
        "compliance_alerts": int(compliance_alerts or 0),
        "billing_email": billing_email,
        "hr_login_email": hr_login_email,
        "hr_last_login": hr_last_login.isoformat() if isinstance(hr_last_login, datetime) else hr_last_login,
        "hr_never_logged_in": bool((hr_login_email or "").strip() and not hr_last_login),
        "is_test_account": _is_test_tenant(name, billing_email),
        "company_number": company_number,
        "registered_address": registered_address,
        "phone": phone,
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        "platform_status": platform_status or "active",
        "deleted_at": deleted_at.isoformat() if isinstance(deleted_at, datetime) else deleted_at,
        "internal_notes": internal_notes or "",
        "billing_mode": billing_mode or "stripe",
        "billing_notes": billing_notes or "",
        "can_impersonate": deleted_at is None and (platform_status or "active") == "active",
        "can_delete": can_delete,
        "delete_blocked_reason": delete_blocked_reason,
    }


_TENANT_LIST_SQL = """
SELECT
  t.id,
  t.name,
  t.trading_name,
  t.company_number,
  t.registered_address,
  t.phone,
  t.billing_email,
  t.subscription_plan,
  t.subscription_status,
  t.trial_ends_at,
  t.max_employees,
  t.license_state,
  t.payment_failed_at,
  t.holds_sponsor_licence,
  t.created_at,
  t.platform_status,
  t.deleted_at,
  t.internal_notes,
  t.billing_mode,
  t.billing_notes,
  COALESCE(emp.active_count, 0) AS active_employees,
  COALESCE(emp.portal_pending, 0) AS portal_pending,
  login.last_login,
  COALESCE(comp.alert_count, 0) AS compliance_alerts,
  hr.hr_login_email,
  hr_login.hr_last_login
FROM tenants t
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE e.status IN ('active', 'onboarding', 'suspended')) AS active_count,
    COUNT(*) FILTER (
      WHERE e.status IN ('active', 'onboarding')
        AND NOT EXISTS (
          SELECT 1 FROM app_users u
          WHERE u.tenant_id = e.tenant_id
            AND u.role = 'employee'
            AND LOWER(u.username) = LOWER(COALESCE(e.email, ''))
        )
    ) AS portal_pending
  FROM employees e
  WHERE e.tenant_id = t.id
) emp ON TRUE
LEFT JOIN LATERAL (
  SELECT MAX(s.created_at) AS last_login
  FROM security_audit_events s
  WHERE s.tenant_id = t.id
    AND s.event_type = 'login_success'
    AND s.success = TRUE
) login ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS alert_count
  FROM right_to_work_checks rtw
  WHERE rtw.tenant_id = t.id
    AND rtw.expiry_date IS NOT NULL
    AND rtw.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
) comp ON TRUE
LEFT JOIN LATERAL (
  SELECT u.username AS hr_login_email
  FROM app_users u
  WHERE u.tenant_id = t.id
    AND u.role = 'hr'
    AND u.is_active = TRUE
  ORDER BY
    CASE WHEN lower(u.username) = lower(COALESCE(t.billing_email, '')) THEN 0 ELSE 1 END,
    u.updated_at DESC NULLS LAST
  LIMIT 1
) hr ON TRUE
LEFT JOIN LATERAL (
  SELECT MAX(s.created_at) AS hr_last_login
  FROM security_audit_events s
  INNER JOIN app_users u
    ON lower(u.username) = lower(s.username)
   AND u.tenant_id = t.id
   AND u.role = 'hr'
   AND u.is_active = TRUE
  WHERE s.tenant_id = t.id
    AND s.event_type = 'login_success'
    AND s.success = TRUE
    AND s.detail LIKE '%%portal=business%%'
) hr_login ON TRUE
WHERE t.id != %s
"""


def list_tenants(
    *,
    conn: Any,
    master_tenant_id: int,
    status_filter: FilterStatus = "all",
    search: str | None = None,
    include_deleted: bool = False,
    exclude_test: bool = False,
    as_of: datetime | None = None,
) -> list[dict[str, Any]]:
    sql = _TENANT_LIST_SQL
    if not include_deleted:
        sql += " AND t.deleted_at IS NULL"
    sql += " ORDER BY t.name ASC, t.id ASC"
    params: list[Any] = [master_tenant_id]

    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    tenants = [_serialize_tenant_row(row, as_of=as_of) for row in rows]

    if exclude_test:
        tenants = [row for row in tenants if not row.get("is_test_account")]

    if status_filter != "all":
        tenants = [row for row in tenants if row["status"] == status_filter]

    query = (search or "").strip().lower()
    if query:
        tenants = [
            row
            for row in tenants
            if query in row["name"].lower()
            or query in (row.get("billing_email") or "").lower()
            or query in (row.get("hr_login_email") or "").lower()
            or query in row["location"].lower()
            or query in (row.get("company_number") or "").lower()
            or query in str(row["id"])
        ]

    return annotate_duplicate_billing_emails(tenants)


def _trials_expiring_within(trialing: list[dict[str, Any]], days: int) -> int:
    return sum(
        1
        for tenant in trialing
        if tenant.get("trial_days_remaining") is not None and tenant["trial_days_remaining"] <= days
    )


def overview_stats(
    *,
    conn: Any,
    master_tenant_id: int,
    include_deleted: bool = False,
    exclude_test: bool = False,
    as_of: datetime | None = None,
) -> dict[str, Any]:
    tenants = list_tenants(
        conn=conn,
        master_tenant_id=master_tenant_id,
        include_deleted=include_deleted,
        exclude_test=exclude_test,
        as_of=as_of,
    )
    now = as_of or _utcnow()

    active = [t for t in tenants if t["status"] == "active"]
    trialing = [t for t in tenants if t["status"] == "trialing"]
    overdue = [t for t in tenants if t["status"] == "overdue"]
    cancelled = [t for t in tenants if t["status"] == "cancelled"]
    suspended = [t for t in tenants if t["status"] == "suspended"]
    deleted = [t for t in tenants if t["status"] == "deleted"]

    mrr = round(sum(t["mrr_gbp"] or 0 for t in tenants if t["mrr_gbp"] is not None), 2)

    churned_this_month = 0

    compliance_tenants = sum(1 for t in tenants if t["compliance_alerts"] > 0)
    never_logged_hr = sum(1 for t in tenants if t.get("hr_never_logged_in"))
    duplicate_trials = sum(
        1 for t in tenants if t.get("duplicate_billing_email") and not t.get("is_canonical_tenant")
    )
    test_accounts = sum(1 for t in tenants if t.get("is_test_account"))

    plan_breakdown: dict[str, dict[str, Any]] = {}
    for tenant in active + overdue:
        tier = tenant["plan_tier"]
        bucket = plan_breakdown.setdefault(
            tier,
            {"plan_tier": tier, "plan_label": tenant["plan_label"], "tenant_count": 0, "mrr_gbp": 0.0},
        )
        bucket["tenant_count"] += 1
        bucket["mrr_gbp"] = round(bucket["mrr_gbp"] + (tenant["mrr_gbp"] or 0), 2)

    return {
        "total_tenants": len(tenants),
        "active_paying": len(active),
        "trialing": len(trialing),
        "overdue": len(overdue),
        "cancelled": len(cancelled),
        "suspended": len(suspended),
        "deleted": len(deleted),
        "mrr_gbp": mrr,
        "arr_gbp": round(mrr * 12, 2),
        "mrr_added_this_month_gbp": None,
        "churned_this_month": churned_this_month,
        "compliance_alert_tenants": compliance_tenants,
        "payment_failures": len(overdue),
        "avg_trial_days_remaining": _avg_trial_days_left(trialing),
        "conversion_rate_pct": round(len(active) / len(tenants) * 100) if tenants else 0,
        "plan_breakdown": list(plan_breakdown.values()),
        "trials_expiring": {
            "7d": _trials_expiring_within(trialing, 7),
            "14d": _trials_expiring_within(trialing, 14),
            "30d": _trials_expiring_within(trialing, 30),
        },
        "trial_funnel": {
            "trialing": len(trialing),
            "active_paying": len(active),
            "never_logged_in_hr": never_logged_hr,
            "duplicate_trials": duplicate_trials,
        },
        "test_accounts": test_accounts,
        "reporting_month": now.strftime("%B %Y"),
        "mrr_note": "Estimated ex-VAT MRR (base + per active employee, plan cap applied). Not Stripe invoice totals.",
        "counts": {
            "all": len(tenants),
            "trialing": len(trialing),
            "active": len(active),
            "overdue": len(overdue),
            "cancelled": len(cancelled),
            "suspended": len(suspended),
            "deleted": len(deleted),
        },
    }


def _module_usage(cur: Any, tenant_id: int) -> list[dict[str, Any]]:
    checks = [
        ("Employees", "SELECT EXISTS(SELECT 1 FROM employees WHERE tenant_id = %s LIMIT 1)"),
        ("Compliance", "SELECT EXISTS(SELECT 1 FROM right_to_work_checks WHERE tenant_id = %s LIMIT 1)"),
        ("Rota", "SELECT EXISTS(SELECT 1 FROM rota_shifts WHERE tenant_id = %s LIMIT 1)"),
        ("Time punch", "SELECT EXISTS(SELECT 1 FROM punch_sites WHERE tenant_id = %s LIMIT 1)"),
        ("Recruitment", "SELECT EXISTS(SELECT 1 FROM recruitment_vacancies WHERE tenant_id = %s LIMIT 1)"),
        ("CRM", "SELECT EXISTS(SELECT 1 FROM crm_deals WHERE tenant_id = %s LIMIT 1)"),
        ("Documents", "SELECT EXISTS(SELECT 1 FROM tenant_documents WHERE tenant_id = %s LIMIT 1)"),
    ]
    modules: list[dict[str, Any]] = []
    for label, sql in checks:
        cur.execute(sql, (tenant_id,))
        active = bool(cur.fetchone()[0])
        modules.append({"label": label, "active": active})
    return modules


def get_tenant_detail(
    *,
    conn: Any,
    master_tenant_id: int,
    tenant_id: int,
    as_of: datetime | None = None,
) -> dict[str, Any] | None:
    from core.schema import column_expr

    crm_monthly_col = column_expr(
        conn,
        table="tenants",
        column="crm_addon_monthly_gbp",
        alias=None,
        null_sql="NULL::numeric AS crm_addon_monthly_gbp",
    )
    crm_notes_col = column_expr(
        conn,
        table="tenants",
        column="crm_addon_billing_notes",
        alias=None,
        null_sql="NULL AS crm_addon_billing_notes",
    )
    sql = _TENANT_LIST_SQL + " AND t.id = %s"
    with conn.cursor() as cur:
        cur.execute(sql, (master_tenant_id, tenant_id))
        row = cur.fetchone()
        if not row:
            return None

        cur.execute(
            f"""
            SELECT subscription_status, payroll_enabled, holds_sponsor_licence, trial_ends_at,
                   platform_status, deleted_at, internal_notes,
                   rota_advanced_addon, rota_multi_site_addon, rota_mode, crm_addon,
                   {crm_monthly_col}, {crm_notes_col}
            FROM tenants WHERE id = %s
            """,
            (tenant_id,),
        )
        meta = cur.fetchone()
        subscription_status = meta[0] if meta else None
        payroll_enabled = bool(meta[1]) if meta else False
        holds_sponsor = bool(meta[2]) if meta else False
        trial_ends_at = meta[3] if meta else None
        platform_status = meta[4] if meta else "active"
        deleted_at = meta[5] if meta else None
        internal_notes = meta[6] if meta else ""
        rota_advanced_addon = bool(meta[7]) if meta else False
        rota_multi_site_addon = bool(meta[8]) if meta else False
        rota_mode = meta[9] if meta else None
        crm_addon = bool(meta[10]) if meta else False
        crm_addon_monthly_gbp = float(meta[11]) if meta and meta[11] is not None else None
        crm_addon_billing_notes = meta[12] if meta else None

        trial_access = subscription_status in TRIALING_STATUSES
        features = effective_features_for_tenant(
            plan_id=row[7],
            payroll_enabled=payroll_enabled,
            subscription_status=subscription_status,
            trial_access_allowed=trial_access,
        )
        modules = _module_usage(cur, tenant_id)

        cur.execute(
            """
            SELECT event_type, username, created_at, detail
            FROM security_audit_events
            WHERE tenant_id = %s
            ORDER BY created_at DESC
            LIMIT 8
            """,
            (tenant_id,),
        )
        activity = [
            {
                "event_type": event_type,
                "username": username,
                "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
                "detail": detail,
            }
            for event_type, username, created_at, detail in cur.fetchall()
        ]

    tenant = _serialize_tenant_row(row, as_of=as_of)
    plan = get_plan(tenant["plan_id"] or "")
    quote = (
        calculate_monthly_quote(plan, active_employees=tenant["employees_active"])
        if plan
        else None
    )

    email = (tenant.get("billing_email") or "").strip().lower()
    if email:
        peer_group = [
            row
            for row in list_tenants(conn=conn, master_tenant_id=master_tenant_id, include_deleted=False)
            if (row.get("billing_email") or "").strip().lower() == email
        ]
        annotate_duplicate_billing_emails(peer_group)
        peer = next((row for row in peer_group if row["id"] == tenant_id), None)
        if peer:
            tenant["duplicate_billing_email"] = peer["duplicate_billing_email"]
            tenant["is_canonical_tenant"] = peer["is_canonical_tenant"]
    else:
        tenant["duplicate_billing_email"] = False
        tenant["is_canonical_tenant"] = True

    return {
        **tenant,
        "holds_sponsor_licence": holds_sponsor,
        "features": features,
        "modules": modules,
        "monthly_quote": quote,
        "recent_activity": activity,
        "internal_notes": internal_notes or "",
        "platform_status": platform_status or "active",
        "deleted_at": deleted_at.isoformat() if isinstance(deleted_at, datetime) else deleted_at,
        "can_impersonate": deleted_at is None and (platform_status or "active") == "active",
        "rota_advanced_addon": rota_advanced_addon,
        "rota_multi_site_addon": rota_multi_site_addon,
        "rota_mode": rota_mode,
        "crm_addon": crm_addon,
        "crm_addon_monthly_gbp": crm_addon_monthly_gbp,
        "crm_addon_billing_notes": crm_addon_billing_notes or "",
    }
