"""CRM add-on gate tests."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from modules.crm.service import require_crm_addon


def test_require_crm_addon_blocks_without_flag(monkeypatch):
    monkeypatch.setattr(
        "admin_service.get_tenant_profile",
        lambda **kwargs: {"crm_addon": False},
    )
    with pytest.raises(HTTPException) as exc:
        require_crm_addon(tenant_id=1, conn=object())
    assert exc.value.status_code == 403


def test_require_crm_addon_allows_when_enabled(monkeypatch):
    monkeypatch.setattr(
        "admin_service.get_tenant_profile",
        lambda **kwargs: {"crm_addon": True},
    )
    require_crm_addon(tenant_id=1, conn=object())
