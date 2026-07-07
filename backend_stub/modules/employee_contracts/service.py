"""Employment contracts — generate from HR templates, send for signature, store on employee record."""

from __future__ import annotations

import hashlib
import html
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any

from modules.documents.service import create_employee_document
from modules.documents.storage import write_document_file
from modules.employees.repository import fetch_employee
from modules.hr_templates.service import get_template_content
from modules.hr_templates.versioning import version_lt

EMPLOYMENT_TYPE_LABELS = {
    "full_time": "Full time",
    "part_time": "Part time",
    "zero_hours": "Zero hours",
    "fixed_term": "Fixed term",
    "casual": "Casual",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str:
    if value is None:
        return "Not set"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _log_event(cur: Any, contract_id: int, tenant_id: int, event_type: str, actor: str | None, detail: str | None) -> None:
    cur.execute(
        """
        INSERT INTO employee_contract_events (contract_id, tenant_id, event_type, actor, detail)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (contract_id, tenant_id, event_type, actor, detail),
    )


def _contract_number(tenant_id: int, employee_id: int) -> str:
    stamp = _utcnow().strftime("%Y%m%d")
    return f"EMP-{tenant_id}-{employee_id}-{stamp}"


def _fetch_tenant_profile(cur: Any, tenant_id: int) -> dict[str, str]:
    cur.execute(
        """
        SELECT name, trading_name, company_number, registered_address, phone
        FROM tenants WHERE id = %s
        """,
        (tenant_id,),
    )
    row = cur.fetchone()
    if not row:
        return {}
    return {
        "employer_legal_name": row[0] or "Not set",
        "employer_trading_name": row[1] or row[0] or "Not set",
        "employer_company_number": row[2] or "Not set",
        "employer_address": row[3] or "United Kingdom",
        "employer_phone": row[4] or "Not set",
    }


def _build_merge_header(
    *,
    contract_number: str,
    tenant: dict[str, str],
    employee: dict[str, Any],
) -> str:
    full_name = f"{employee.get('first_name', '')} {employee.get('last_name', '')}".strip()
    employment = EMPLOYMENT_TYPE_LABELS.get(employee.get("employment_type") or "", employee.get("employment_type") or "Not set")
    salary = employee.get("salary")
    salary_line = f"£{salary:,.2f} per annum" if salary is not None else "As agreed in schedule below"
    return f"""---
**Generated employment contract**

| | |
|---|---|
| **Contract ref** | {contract_number} |
| **Generated** | {_iso(date.today())} |
| **Employer** | {tenant.get('employer_legal_name', 'Not set')} ({tenant.get('employer_trading_name', '')}) |
| **Employer address** | {tenant.get('employer_address', 'Not set')} |
| **Company number** | {tenant.get('employer_company_number', 'Not set')} |
| **Employee** | {full_name} |
| **Employee email** | {employee.get('email') or 'Not set'} |
| **Employee address** | {employee.get('home_address') or 'Not set'} |
| **NI number** | {employee.get('ni_number') or 'To be confirmed'} |
| **Job title** | {employee.get('job_title') or 'Not set'} |
| **Department** | {employee.get('department') or 'Not set'} |
| **Employment type** | {employment} |
| **Start date** | {_iso(employee.get('start_date'))} |
| **Work location** | {employee.get('work_location') or 'Not set'} |
| **Remuneration** | {salary_line} |
| **Probation end** | {_iso(employee.get('probation_end_date'))} |

*Template guidance is ACAS-aligned where noted. Have a qualified UK employment solicitor review before issue.*

---
"""


def markdown_to_html(markdown: str) -> str:
    """Minimal markdown → HTML for contract preview and signing."""
    lines = markdown.splitlines()
    out: list[str] = []
    in_ul = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("### "):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<h3>{html.escape(stripped[4:])}</h3>")
        elif stripped.startswith("## "):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<h2>{html.escape(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<h1>{html.escape(stripped[2:])}</h1>")
        elif stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            text = stripped[6:] if stripped.startswith("- [ ] ") else stripped[6:]
            out.append(f"<li>{html.escape(text)}</li>")
        elif stripped.startswith("- "):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{html.escape(stripped[2:])}</li>")
        elif stripped.startswith("|") and "---" in stripped:
            continue
        elif stripped.startswith("|"):
            cells = [html.escape(c.strip()) for c in stripped.strip("|").split("|")]
            out.append(f"<p>{' · '.join(cells)}</p>")
        elif stripped == "---":
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append("<hr />")
        elif not stripped:
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append("<br />")
        else:
            if in_ul:
                out.append("</ul>")
                in_ul = False
            text = html.escape(stripped)
            text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
            out.append(f"<p>{text}</p>")
    if in_ul:
        out.append("</ul>")
    return "\n".join(out)


def list_contract_templates(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.title, p.description, p.version, p.legal_basis, p.change_summary,
                   p.source, p.source_url, p.source_label,
                   t.title IS NOT NULL AS is_customised,
                   t.based_on_platform_version
            FROM hr_process_templates p
            LEFT JOIN tenant_hr_templates t ON t.template_id = p.id AND t.tenant_id = %s
            WHERE p.is_active = TRUE AND p.category = 'contracts'
            ORDER BY p.sort_order, p.title
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    items = []
    for row in rows:
        platform_version = row[3]
        based = row[10] or platform_version
        update_available = bool(row[9] and based and version_lt(based, platform_version))
        items.append(
            {
                "id": row[0],
                "title": row[1],
                "description": row[2],
                "platform_version": platform_version,
                "legal_basis": row[4],
                "change_summary": row[5],
                "source": row[6] or "shiftswift",
                "source_url": row[7],
                "source_label": row[8],
                "is_customised": bool(row[9]),
                "update_available": update_available,
            }
        )
    return items


def generate_employment_contract(
    *,
    tenant_id: int,
    employee_id: int,
    template_id: str,
    created_by: str | None,
    conn: Any,
) -> dict[str, Any]:
    employee = fetch_employee(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
    if not employee:
        raise LookupError("Employee not found")

    template = get_template_content(tenant_id=tenant_id, template_id=template_id, conn=conn)
    if template.get("category") != "contracts":
        raise ValueError("Template is not an employment contract")

    with conn.cursor() as cur:
        tenant = _fetch_tenant_profile(cur, tenant_id)
        contract_number = _contract_number(tenant_id, employee_id)
        header = _build_merge_header(contract_number=contract_number, tenant=tenant, employee=employee)
        body = template.get("content_markdown") or ""
        generated_markdown = header + body
        generated_html = markdown_to_html(generated_markdown)
        employee_name = f"{employee.get('first_name', '')} {employee.get('last_name', '')}".strip()
        cur.execute(
            """
            SELECT source, source_url FROM hr_process_templates WHERE id = %s
            """,
            (template_id,),
        )
        source_row = cur.fetchone() or ("shiftswift", None)
        cur.execute(
            """
            INSERT INTO employee_contracts (
              tenant_id, employee_id, template_id, contract_number, title, status,
              platform_template_version, template_source, template_source_url,
              generated_markdown, generated_html, employee_email, employee_name, created_by
            ) VALUES (%s, %s, %s, %s, %s, 'generated', %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (
                tenant_id,
                employee_id,
                template_id,
                contract_number,
                template.get("title") or "Employment contract",
                template.get("platform_version") or template.get("version") or "1.0",
                source_row[0] or "shiftswift",
                source_row[1],
                generated_markdown,
                generated_html,
                employee.get("email"),
                employee_name,
                created_by,
            ),
        )
        row = cur.fetchone()
        contract_id = row[0]
        _log_event(cur, contract_id, tenant_id, "generated", created_by, template_id)
    conn.commit()
    return get_contract_detail(conn, contract_id=contract_id, tenant_id=tenant_id)


def list_employment_contracts(*, tenant_id: int, conn: Any, employee_id: int | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT c.id, c.contract_number, c.title, c.status, c.employee_id, c.employee_name,
               c.employee_email, c.template_id, c.platform_template_version, c.template_source,
               c.sent_at, c.signed_at, c.created_at, e.first_name, e.last_name
        FROM employee_contracts c
        JOIN employees e ON e.id = c.employee_id AND e.tenant_id = c.tenant_id
        WHERE c.tenant_id = %s
    """
    params: list[Any] = [tenant_id]
    if employee_id is not None:
        query += " AND c.employee_id = %s"
        params.append(employee_id)
    query += " ORDER BY c.created_at DESC"
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "contract_number": row[1],
            "title": row[2],
            "status": row[3],
            "employee_id": row[4],
            "employee_name": row[5] or f"{row[13]} {row[14]}".strip(),
            "employee_email": row[6],
            "template_id": row[7],
            "platform_template_version": row[8],
            "template_source": row[9],
            "sent_at": row[10].isoformat() if row[10] else None,
            "signed_at": row[11].isoformat() if row[11] else None,
            "created_at": row[12].isoformat() if row[12] else None,
        }
        for row in rows
    ]


def get_contract_detail(*, conn: Any, contract_id: int, tenant_id: int) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.contract_number, c.title, c.status, c.employee_id, c.employee_name,
                   c.employee_email, c.template_id, c.platform_template_version, c.template_source,
                   c.template_source_url, c.generated_markdown, c.generated_html, c.sent_at, c.signed_at,
                   c.created_at, c.employee_document_id, e.first_name, e.last_name
            FROM employee_contracts c
            JOIN employees e ON e.id = c.employee_id AND e.tenant_id = c.tenant_id
            WHERE c.id = %s AND c.tenant_id = %s
            """,
            (contract_id, tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Contract not found")
        cur.execute(
            """
            SELECT event_type, actor, detail, created_at
            FROM employee_contract_events
            WHERE contract_id = %s
            ORDER BY created_at ASC
            """,
            (contract_id,),
        )
        events = [
            {
                "event_type": ev[0],
                "actor": ev[1],
                "detail": ev[2],
                "created_at": ev[3].isoformat() if ev[3] else None,
            }
            for ev in cur.fetchall()
        ]
    return {
        "id": row[0],
        "contract_number": row[1],
        "title": row[2],
        "status": row[3],
        "employee_id": row[4],
        "employee_name": row[5] or f"{row[17]} {row[18]}".strip(),
        "employee_email": row[6],
        "template_id": row[7],
        "platform_template_version": row[8],
        "template_source": row[9],
        "template_source_url": row[10],
        "generated_markdown": row[11],
        "html": row[12],
        "sent_at": row[13].isoformat() if row[13] else None,
        "signed_at": row[14].isoformat() if row[14] else None,
        "created_at": row[15].isoformat() if row[15] else None,
        "employee_document_id": row[16],
        "events": events,
    }


def send_for_signature(
    *,
    conn: Any,
    contract_id: int,
    tenant_id: int,
    actor: str | None,
    frontend_base: str,
) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    expires = _utcnow() + timedelta(days=30)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_email, employee_name, contract_number, title, status
            FROM employee_contracts
            WHERE id = %s AND tenant_id = %s
            """,
            (contract_id, tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Contract not found")
        employee_email, employee_name, contract_number, title, status = row
        if status == "signed":
            raise ValueError("Contract already signed")
        if not employee_email:
            raise ValueError("Employee has no email address — add one in the employee profile first")
        cur.execute(
            """
            UPDATE employee_contracts
            SET status = 'sent', sent_at = NOW(), signing_token = %s,
                signing_token_expires_at = %s, updated_at = NOW()
            WHERE id = %s AND tenant_id = %s
            RETURNING id
            """,
            (token, expires, contract_id, tenant_id),
        )
        signing_url = f"{frontend_base.rstrip('/')}/sign-contract.html?token={token}&type=employment"
        _log_event(cur, contract_id, tenant_id, "sent", actor, signing_url)

    from core.email_templates import contract_signing_email
    from core.notifications import require_email_delivered, send_email_content, smtp_configured

    if not smtp_configured():
        raise ValueError("SMTP is not configured — cannot send contract signing email")

    content = contract_signing_email(
        signatory_name=employee_name,
        contract_name=title,
        contract_number=contract_number,
        signing_url=signing_url,
    )
    delivery = send_email_content(
        conn=conn,
        tenant_id=tenant_id,
        to=employee_email,
        content=content,
        purpose="employment_contract",
        audience="employee",
        payload={
            "employment_contract_id": contract_id,
            "signing_url": signing_url,
            "type": "employment_contract_signing",
        },
        deliver_now=True,
        commit=False,
    )
    require_email_delivered(delivery)
    conn.commit()
    return {
        "contract_id": contract_id,
        "status": "sent",
        "signatory_email": employee_email,
        "signing_url": signing_url,
        "expires_at": expires.isoformat(),
    }


def get_contract_by_token(conn: Any, token: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, tenant_id, template_id, contract_number, status, employee_name,
                   employee_email, generated_html, signing_token_expires_at, signed_at, title
            FROM employee_contracts
            WHERE signing_token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Invalid signing link")
        expires = row[8]
        if expires and expires < _utcnow():
            raise ValueError("Signing link expired")
        if row[9]:
            raise ValueError("Contract already signed")
        return {
            "id": row[0],
            "tenant_id": row[1],
            "template_id": row[2],
            "contract_number": row[3],
            "status": row[4],
            "signatory_name": row[5],
            "signatory_email": row[6],
            "html": row[7],
            "title": row[10],
            "contract_type": "employment",
        }


def sign_employment_contract(
    *,
    conn: Any,
    token: str,
    signature_name: str,
    signature_title: str | None,
    ip_address: str | None,
) -> dict[str, Any]:
    contract = get_contract_by_token(conn, token)
    signed_block = (
        f'<section style="margin-top:2rem;padding:1rem;border:2px solid #0F6E56;">'
        f"<h2>Electronic signature</h2>"
        f"<p><strong>Signed by:</strong> {html.escape(signature_name)}"
        f"{f' ({html.escape(signature_title)})' if signature_title else ''}</p>"
        f"<p><strong>Signed at:</strong> {_utcnow().strftime('%d %B %Y %H:%M UTC')}</p>"
        f"<p><strong>IP address:</strong> {html.escape(ip_address or 'Not recorded')}</p>"
        f"</section>"
    )
    signed_html = (contract.get("html") or "") + signed_block
    signed_bytes = signed_html.encode("utf-8")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT employee_id, contract_number, title, tenant_id
            FROM employee_contracts WHERE id = %s
            """,
            (contract["id"],),
        )
        meta = cur.fetchone()
        if not meta:
            raise LookupError("Contract not found")
        employee_id, contract_number, title, tenant_id = meta

    from modules.documents.service import update_employee_document

    doc = create_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        data={
            "title": f"Signed — {title}",
            "category": "contract",
            "lifecycle_stage": "document_store",
            "notes": f"E-signed employment contract {contract_number}. Stored automatically when employee signed.",
            "original_filename": f"{contract_number}-signed.html",
        },
        uploaded_by="employee_signature",
        conn=conn,
    )
    storage_path, content_sha256, file_size = write_document_file(
        tenant_id=tenant_id,
        document_id=int(doc["id"]),
        title=f"Signed — {title}",
        original_filename=f"{contract_number}-signed.html",
        data=signed_bytes,
        content_type="text/html; charset=utf-8",
        ext=".html",
        scope="employee",
        employee_id=employee_id,
    )
    update_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        document_id=int(doc["id"]),
        updates={
            "storage_path": storage_path,
            "content_sha256": content_sha256,
            "content_type": "text/html; charset=utf-8",
            "file_size_bytes": file_size,
            "original_filename": f"{contract_number}-signed.html",
        },
        conn=conn,
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE employee_contracts
            SET status = 'signed', signed_at = NOW(), signature_name = %s, signature_ip = %s,
                generated_html = %s, signed_storage_path = %s, employee_document_id = %s,
                signing_token = NULL, updated_at = NOW()
            WHERE id = %s
            RETURNING contract_number
            """,
            (signature_name, ip_address, signed_html, storage_path, doc["id"], contract["id"]),
        )
        contract_number = cur.fetchone()[0]
        _log_event(cur, contract["id"], tenant_id, "signed", signature_name, str(doc["id"]))
    conn.commit()
    return {"contract_id": contract["id"], "contract_number": contract_number, "status": "signed", "employee_document_id": doc["id"]}
