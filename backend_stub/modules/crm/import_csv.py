"""CRM CSV import — companies and contacts."""

from __future__ import annotations

import csv
import io
from typing import Any


def _cell(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        for candidate, value in row.items():
            if candidate.strip().lower() == key.lower():
                cleaned = (value or "").strip()
                if cleaned:
                    return cleaned
    return ""


def parse_accounts_csv(raw: str) -> list[dict[str, str | None]]:
    reader = csv.DictReader(io.StringIO(raw))
    rows: list[dict[str, str | None]] = []
    for row in reader:
        name = _cell(row, "name", "company", "company_name")
        if not name:
            continue
        rows.append(
            {
                "name": name,
                "email": _cell(row, "email") or None,
                "phone": _cell(row, "phone") or None,
                "website": _cell(row, "website", "url") or None,
                "notes": _cell(row, "notes") or None,
            }
        )
    return rows


def parse_contacts_csv(raw: str) -> list[dict[str, str | None]]:
    reader = csv.DictReader(io.StringIO(raw))
    rows: list[dict[str, str | None]] = []
    for row in reader:
        name = _cell(row, "name", "contact_name")
        if not name:
            continue
        rows.append(
            {
                "name": name,
                "email": _cell(row, "email") or None,
                "phone": _cell(row, "phone") or None,
                "job_title": _cell(row, "job_title", "title", "role") or None,
                "company": _cell(row, "company", "account", "company_name") or None,
                "notes": _cell(row, "notes") or None,
            }
        )
    return rows


def import_accounts(
    *,
    tenant_id: int,
    rows: list[dict[str, str | None]],
    owner_username: str | None,
    conn: Any,
) -> dict[str, Any]:
    from modules.crm import repository

    imported = 0
    skipped = 0
    errors: list[str] = []
    for index, row in enumerate(rows, start=2):
        try:
            repository.create_account(
                tenant_id=tenant_id,
                name=str(row["name"]),
                email=row.get("email"),
                phone=row.get("phone"),
                website=row.get("website"),
                notes=row.get("notes"),
                owner_username=owner_username,
                conn=conn,
            )
            imported += 1
        except Exception as exc:  # noqa: BLE001 — report row-level import failures
            skipped += 1
            errors.append(f"Row {index}: {exc}")
    return {"imported": imported, "skipped": skipped, "errors": errors[:20]}


def import_contacts(
    *,
    tenant_id: int,
    rows: list[dict[str, str | None]],
    owner_username: str | None,
    conn: Any,
) -> dict[str, Any]:
    from modules.crm import repository

    accounts = {
        (item["name"] or "").strip().lower(): item["id"]
        for item in repository.list_accounts(tenant_id=tenant_id, conn=conn)
    }
    imported = 0
    skipped = 0
    errors: list[str] = []
    for index, row in enumerate(rows, start=2):
        company = (row.get("company") or "").strip().lower()
        account_id = accounts.get(company) if company else None
        if company and account_id is None:
            skipped += 1
            errors.append(f"Row {index}: company '{row.get('company')}' not found — import companies first")
            continue
        try:
            repository.create_contact(
                tenant_id=tenant_id,
                name=str(row["name"]),
                account_id=account_id,
                email=row.get("email"),
                phone=row.get("phone"),
                job_title=row.get("job_title"),
                notes=row.get("notes"),
                owner_username=owner_username,
                conn=conn,
            )
            imported += 1
        except Exception as exc:  # noqa: BLE001
            skipped += 1
            errors.append(f"Row {index}: {exc}")
    return {"imported": imported, "skipped": skipped, "errors": errors[:20]}
