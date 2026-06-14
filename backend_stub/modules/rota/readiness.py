"""Rota readiness checklist — tenant setup status for Settings."""

from __future__ import annotations

from typing import Any

from core.schema import table_columns
from plan_features import ROTA_MODE_LABELS


def _item(
    *,
    item_id: str,
    title: str,
    status: str,
    message: str,
    required: bool = True,
    action_text: str | None = None,
    action_href: str | None = None,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "title": title,
        "status": status,
        "message": message,
        "required": required,
        "action_text": action_text,
        "action_href": action_href,
    }


def _schema_ready(conn: Any) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if not table_columns(conn, "rota_weeks"):
        missing.append("rota tables (migration 042+)")
    tenant_cols = table_columns(conn, "tenants")
    if "rota_mode" not in tenant_cols:
        missing.append("rota mode (migration 068)")
    if "rota_advanced_addon" not in tenant_cols:
        missing.append("rota add-on flags (migration 070)")
    if not table_columns(conn, "rota_staffing_templates"):
        missing.append("staffing templates (migration 069)")
    emp_cols = table_columns(conn, "employees")
    if "contract_hours_weekly" not in emp_cols:
        missing.append("contract hours on employees (migration 069)")
    return (len(missing) == 0, missing)


def build_rota_readiness(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    from admin_service import get_tenant_profile
    from brand import EMAIL_SUPPORT

    profile = get_tenant_profile(tenant_id=tenant_id, conn=conn)
    mode = str(profile.get("rota_mode") or "basic")
    support_mail = f"mailto:{EMAIL_SUPPORT}"
    advanced_addon = bool(profile.get("rota_advanced_addon"))
    multi_site_addon = bool(profile.get("rota_multi_site_addon"))
    advanced_active = advanced_addon and mode in ("advanced", "multi_site")

    schema_ok, schema_missing = _schema_ready(conn)
    items: list[dict[str, Any]] = []

    if schema_ok:
        items.append(
            _item(
                item_id="database",
                title="Database migrations",
                status="ok",
                message="Rota tables and columns are present on this workspace.",
                required=True,
            )
        )
    else:
        items.append(
            _item(
                item_id="database",
                title="Database migrations",
                status="error",
                message="Missing: "
                + ", ".join(schema_missing)
                + ". Ask support to run migrations 042 and 068–070 on the server.",
                required=True,
                action_text="Email support",
                action_href=f"{support_mail}?subject=Rota%20migrations",
            )
        )

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM employees
            WHERE tenant_id = %s
              AND status IN ('active', 'onboarding', 'suspended')
            """,
            (tenant_id,),
        )
        roster_count = int(cur.fetchone()[0])

        explicit_hours_count = 0
        if "contract_hours_weekly" in table_columns(conn, "employees"):
            cur.execute(
                """
                SELECT COUNT(*)
                FROM employees
                WHERE tenant_id = %s
                  AND status IN ('active', 'onboarding', 'suspended')
                  AND contract_hours_weekly IS NOT NULL
                """,
                (tenant_id,),
            )
            explicit_hours_count = int(cur.fetchone()[0])

        template_count = 0
        if table_columns(conn, "rota_staffing_templates"):
            cur.execute(
                "SELECT COUNT(*) FROM rota_staffing_templates WHERE tenant_id = %s",
                (tenant_id,),
            )
            template_count = int(cur.fetchone()[0])

    if roster_count > 0:
        items.append(
            _item(
                item_id="active_staff",
                title="Staff on the rota",
                status="ok",
                message=f"{roster_count} active, onboarding, or suspended employee"
                f"{'' if roster_count == 1 else 's'} ready for scheduling.",
                required=True,
                action_text="Open Employees",
                action_href="#employees",
            )
        )
    else:
        items.append(
            _item(
                item_id="active_staff",
                title="Staff on the rota",
                status="error",
                message="No schedulable employees yet. Add team members before building a rota.",
                required=True,
                action_text="Add employees",
                action_href="#employees",
            )
        )

    items.append(
        _item(
            item_id="basic_builder",
            title="Basic rota builder",
            status="ok" if roster_count > 0 and schema_ok else "warn",
            message="Included on your plan: weekly grid, copy week, publish, and Time Clock visibility. "
            "On desktop, open Rota and use Grid view (drag to move shifts).",
            required=True,
            action_text="Open Rota",
            action_href="#rota",
        )
    )

    if advanced_addon:
        items.append(
            _item(
                item_id="advanced_addon",
                title="Advanced rota add-on",
                status="ok",
                message="Templates, coverage gaps, hours warnings, and generate draft are enabled for billing.",
                required=False,
            )
        )
    else:
        items.append(
            _item(
                item_id="advanced_addon",
                title="Advanced rota add-on",
                status="optional",
                message="Optional paid add-on for staffing templates, coverage gaps, hours warnings, and generate draft.",
                required=False,
                action_text="Request add-on",
                action_href=f"{support_mail}?subject=Advanced%20rota%20add-on",
            )
        )

    if advanced_addon:
        if mode in ("advanced", "multi_site"):
            label = ROTA_MODE_LABELS.get(mode, mode)
            items.append(
                _item(
                    item_id="scheduling_mode",
                    title="Scheduling mode",
                    status="ok",
                    message=f"Workspace is set to {label.split(' — ')[0]}.",
                    required=True,
                )
            )
        else:
            items.append(
                _item(
                    item_id="scheduling_mode",
                    title="Scheduling mode",
                    status="warn",
                    message="Advanced add-on is on, but scheduling mode is still Basic. "
                    "Switch to Advanced below to unlock templates and insights on the Rota page.",
                    required=True,
                )
            )

    if advanced_active:
        if template_count > 0:
            items.append(
                _item(
                    item_id="staffing_template",
                    title="Staffing template",
                    status="ok",
                    message=f"{template_count} template{'s' if template_count != 1 else ''} saved — "
                    "coverage gaps and generate draft can use them.",
                    required=True,
                )
            )
        else:
            items.append(
                _item(
                    item_id="staffing_template",
                    title="Staffing template",
                    status="warn",
                    message="Create at least one staffing template (slots per day/role) for coverage gaps and generate draft.",
                    required=True,
                    action_text="Add template below",
                    action_href="#settings-rota-templates-wrap",
                )
            )

        if roster_count == 0:
            pass
        elif explicit_hours_count >= roster_count:
            items.append(
                _item(
                    item_id="contract_hours",
                    title="Contract hours",
                    status="ok",
                    message="All schedulable staff have weekly contract hours set for hours warnings.",
                    required=False,
                    action_text="Review in Employees",
                    action_href="#employees",
                )
            )
        elif explicit_hours_count > 0:
            items.append(
                _item(
                    item_id="contract_hours",
                    title="Contract hours",
                    status="warn",
                    message=f"{explicit_hours_count} of {roster_count} staff have contract hours set. "
                    "Others use employment-type defaults (e.g. full-time 40h, part-time 20h).",
                    required=False,
                    action_text="Set on employee profiles",
                    action_href="#employees",
                )
            )
        else:
            items.append(
                _item(
                    item_id="contract_hours",
                    title="Contract hours",
                    status="warn",
                    message="No explicit contract hours yet — hours warnings use employment-type defaults. "
                    "Set contract hours on each employee's Onboarding step for accurate alerts.",
                    required=False,
                    action_text="Set on employee profiles",
                    action_href="#employees",
                )
            )

    if multi_site_addon and mode == "multi_site":
        items.append(
            _item(
                item_id="multi_site_ui",
                title="Multi-site rota",
                status="warn",
                message="Add-on is enabled, but per-location rota screens are not released yet. "
                "Use Advanced mode at one site for now.",
                required=False,
            )
        )

    required_items = [item for item in items if item["required"]]
    required_ok = all(item["status"] == "ok" for item in required_items)
    completed = sum(1 for item in required_items if item["status"] == "ok")

    return {
        "mode": mode,
        "rota_advanced_addon": advanced_addon,
        "rota_multi_site_addon": multi_site_addon,
        "advanced_active": advanced_active,
        "ready": required_ok,
        "summary": f"{completed} of {len(required_items)} required steps complete",
        "items": items,
    }
