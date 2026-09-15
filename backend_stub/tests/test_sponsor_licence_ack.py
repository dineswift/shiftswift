"""Tests for sponsor licence holder acknowledgement."""

from __future__ import annotations

import inspect
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sponsor_licence_ack import (  # noqa: E402
    SPONSOR_LICENCE_ACK_VERSION,
    acknowledge_sponsor_licence,
    assert_sponsor_licence_acknowledged,
    get_sponsor_licence_ack_status,
    signup_sponsor_licence_confirmed,
)


class _FakeCursor:
    def __init__(self, row: tuple | None) -> None:
        self.row = row
        self.commands: list[tuple] = []
        self.rowcount = 1

    def execute(self, sql, params=None):
        self.commands.append((sql.strip(), params))
        return self

    def fetchone(self):
        return self.row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self, row: tuple | None) -> None:
        self.row = row
        self.committed = False
        self.commands: list[tuple] = []

    def cursor(self):
        cursor = _FakeCursor(self.row)
        original_execute = cursor.execute

        def execute(sql, params=None):
            result = original_execute(sql, params)
            self.commands.append((sql.strip(), params))
            return result

        cursor.execute = execute  # type: ignore[method-assign]
        return cursor

    def commit(self):
        self.committed = True


class _SqlAwareCursor:
    def __init__(self, conn: "_SqlAwareConn") -> None:
        self.conn = conn
        self.row = None
        self.rowcount = 1

    def execute(self, sql, params=None):
        self.conn.commands.append((sql.strip(), params))
        lowered = sql.lower()
        if "tenant_signup_acceptances" in lowered:
            self.row = self.conn.signup_row
        elif "from tenants" in lowered or "update tenants" in lowered:
            self.row = self.conn.tenant_row
        else:
            self.row = None
        return self

    def fetchone(self):
        return self.row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _SqlAwareConn:
    def __init__(self, tenant_row: tuple | None, signup_row: tuple | None = None) -> None:
        self.tenant_row = tenant_row
        self.signup_row = signup_row
        self.committed = False
        self.commands: list[tuple] = []

    def cursor(self):
        return _SqlAwareCursor(self)

    def commit(self):
        self.committed = True


def test_get_status_when_not_acknowledged() -> None:
    conn = _FakeConn((False, None, None, None))
    status = get_sponsor_licence_ack_status(tenant_id=1, conn=conn)
    assert status["acknowledged"] is False
    assert status["holds_sponsor_licence"] is False
    assert status["current_ack_version"] == SPONSOR_LICENCE_ACK_VERSION
    assert "Those duties remain with our organisation" in status["ack_text"]
    assert len(status["duties"]) >= 5
    assert "SMS" in status["tools_notice"]


def test_get_status_when_acknowledged() -> None:
    ack_at = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
    conn = _FakeConn((True, ack_at, "hr@example.com", SPONSOR_LICENCE_ACK_VERSION))
    status = get_sponsor_licence_ack_status(tenant_id=1, conn=conn)
    assert status["acknowledged"] is True
    assert status["acknowledged_by"] == "hr@example.com"
    assert status["ack_version"] == SPONSOR_LICENCE_ACK_VERSION
    assert status["source"] == "tenant"


def test_assert_acknowledged_raises_when_missing() -> None:
    conn = _FakeConn((False, None, None, None))
    with pytest.raises(Exception) as exc:
        assert_sponsor_licence_acknowledged(tenant_id=1, conn=conn)
    assert exc.value.status_code == 403


def test_assert_acknowledged_passes_when_set() -> None:
    ack_at = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
    conn = _FakeConn((True, ack_at, "hr@example.com", SPONSOR_LICENCE_ACK_VERSION))
    assert_sponsor_licence_acknowledged(tenant_id=1, conn=conn)


def test_acknowledge_requires_holder_confirmation() -> None:
    conn = _FakeConn((False, None, None, None))
    with pytest.raises(Exception) as exc:
        acknowledge_sponsor_licence(
            tenant_id=1,
            acknowledged_by="hr@example.com",
            holds_sponsor_licence=False,
            conn=conn,
        )
    assert exc.value.status_code == 400


def test_acknowledge_updates_tenant() -> None:
    ack_at = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
    conn = _FakeConn((True, ack_at, "hr@example.com", SPONSOR_LICENCE_ACK_VERSION))
    result = acknowledge_sponsor_licence(
        tenant_id=1,
        acknowledged_by="hr@example.com",
        holds_sponsor_licence=True,
        conn=conn,
    )
    assert result["acknowledged"] is True
    assert conn.committed is True
    assert any("UPDATE tenants" in cmd[0] for cmd in conn.commands)


def test_signup_confirmation_is_not_enough_without_duty_box() -> None:
    conn = _SqlAwareConn((False, None, None, None), signup_row=(True, False))
    assert signup_sponsor_licence_confirmed(tenant_id=7, conn=conn) is False
    status = get_sponsor_licence_ack_status(tenant_id=7, conn=conn)
    assert status["acknowledged"] is False


def test_get_status_treats_signup_acceptance_as_acknowledged() -> None:
    conn = _SqlAwareConn((False, None, None, None), signup_row=(True, True))
    status = get_sponsor_licence_ack_status(tenant_id=7, conn=conn)
    assert status["acknowledged"] is True
    assert status["holds_sponsor_licence"] is True
    assert status["source"] == "signup"
    assert_sponsor_licence_acknowledged(tenant_id=7, conn=conn)


def test_try_else_commit_is_skipped_when_try_returns() -> None:
    """Regression: POST /acknowledgement used `return` in try and `commit` in else."""
    committed: list[bool] = []

    def broken_handler():
        try:
            return {"acknowledged": True}
        except LookupError:
            raise
        else:
            committed.append(True)

    broken_handler()
    assert committed == []

    committed.clear()

    def fixed_handler():
        try:
            result = {"acknowledged": True}
            committed.append(True)
            return result
        except LookupError:
            raise

    assert fixed_handler()["acknowledged"] is True
    assert committed == [True]


def test_acknowledge_route_commits_before_return() -> None:
    from compliance_routes import sponsor_licence_acknowledge

    src = inspect.getsource(sponsor_licence_acknowledge)
    assert "conn.commit()" in src
    assert "return acknowledge_sponsor_licence" not in src


def test_frontend_hides_duties_wall_when_already_acknowledged() -> None:
    src = (Path(__file__).resolve().parents[2] / "frontend" / "admin-compliance.js").read_text(
        encoding="utf-8"
    )
    assert "overviewAlreadyAcknowledged" in src
    assert "markOverviewAcknowledged" in src
    assert "applyAcknowledgedLayout(false)" in src
