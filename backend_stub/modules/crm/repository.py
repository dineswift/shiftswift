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


def _search_term(q: str | None) -> str | None:
    cleaned = (q or "").strip()
    return f"%{cleaned}%" if cleaned else None


def list_deals(
    *,
    tenant_id: int,
    pipeline_id: int,
    conn: Any,
    q: str | None = None,
) -> list[dict[str, Any]]:
    filters = ["d.tenant_id = %s", "d.pipeline_id = %s"]
    params: list[Any] = [tenant_id, pipeline_id]
    term = _search_term(q)
    if term:
        filters.append(
            "(d.title ILIKE %s OR a.name ILIKE %s OR c.name ILIKE %s OR COALESCE(d.notes, '') ILIKE %s)"
        )
        params.extend([term, term, term, term])
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT d.id, d.stage_id, d.title, d.value_gbp, d.expected_close_date,
                   d.notes, d.owner_username, d.account_id, d.contact_id,
                   d.created_at, d.updated_at,
                   a.name, c.name
            FROM crm_deals d
            LEFT JOIN crm_accounts a ON a.id = d.account_id
            LEFT JOIN crm_contacts c ON c.id = d.contact_id
            WHERE {" AND ".join(filters)}
            ORDER BY d.updated_at DESC, d.id DESC
            """,
            params,
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


def _account_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
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


def list_accounts(*, tenant_id: int, conn: Any, q: str | None = None) -> list[dict[str, Any]]:
    filters = ["tenant_id = %s"]
    params: list[Any] = [tenant_id]
    term = _search_term(q)
    if term:
        filters.append(
            "(name ILIKE %s OR COALESCE(email, '') ILIKE %s OR COALESCE(phone, '') ILIKE %s OR COALESCE(website, '') ILIKE %s)"
        )
        params.extend([term, term, term, term])
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, email, phone, website, notes, owner_username, created_at, updated_at
            FROM crm_accounts
            WHERE {" AND ".join(filters)}
            ORDER BY updated_at DESC, id DESC
            """,
            params,
        )
        rows = cur.fetchall()
    return [_account_row(row) for row in rows]


def fetch_account(*, tenant_id: int, account_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, email, phone, website, notes, owner_username, created_at, updated_at
            FROM crm_accounts
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, account_id),
        )
        row = cur.fetchone()
    return _account_row(row) if row else None


def list_contacts(*, tenant_id: int, conn: Any, q: str | None = None) -> list[dict[str, Any]]:
    filters = ["c.tenant_id = %s"]
    params: list[Any] = [tenant_id]
    term = _search_term(q)
    if term:
        filters.append(
            "(c.name ILIKE %s OR COALESCE(c.email, '') ILIKE %s OR COALESCE(c.phone, '') ILIKE %s OR COALESCE(c.job_title, '') ILIKE %s OR COALESCE(a.name, '') ILIKE %s)"
        )
        params.extend([term, term, term, term, term])
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT c.id, c.account_id, c.name, c.email, c.phone, c.job_title, c.notes,
                   c.owner_username, c.created_at, c.updated_at, a.name
            FROM crm_contacts c
            LEFT JOIN crm_accounts a ON a.id = c.account_id
            WHERE {" AND ".join(filters)}
            ORDER BY c.updated_at DESC, c.id DESC
            """,
            params,
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


def _contact_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
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


def fetch_contact(*, tenant_id: int, contact_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.account_id, c.name, c.email, c.phone, c.job_title, c.notes,
                   c.owner_username, c.created_at, c.updated_at, a.name
            FROM crm_contacts c
            LEFT JOIN crm_accounts a ON a.id = c.account_id
            WHERE c.tenant_id = %s AND c.id = %s
            """,
            (tenant_id, contact_id),
        )
        row = cur.fetchone()
    return _contact_row(row) if row else None


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
    account = fetch_account(tenant_id=tenant_id, account_id=account_id, conn=conn)
    if not account:
        raise LookupError("account not found")
    return account


def update_account(
    *,
    tenant_id: int,
    account_id: int,
    updates: dict[str, Any],
    conn: Any,
) -> dict[str, Any] | None:
    allowed = {
        key: updates[key]
        for key in ("name", "email", "phone", "website", "notes", "owner_username")
        if key in updates
    }
    if not allowed:
        return fetch_account(tenant_id=tenant_id, account_id=account_id, conn=conn)
    sets = [f"{key} = %s" for key in allowed]
    sets.append("updated_at = NOW()")
    params = list(allowed.values()) + [tenant_id, account_id]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE crm_accounts
            SET {", ".join(sets)}
            WHERE tenant_id = %s AND id = %s
            """,
            params,
        )
        if cur.rowcount == 0:
            return None
    return fetch_account(tenant_id=tenant_id, account_id=account_id, conn=conn)


def delete_account(*, tenant_id: int, account_id: int, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM crm_accounts WHERE tenant_id = %s AND id = %s",
            (tenant_id, account_id),
        )
        return cur.rowcount > 0


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
    contact = fetch_contact(tenant_id=tenant_id, contact_id=contact_id, conn=conn)
    if not contact:
        raise LookupError("contact not found")
    return contact


def update_contact(
    *,
    tenant_id: int,
    contact_id: int,
    updates: dict[str, Any],
    conn: Any,
) -> dict[str, Any] | None:
    allowed = {
        key: updates[key]
        for key in ("name", "account_id", "email", "phone", "job_title", "notes", "owner_username")
        if key in updates
    }
    if not allowed:
        return fetch_contact(tenant_id=tenant_id, contact_id=contact_id, conn=conn)
    sets = [f"{key} = %s" for key in allowed]
    sets.append("updated_at = NOW()")
    params = list(allowed.values()) + [tenant_id, contact_id]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE crm_contacts
            SET {", ".join(sets)}
            WHERE tenant_id = %s AND id = %s
            """,
            params,
        )
        if cur.rowcount == 0:
            return None
    return fetch_contact(tenant_id=tenant_id, contact_id=contact_id, conn=conn)


def delete_contact(*, tenant_id: int, contact_id: int, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM crm_contacts WHERE tenant_id = %s AND id = %s",
            (tenant_id, contact_id),
        )
        return cur.rowcount > 0


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
    deal = fetch_deal(tenant_id=tenant_id, deal_id=deal_id, conn=conn)
    if not deal:
        raise LookupError("deal not found")
    return deal


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


def delete_deal(*, tenant_id: int, deal_id: int, conn: Any) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM crm_deals WHERE tenant_id = %s AND id = %s",
            (tenant_id, deal_id),
        )
        return cur.rowcount > 0


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


def _activity_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "activity_type": row[1],
        "subject": row[2],
        "body": row[3],
        "activity_at": _iso(row[4]),
        "created_by": row[5],
        "created_at": _iso(row[6]),
        "deal_id": row[7] if len(row) > 7 else None,
        "deal_title": row[8] if len(row) > 8 else None,
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
    return [_activity_row(row) for row in rows]


def list_entity_activities(
    *,
    tenant_id: int,
    conn: Any,
    account_id: int | None = None,
    contact_id: int | None = None,
) -> list[dict[str, Any]]:
    filters = ["a.tenant_id = %s"]
    params: list[Any] = [tenant_id]
    if account_id is not None:
        filters.append(
            "(a.account_id = %s OR d.account_id = %s)"
        )
        params.extend([account_id, account_id])
    elif contact_id is not None:
        filters.append(
            "(a.contact_id = %s OR d.contact_id = %s)"
        )
        params.extend([contact_id, contact_id])
    else:
        return []
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT a.id, a.activity_type, a.subject, a.body, a.activity_at, a.created_by, a.created_at,
                   a.deal_id, d.title
            FROM crm_activities a
            LEFT JOIN crm_deals d ON d.id = a.deal_id
            WHERE {" AND ".join(filters)}
            ORDER BY a.activity_at DESC, a.id DESC
            LIMIT 50
            """,
            params,
        )
        rows = cur.fetchall()
    return [_activity_row(row) for row in rows]


def list_deals_for_account(*, tenant_id: int, account_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.title, d.value_gbp, d.expected_close_date, d.updated_at,
                   s.label, c.name
            FROM crm_deals d
            LEFT JOIN crm_deal_stages s ON s.id = d.stage_id
            LEFT JOIN crm_contacts c ON c.id = d.contact_id
            WHERE d.tenant_id = %s AND d.account_id = %s
            ORDER BY d.updated_at DESC
            LIMIT 20
            """,
            (tenant_id, account_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "title": row[1],
            "value_gbp": _money(row[2]),
            "expected_close_date": _iso(row[3]),
            "updated_at": _iso(row[4]),
            "stage_label": row[5],
            "contact_name": row[6],
        }
        for row in rows
    ]


def list_deals_for_contact(*, tenant_id: int, contact_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.title, d.value_gbp, d.expected_close_date, d.updated_at,
                   s.label, a.name
            FROM crm_deals d
            LEFT JOIN crm_deal_stages s ON s.id = d.stage_id
            LEFT JOIN crm_accounts a ON a.id = d.account_id
            WHERE d.tenant_id = %s AND d.contact_id = %s
            ORDER BY d.updated_at DESC
            LIMIT 20
            """,
            (tenant_id, contact_id),
        )
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "title": row[1],
            "value_gbp": _money(row[2]),
            "expected_close_date": _iso(row[3]),
            "updated_at": _iso(row[4]),
            "stage_label": row[5],
            "account_name": row[6],
        }
        for row in rows
    ]


def create_activity(
    *,
    tenant_id: int,
    deal_id: int | None,
    activity_type: str,
    subject: str | None,
    body: str | None,
    created_by: str | None,
    account_id: int | None = None,
    contact_id: int | None = None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_activities (
              tenant_id, deal_id, account_id, contact_id, activity_type, subject, body, created_by
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, activity_type, subject, body, activity_at, created_by, created_at
            """,
            (tenant_id, deal_id, account_id, contact_id, activity_type, subject, body, created_by),
        )
        row = cur.fetchone()
    return _activity_row(row)


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


def _document_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "title": row[1],
        "original_filename": row[2],
        "content_type": row[3],
        "file_size_bytes": int(row[4] or 0),
        "uploaded_by": row[5],
        "created_at": _iso(row[6]),
        "account_id": row[7] if len(row) > 7 else None,
        "contact_id": row[8] if len(row) > 8 else None,
        "deal_id": row[9] if len(row) > 9 else None,
    }


def list_documents(
    *,
    tenant_id: int,
    conn: Any,
    account_id: int | None = None,
    contact_id: int | None = None,
    deal_id: int | None = None,
) -> list[dict[str, Any]]:
    filters = ["tenant_id = %s"]
    params: list[Any] = [tenant_id]
    if account_id is not None:
        filters.append("account_id = %s")
        params.append(account_id)
    elif contact_id is not None:
        filters.append("contact_id = %s")
        params.append(contact_id)
    elif deal_id is not None:
        filters.append("deal_id = %s")
        params.append(deal_id)
    else:
        return []
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, title, original_filename, content_type, file_size_bytes,
                   uploaded_by, created_at, account_id, contact_id, deal_id
            FROM crm_documents
            WHERE {" AND ".join(filters)}
            ORDER BY created_at DESC, id DESC
            """,
            params,
        )
        rows = cur.fetchall()
    return [_document_row(row) for row in rows]


def fetch_document(*, tenant_id: int, document_id: int, conn: Any) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, original_filename, content_type, file_size_bytes,
                   uploaded_by, created_at, account_id, contact_id, deal_id,
                   storage_path
            FROM crm_documents
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, document_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    item = _document_row(row[:10])
    item["storage_path"] = row[10]
    return item


def create_document_record(
    *,
    tenant_id: int,
    title: str,
    original_filename: str | None,
    storage_path: str,
    content_type: str | None,
    file_size_bytes: int,
    content_sha256: str,
    uploaded_by: str | None,
    account_id: int | None = None,
    contact_id: int | None = None,
    deal_id: int | None = None,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crm_documents (
              tenant_id, account_id, contact_id, deal_id, title, original_filename,
              storage_path, content_type, file_size_bytes, content_sha256, uploaded_by
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                tenant_id,
                account_id,
                contact_id,
                deal_id,
                title,
                original_filename,
                storage_path,
                content_type,
                file_size_bytes,
                content_sha256,
                uploaded_by,
            ),
        )
        document_id = int(cur.fetchone()[0])
    if account_id is not None:
        return list_documents(tenant_id=tenant_id, account_id=account_id, conn=conn)[0]
    if contact_id is not None:
        return list_documents(tenant_id=tenant_id, contact_id=contact_id, conn=conn)[0]
    return list_documents(tenant_id=tenant_id, deal_id=deal_id, conn=conn)[0]


def delete_document(*, tenant_id: int, document_id: int, conn: Any) -> dict[str, Any] | None:
    doc = fetch_document(tenant_id=tenant_id, document_id=document_id, conn=conn)
    if not doc:
        return None
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM crm_documents WHERE tenant_id = %s AND id = %s",
            (tenant_id, document_id),
        )
    return doc


def build_dashboard_stats(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(d.value_gbp), 0)
            FROM crm_deals d
            JOIN crm_deal_stages s ON s.id = d.stage_id
            WHERE d.tenant_id = %s AND s.is_won = FALSE AND s.is_lost = FALSE
            """,
            (tenant_id,),
        )
        open_pipeline_value = _money(cur.fetchone()[0]) or 0.0
        cur.execute(
            """
            SELECT COALESCE(SUM(d.value_gbp), 0)
            FROM crm_deals d
            JOIN crm_deal_stages s ON s.id = d.stage_id
            WHERE d.tenant_id = %s AND s.is_won = TRUE
            """,
            (tenant_id,),
        )
        won_pipeline_value = _money(cur.fetchone()[0]) or 0.0
        cur.execute(
            """
            SELECT s.label, COUNT(d.id)
            FROM crm_deal_stages s
            LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.tenant_id = %s
            WHERE s.tenant_id = %s
            GROUP BY s.id, s.sort_order, s.label
            ORDER BY s.sort_order ASC, s.id ASC
            """,
            (tenant_id, tenant_id),
        )
        stage_counts = [{"label": label, "count": int(count)} for label, count in cur.fetchall()]
        cur.execute(
            """
            SELECT COUNT(*) FROM crm_activities
            WHERE tenant_id = %s AND activity_at >= NOW() - INTERVAL '7 days'
            """,
            (tenant_id,),
        )
        activities_last_7_days = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM crm_documents WHERE tenant_id = %s", (tenant_id,))
        documents = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM crm_deals d
            JOIN crm_deal_stages s ON s.id = d.stage_id
            WHERE d.tenant_id = %s AND s.is_lost = TRUE
            """,
            (tenant_id,),
        )
        deals_lost = int(cur.fetchone()[0])
    summary = count_summary(tenant_id=tenant_id, conn=conn)
    open_deals = summary["deals"] - summary["deals_won"] - deals_lost
    return {
        **summary,
        "open_deals": max(open_deals, 0),
        "deals_lost": deals_lost,
        "open_pipeline_value_gbp": open_pipeline_value,
        "won_pipeline_value_gbp": won_pipeline_value,
        "stage_counts": stage_counts,
        "activities_last_7_days": activities_last_7_days,
        "documents": documents,
    }
