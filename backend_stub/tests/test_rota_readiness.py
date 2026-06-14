from __future__ import annotations

from unittest.mock import MagicMock, patch

from modules.rota.readiness import build_rota_readiness


def _schema_columns_side_effect(conn, table):
    _ = conn
    if table == "rota_weeks":
        return frozenset({"id"})
    if table == "tenants":
        return frozenset({"rota_mode", "rota_advanced_addon", "rota_multi_site_addon"})
    if table == "rota_staffing_templates":
        return frozenset({"id", "tenant_id"})
    if table == "employees":
        return frozenset({"contract_hours_weekly", "status"})
    return frozenset()


@patch("modules.rota.readiness.table_columns", side_effect=_schema_columns_side_effect)
@patch("admin_service.get_tenant_profile")
def test_readiness_basic_with_staff(mock_profile, _mock_cols) -> None:
    mock_profile.return_value = {
        "rota_mode": "basic",
        "rota_advanced_addon": False,
        "rota_multi_site_addon": False,
    }
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchone.side_effect = [(2,), (0,), (0,)]
    conn.cursor.return_value.__enter__.return_value = cur

    payload = build_rota_readiness(tenant_id=1, conn=conn)

    assert payload["mode"] == "basic"
    assert payload["ready"] is True
    assert any(item["id"] == "active_staff" and item["status"] == "ok" for item in payload["items"])


@patch("modules.rota.readiness.table_columns", side_effect=_schema_columns_side_effect)
@patch("admin_service.get_tenant_profile")
def test_readiness_advanced_needs_template(mock_profile, _mock_cols) -> None:
    mock_profile.return_value = {
        "rota_mode": "advanced",
        "rota_advanced_addon": True,
        "rota_multi_site_addon": False,
    }
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (0,), (0,)]
    conn.cursor.return_value.__enter__.return_value = cur

    payload = build_rota_readiness(tenant_id=1, conn=conn)

    assert payload["advanced_active"] is True
    assert payload["ready"] is False
    template_item = next(item for item in payload["items"] if item["id"] == "staffing_template")
    assert template_item["status"] == "warn"
