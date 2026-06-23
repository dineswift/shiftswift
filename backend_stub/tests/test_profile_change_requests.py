"""Unit tests for employee profile change request workflows."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.employees.profile_change_requests import (
    _diff_changes,
    _snapshot_from_row,
    create_profile_change_request,
    review_profile_change_request,
)


def test_diff_changes_detects_phone_update() -> None:
    previous = {"phone": "07700 900000", "home_address": None}
    proposed = {"phone": "07700 900111", "home_address": None}
    changes = _diff_changes(previous=previous, proposed=proposed)
    assert len(changes) == 1
    assert changes[0]["field"] == "phone"
    assert changes[0]["old"] == "07700 900000"
    assert changes[0]["new"] == "07700 900111"


def test_create_profile_change_request_inserts_pending_row() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    employee_row = {
        "phone": "07700 900000",
        "home_address": "1 High Street",
        "emergency_contact_name": "Sam",
        "emergency_contact_phone": "07700 900111",
        "emergency_contact_relationship": "Partner",
        "status": "active",
    }
    cursor.fetchone.side_effect = [None, (7,)]
    cursor.fetchall.return_value = [
        (
            7,
            1,
            "Alex",
            "Smith",
            "pending",
            json.dumps({**employee_row, "phone": "07700 900222"}),
            json.dumps(_snapshot_from_row(employee_row)),
            None,
            None,
            None,
            None,
            None,
        )
    ]

    with patch(
        "modules.employees.service.get_employee_row",
        return_value=employee_row,
    ), patch(
        "modules.employees.profile_change_requests._notify_hr_new_request",
    ):
        item = create_profile_change_request(
            tenant_id=1,
            employee_id=1,
            updates={"phone": "07700 900222"},
            employee_note=None,
            conn=conn,
        )

    assert item["id"] == 7
    assert item["status"] == "pending"
    conn.commit.assert_called_once()


def test_review_profile_change_request_approves_and_applies() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    proposed = {
        "phone": "07700 900222",
        "home_address": "1 High Street",
        "emergency_contact_name": "Sam",
        "emergency_contact_phone": "07700 900111",
        "emergency_contact_relationship": "Partner",
    }
    old_row = {**proposed, "phone": "07700 900000"}
    new_row = {**proposed}
    cursor.fetchone.side_effect = [(1, "pending", proposed)]
    cursor.fetchall.return_value = [
        (
            7,
            1,
            "Alex",
            "Smith",
            "approved",
            json.dumps(proposed),
            json.dumps(_snapshot_from_row(old_row)),
            None,
            "hr.admin",
            None,
            None,
            None,
        )
    ]

    with patch(
        "modules.employees.service.get_employee_row",
        side_effect=[old_row, new_row],
    ), patch(
        "modules.employees.repository.update_employee_fields",
        return_value=new_row,
    ) as update_mock, patch(
        "modules.employees.service.after_employee_updated",
    ) as after_mock, patch(
        "modules.employees.profile_change_requests._notify_employee_decision",
    ):
        item = review_profile_change_request(
            tenant_id=1,
            request_id=7,
            decision="approved",
            reviewed_by="hr.admin",
            review_note="Thanks",
            conn=conn,
        )

    assert item["status"] == "approved"
    update_mock.assert_called_once()
    after_mock.assert_called_once()
    conn.commit.assert_called_once()
