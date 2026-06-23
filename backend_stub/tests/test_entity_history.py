"""Tests for employee entity version history."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.employees.entity_history import _diff_fields, record_employee_version  # noqa: E402


def test_diff_fields_detects_changes() -> None:
    old = {"first_name": "Alex", "salary": 30000, "id": 1}
    new = {"first_name": "Alex", "salary": 32000, "id": 1}
    changes = _diff_fields(old, new)
    assert len(changes) == 1
    assert changes[0]["field"] == "salary"
    assert changes[0]["old"] == 30000
    assert changes[0]["new"] == 32000


@patch("employee_audit.log_employee_data_event")
def test_record_employee_version_inserts_snapshot(mock_audit) -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [(2,), (101,)]

    old = {"id": 1, "first_name": "Alex", "last_name": "Smith", "email": "a@test.com", "status": "active"}
    new = {**old, "job_title": "Chef"}

    version_id = record_employee_version(
        tenant_id=1,
        employee_id=1,
        old_row=old,
        new_row=new,
        changed_by="hr@test.com",
        changed_by_role="hr",
        conn=conn,
    )

    assert version_id == 101
    mock_audit.assert_called_once()
    insert_calls = [call for call in cursor.execute.call_args_list if "INSERT INTO entity_versions" in str(call)]
    assert insert_calls
    args = insert_calls[0][0][1]
    snapshot = json.loads(args[3])
    assert snapshot["job_title"] == "Chef"
