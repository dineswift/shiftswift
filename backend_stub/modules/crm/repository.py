"""CRM persistence — tenant-scoped accounts, contacts, deals, activities."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _money(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def fetch_default_pipeline(*, tenant_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, is_default, created_at, updated_at
            FROM crm_pipelines
            WHERE tenant_id = %s AND is_default = TRUE
            LIMIT 1
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "name": row[1],
        "is_default": bool(row[2]),
        "created_at": _iso(row[3]),
        "updated_at": _iso(row[4]),
    }


def list_stages(*, tenant_id: int, pipeline_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, stage_key, label, sort_order, is_won, is_lost
            FROM crm_deal_stages
            WHERE tenant_id = %s AND pipeline_id = %s
            ORDER BY sort_order ASC, id ASC
            """,
            (tenant_id, pipeline_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "stage_key": row[1],
            "label": row[2],
            "sort_order": row[3],
            "is_won": bool(row[4]),
            "is_lost": bool(row[5]),
        }
        for row in rows
    ]


def list_deals(*, tenant_id: int, pipeline_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.stage_id, d.title, d.value_gbp, d.expected_close_date,
                   d.notes, d.owner_username, d.account_id, d.contact_id,
                   d.created_at, d.updated_at,
                   a.name, c.name
            FROM crm_deals d
            LEFT JOIN crm_accounts a ON a.id = d.account_id
            LEFT JOIN crm_contacts c ON c.id = d.contact_id
            WHERE d.tenant_id = %s AND d.pipeline_id = %s
            ORDER BY d.updated_at DESC, d.id DESC
            """,
            (tenant_id, pipeline_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "stage_id": row[1],
            "title": row[2],
            "value_gbp": _money(row[3]),
            "expected_close_date": _iso(row[4]),
            "notes": row[5],
            "owner_username": row[6],
            "account_id": row[7],
            "contact_id": row[8],
            "created_at": _iso(row[9]),
            "updated_at": _iso(row[10]),
            "account_name": row[11],
            "contact_name": row[12],
        }
        for row in rows
    ]


def list_accounts(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, email, phone, website, notes, owner_username, created_at, updated_at
            FROM crm_accounts
            WHERE tenant_id = %s
            ORDER BY updated_at DESC, id DESC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "name": row[1],
            "email": row[2],
            "phone": row[3],
            "website": row[4],
            "notes": row[5],
            "owner_username": row[6],
            "created_at": _iso(row[7]),
            "updated_at": _iso(row[8]),
        }
        for row in rows
    ]


def list_contacts(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.account_id, c.name, c.email, c.phone, c.job_title, c.notes,
                   c.owner_username, c.created_at, c.updated_at, a.name
            FROM crm_contacts c
            LEFT JOIN crm_accounts a ON a.id = c.account_id
            WHERE c.tenant_id = %s
            ORDER BY c.updated_at DESC, c.id DESC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "account_id": row[1],
            "name": row[2],
            "email": row[3],
            "phone": row[4],
            "job_title": row[5],
            "notes": row[6],
            "owner_username": row[7],
            "created_at": _iso(row[8]),
            "updated_at": _iso(row[9]),
            "account_name": row[10],
        }
        for row in rows
    ]


def create_account(
    *,
    tenant_id: int,
    name: str,
    email: str | None,
    phone: str | None,
    website: str | None,
    notes: str | None,
    owner_username: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_accounts (
              tenant_id, name, email, phone, website, notes, owner_username
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (tenant_id, name, email, phone, website, notes, owner_username),
        )
        account_id = int(cur.fetchone()[0])
    items = list_accounts(tenant_id=tenant_id, conn=conn)
    return next(item for item in items if item["id"] == account_id)


def create_contact(
    *,
    tenant_id: int,
    name: str,
    account_id: int | None,
    email: str | None,
    phone: str | None,
    job_title: str | None,
    notes: str | None,
    owner_username: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_contacts (
              tenant_id, account_id, name, email, phone, job_title, notes, owner_username
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (tenant_id, account_id, name, email, phone, job_title, notes, owner_username),
        )
        contact_id = int(cur.fetchone()[0])
    items = list_contacts(tenant_id=tenant_id, conn=conn)
    return next(item for item in items if item["id"] == contact_id)


def create_deal(
    *,
    tenant_id: int,
    pipeline_id: int,
    stage_id: int,
    title: str,
    account_id: int | None,
    contact_id: int | None,
    value_gbp: float | None,
    expected_close_date: date | None,
    notes: str | None,
    owner_username: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_deals (
              tenant_id, pipeline_id, stage_id, account_id, contact_id, title,
              value_gbp, expected_close_date, notes, owner_username
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                tenant_id,
                pipeline_id,
                stage_id,
                account_id,
                contact_id,
                title,
                value_gbp,
                expected_close_date,
                notes,
                owner_username,
            ),
        )
        deal_id = int(cur.fetchone()[0])
    items = list_deals(tenant_id=tenant_id, pipeline_id=pipeline_id, conn=conn)
    return next(item for item in items if item["id"] == deal_id)


def update_deal(
    *,
    tenant_id: int,
    deal_id: int,
    updates: dict[str, Any],
    conn: Any,
) -> dict[str, Any] | None:
    allowed = {
        key: updates[key]
        for key in (
            "stage_id",
            "title",
            "account_id",
            "contact_id",
            "value_gbp",
            "expected_close_date",
            "notes",
            "owner_username",
        )
        if key in updates
    }
    if not allowed:
        return fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)

    sets = [f"{key} = %s" for key in allowed]
    sets.append("updated_at = NOW()")
    params = list(allowed.values()) + [tenant_id, deal_id]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE crm_deals
            SET {", ".join(sets)}
            WHERE tenant_id = %s AND id = %s
            RETURNING pipeline_id
            """,
            params,
        )
        row = cur.fetchone()
    if not row:
        return None
    return fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)


def fetch_deal(*, tenant_id: int, deal_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.pipeline_id, d.stage_id, d.title, d.value_gbp, d.expected_close_date,
                   d.notes, d.owner_username, d.account_id, d.contact_id,
                   d.created_at, d.updated_at, a.name, c.name
            FROM crm_deals d
            LEFT JOIN crm_accounts a ON a.id = d.account_id
            LEFT JOIN crm_contacts c ON c.id = d.contact_id
            WHERE d.tenant_id = %s AND d.id = %s
            """,
            (tenant_id, deal_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "pipeline_id": row[1],
        "stage_id": row[2],
        "title": row[3],
        "value_gbp": _money(row[4]),
        "expected_close_date": _iso(row[5]),
        "notes": row[6],
        "owner_username": row[7],
        "account_id": row[8],
        "contact_id": row[9],
        "created_at": _iso(row[10]),
        "updated_at": _iso(row[11]),
        "account_name": row[12],
        "contact_name": row[13],
    }


def list_activities(*, tenant_id: int, deal_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, activity_type, subject, body, activity_at, created_by, created_at
            FROM crm_activities
            WHERE tenant_id = %s AND deal_id = %s
            ORDER BY activity_at DESC, id DESC
            """,
            (tenant_id, deal_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "activity_type": row[1],
            "subject": row[2],
            "body": row[3],
            "activity_at": _iso(row[4]),
            "created_by": row[5],
            "created_at": _iso(row[6]),
        }
        for row in rows
    ]


def create_activity(
    *,
    tenant_id: int,
    deal_id: int,
    activity_type: str,
    subject: str | None,
    body: str | None,
    created_by: str | None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_activities (
              tenant_id, deal_id, activity_type, subject, body, created_by
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, activity_type, subject, body, activity_at, created_by, created_at
            """,
            (tenant_id, deal_id, activity_type, subject, body, created_by),
        )
        row = cur.fetchone()
    return {
        "id": row[0],
        "activity_type": row[1],
        "subject": row[2],
        "body": row[3],
        "activity_at": _iso(row[4]),
        "created_by": row[5],
        "created_at": _iso(row[6]),
    }


def count_summary(*, tenant_id: int, conn: Any) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM crm_accounts WHERE tenant_id = %s", (tenant_id,))
        accounts = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM crm_contacts WHERE tenant_id = %s", (tenant_id,))
        contacts = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM crm_deals WHERE tenant_id = %s", (tenant_id,))
        deals = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM crm_deals d
            JOIN crm_deal_stages s ON s.id = d.stage_id
            WHERE d.tenant_id = %s AND s.is_won = TRUE
            """,
            (tenant_id,),
        )
        won = int(cur.fetchone()[0])
    return {
        "accounts": accounts,
        "contacts": contacts,
        "deals": deals,
        "deals_won": won,
    }
