"""Master can turn the sign-in code off. Apple review and demo businesses start off."""

import sys
from pathlib import Path
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from auth_policy import (
    account_skips_login_mfa,
    looks_like_demo_or_review,
    tenant_login_mfa_required,
)
from core.schema import clear_schema_cache


def test_demo_and_apple_review_are_recognised() -> None:
    assert looks_like_demo_or_review(billing_email="apple-review@shiftswifthr.co.uk")
    assert looks_like_demo_or_review(name="ShiftSwift HR Demo Tenant")
    assert looks_like_demo_or_review(username="demo.staff@example.com")
    assert not looks_like_demo_or_review(name="The Navigation Inn", billing_email="hr@thenavigationinn.co.uk")
    assert not looks_like_demo_or_review(name="Demolition Ltd")


def test_tenant_flag_defaults_on_and_can_be_off() -> None:
    clear_schema_cache()
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchall.return_value = [("login_mfa_required",)]
    cursor.fetchone.return_value = (True,)
    assert tenant_login_mfa_required(conn, 4) is True

    cursor.fetchone.return_value = (False,)
    assert tenant_login_mfa_required(conn, 4) is False
    assert account_skips_login_mfa(username="hr@example.com", tenant_id=4, conn=conn) is True
    clear_schema_cache()


def test_apple_review_skips_even_when_the_business_requires_a_code() -> None:
    conn = MagicMock()
    assert account_skips_login_mfa(
        username="apple-review@shiftswifthr.co.uk",
        tenant_id=4,
        conn=conn,
    )
