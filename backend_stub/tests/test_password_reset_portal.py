"""Password reset user lookup edge cases."""

from auth_password_reset import _find_business_user


class _Settings:
    use_db = False
    database_url = None


def test_find_business_user_allows_null_login_portal(monkeypatch) -> None:
    monkeypatch.setattr(
        "auth_password_reset.fetch_user_from_db",
        lambda settings, email: {
            "username": email,
            "role": "employee",
            "tenant_id": "1",
            "is_active": True,
            "login_portal": None,
        },
    )
    user = _find_business_user(_Settings(), email="employee@example.com", role_hint="employee")
    assert user is not None
    assert user["role"] == "employee"
