"""Offboarding workflow service tests."""

from __future__ import annotations

import pytest

from modules.offboarding.errors import ActiveWorkflowExistsError, WorkflowStateError
from modules.offboarding.service import cancel_workflow, complete_workflow, start_offboarding


def test_start_offboarding_blocks_duplicate_active(monkeypatch):
    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            if "FROM offboarding_workflows" in sql and "in_progress" in sql:
                self._row = (42,)
            elif "FROM employees" in sql:
                self._row = (False,)
            else:
                self._row = (1, "in_progress", None, False, None)

        def fetchone(self):
            return self._row

    class FakeConn:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            pass

    monkeypatch.setattr("modules.offboarding.service.emit_event", lambda **kwargs: None)

    with pytest.raises(ActiveWorkflowExistsError) as exc:
        start_offboarding(
            tenant_id=1,
            employee_id=5,
            reason="Resignation",
            grievance_case_id=None,
            actor_username="hr@test",
            actor_role="admin",
            conn=FakeConn(),
        )
    assert exc.value.workflow_id == 42
    assert exc.value.employee_id == 5


def test_complete_workflow_requires_cessation_when_sponsored(monkeypatch):
    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            if "FROM offboarding_workflows" in sql and "WHERE tenant_id" in sql:
                self._row = (1, 5, "in_progress", True, None, None)
            else:
                self._row = None

        def fetchone(self):
            return self._row

    class FakeConn:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            pass

    with pytest.raises(WorkflowStateError, match="cessation"):
        complete_workflow(
            tenant_id=1,
            workflow_id=1,
            actor_username="hr@test",
            actor_role="admin",
            conn=FakeConn(),
        )


def test_cancel_workflow_only_in_progress():
    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, sql, params=None):
            if "FROM offboarding_workflows" in sql and "WHERE tenant_id" in sql:
                self._row = (1, 5, "completed", False, None, None)
            else:
                self._row = None

        def fetchone(self):
            return self._row

    class FakeConn:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            pass

    with pytest.raises(WorkflowStateError, match="cancel"):
        cancel_workflow(
            tenant_id=1,
            workflow_id=1,
            reason="Duplicate",
            actor_username="hr@test",
            actor_role="admin",
            conn=FakeConn(),
        )
