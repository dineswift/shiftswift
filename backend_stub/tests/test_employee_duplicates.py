"""Duplicate employee detection — email and full name within a tenant."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from modules.employees.duplicates import (  # noqa: E402
    DuplicateEmployeeError,
    assert_no_duplicate_employee,
    normalize_name_part,
    normalize_work_email,
)


def test_normalize_work_email() -> None:
    assert normalize_work_email("  Foo@Bar.COM ") == "foo@bar.com"
    assert normalize_work_email("") is None
    assert normalize_work_email(None) is None


def test_normalize_name_part() -> None:
    assert normalize_name_part("  Karun  ") == "karun"
    assert normalize_name_part("") == ""


def test_assert_no_duplicate_allows_unique_employee() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [None, None]

    assert_no_duplicate_employee(
        tenant_id=1,
        conn=conn,
        first_name="Alex",
        last_name="Smith",
        email="alex@example.com",
    )


def test_assert_no_duplicate_blocks_email() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.return_value = (
        7,
        "Karun",
        "Acharya",
        "karun@example.com",
        "Tandoori Chef",
        "Kitchen",
        "active",
    )

    with pytest.raises(DuplicateEmployeeError, match="work email already exists") as exc:
        assert_no_duplicate_employee(
            tenant_id=1,
            conn=conn,
            first_name="Someone",
            last_name="Else",
            email="karun@example.com",
        )

    assert exc.value.conflict == "email"
    assert exc.value.existing_employee_id == 7


def test_assert_no_duplicate_blocks_name_when_email_clear() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [None, (3, "Radhika", "Bhusal", None, None, None, "onboarding")]

    with pytest.raises(DuplicateEmployeeError, match="already exists") as exc:
        assert_no_duplicate_employee(
            tenant_id=1,
            conn=conn,
            first_name="Radhika",
            last_name="Bhusal",
            email=None,
        )

    assert exc.value.conflict == "name"
    assert exc.value.existing_employee_id == 3


def test_assert_no_duplicate_excludes_self_on_update() -> None:
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [None, None]

    assert_no_duplicate_employee(
        tenant_id=1,
        conn=conn,
        first_name="Radhika",
        last_name="Bhusal",
        email="radhika@example.com",
        exclude_employee_id=3,
    )
