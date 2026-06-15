"""CRM CSV export."""

from __future__ import annotations

import csv
import io
from typing import Any


def _iso(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def build_accounts_csv(items: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["name", "email", "phone", "website", "notes", "owner_email"])
    for row in items:
        writer.writerow(
            [
                row.get("name") or "",
                row.get("email") or "",
                row.get("phone") or "",
                row.get("website") or "",
                (row.get("notes") or "").replace("\n", " "),
                row.get("owner_username") or "",
            ]
        )
    return buffer.getvalue()


def build_contacts_csv(items: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["name", "email", "phone", "job_title", "company", "notes", "owner_email"])
    for row in items:
        writer.writerow(
            [
                row.get("name") or "",
                row.get("email") or "",
                row.get("phone") or "",
                row.get("job_title") or "",
                row.get("account_name") or "",
                (row.get("notes") or "").replace("\n", " "),
                row.get("owner_username") or "",
            ]
        )
    return buffer.getvalue()


def build_deals_csv(*, deals: list[dict[str, Any]], stage_labels: dict[int, str]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "title",
            "stage",
            "company",
            "contact",
            "value_gbp",
            "expected_close_date",
            "notes",
            "owner_email",
        ]
    )
    for row in deals:
        writer.writerow(
            [
                row.get("title") or "",
                stage_labels.get(row.get("stage_id"), ""),
                row.get("account_name") or "",
                row.get("contact_name") or "",
                row.get("value_gbp") if row.get("value_gbp") is not None else "",
                _iso(row.get("expected_close_date")),
                (row.get("notes") or "").replace("\n", " "),
                row.get("owner_username") or "",
            ]
        )
    return buffer.getvalue()
