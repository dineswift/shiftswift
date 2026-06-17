"""Immutable employee data access audit trail for tribunal and GDPR evidence."""

from __future__ import annotations

from typing import Any


def log_employee_data_event(
    *,
    tenant_id: int,
    actor_username: str,
    actor_role: str,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    field_name: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    conn: Any,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO employee_data_audit_log (
              tenant_id, actor_username, actor_role, action, entity_type, entity_id,
              field_name, old_value, new_value, ip_address, user_agent
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                tenant_id,
                actor_username,
                actor_role,
                action,
                entity_type,
                entity_id,
                field_name,
                old_value,
                new_value,
                ip_address,
                user_agent,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        if row and row[0] is not None:
            return int(row[0])
        return 0
