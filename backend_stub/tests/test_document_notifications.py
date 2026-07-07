"""Tests for document upload notification helpers."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.documents.notifications import (
    load_document_notification_targets,
    notify_document_recipients,
    parse_employee_id_list,
)


def test_parse_employee_id_list() -> None:
    assert parse_employee_id_list(None) is None
    assert parse_employee_id_list("") is None
    assert parse_employee_id_list("1, 2,3") == [1, 2, 3]


@patch(
    "modules.documents.notifications.notify_employee_document_shared",
    return_value={"employee_id": 1, "email_sent": True, "push_sent": 1},
)
def test_notify_document_recipients_counts_emails(mock_notify) -> None:
    conn = MagicMock()
    result = notify_document_recipients(
        tenant_id=1,
        employees=[
            {"id": 1, "first_name": "Alex", "last_name": "Smith", "email": "a@example.com"},
            {"id": 2, "first_name": "Sam", "last_name": "Patel", "email": "s@example.com"},
        ],
        document_id=10,
        document_scope="tenant",
        document_title="Handbook 2026",
        category="policy",
        pay_period=None,
        send_email=True,
        conn=conn,
        commit=False,
    )
    assert result["notified_count"] == 2
    assert result["emails_sent"] == 2
    assert result["emails_skipped"] == 0
    assert result["email_failures"] == []
    assert mock_notify.call_count == 2
    assert mock_notify.call_args.kwargs["document_scope"] == "tenant"


def test_load_document_notification_targets_selected_ids() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [
        (1, "Alex", "Smith", "alex@example.com", True, "active"),
    ]

    targets = load_document_notification_targets(
        tenant_id=1,
        employee_ids=[1, 2],
        conn=conn,
    )

    assert len(targets) == 1
    assert targets[0]["id"] == 1
    assert targets[0]["email"] == "alex@example.com"
