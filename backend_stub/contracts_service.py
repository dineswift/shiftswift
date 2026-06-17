"""Legal contract generation, delivery, and signing."""

from __future__ import annotations

import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TEMPLATES_DIR = Path(__file__).resolve().parent / "contract_templates"
STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", Path(__file__).resolve().parent / "storage" / "contracts"))

# Draft/generated packs stay on Master until sent — tenant portal only sees issued agreements.
TENANT_PORTAL_CONTRACT_STATUSES = frozenset({"sent", "signed", "declined", "expired"})

TEMPLATE_REGISTRY = {
    "msa": {"name": "Master Services Agreement", "file": "msa.html"},
    "dpa": {"name": "Data Processing Addendum", "file": "dpa.html"},
    "subscription_order": {"name": "Subscription Order Form", "file": "subscription_order.html"},
}


def provider_defaults() -> dict[str, str]:
    return {
        "provider_legal_name": os.getenv("PROVIDER_LEGAL_NAME", "Datasoftware Analytics Ltd"),
        "provider_company_number": os.getenv("PROVIDER_COMPANY_NUMBER", "14568900"),
        "provider_address": os.getenv(
            "PROVIDER_ADDRESS",
            "235 Charlbury Road, Nottingham, NG8 1NF",
        ),
        "provider_email": os.getenv("PROVIDER_EMAIL", os.getenv("EMAIL_LEGAL", "legal@shiftswifthr.co.uk")),
    }


def _render_template(template_id: str, context: dict[str, str]) -> str:
    meta = TEMPLATE_REGISTRY.get(template_id)
    if not meta:
        raise ValueError(f"Unknown template: {template_id}")
    raw = (TEMPLATES_DIR / meta["file"]).read_text(encoding="utf-8")
    rendered = raw
    for key, value in context.items():
        rendered = rendered.replace("{{" + key + "}}", str(value or "—"))
    rendered = re.sub(r"\{\{[^}]+\}\}", "—", rendered)
    return rendered


def _contract_number(tenant_id: int, template_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"SSHR-{tenant_id}-{template_id.upper()}-{stamp}"


def _log_event(cur: Any, contract_id: int, tenant_id: int, event_type: str, actor: str | None, detail: str | None) -> None:
    cur.execute(
        """
        INSERT INTO contract_events (contract_id, tenant_id, event_type, actor, detail)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (contract_id, tenant_id, event_type, actor, detail),
    )


def seed_templates(conn: Any) -> None:
    with conn.cursor() as cur:
        for template_id, meta in TEMPLATE_REGISTRY.items():
            cur.execute(
                """
                INSERT INTO contract_templates (id, name, description, template_path, version)
                VALUES (%s, %s, %s, %s, '1.0')
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  template_path = EXCLUDED.template_path
                """,
                (template_id, meta["name"], meta["name"], meta["file"]),
            )


def build_context(
    *,
    tenant_id: int,
    template_id: str,
    customer_legal_name: str,
    signatory_email: str,
    signatory_name: str | None = None,
    signatory_title: str | None = None,
    customer_trading_name: str | None = None,
    company_number: str | None = None,
    registered_address: str | None = None,
    vat_number: str | None = None,
    plan_id: str | None = None,
    plan_name: str | None = None,
    plan_price_gbp_ex_vat: float | None = None,
    max_employees: int | None = None,
    billing_interval: str | None = None,
    payroll_plan_id: str | None = None,
    payroll_plan_name: str | None = None,
    payroll_price_gbp_ex_vat: float | None = None,
    effective_date: date | None = None,
    msa_contract_number: str | None = None,
    contract_number: str | None = None,
) -> dict[str, str]:
    ctx = provider_defaults()
    ctx.update(
        {
            "contract_number": contract_number or _contract_number(tenant_id, template_id),
            "msa_contract_number": msa_contract_number or "—",
            "customer_legal_name": customer_legal_name,
            "customer_trading_name": customer_trading_name or customer_legal_name,
            "company_number": company_number or "N/A",
            "registered_address": registered_address or "United Kingdom",
            "signatory_name": signatory_name or "Authorised Signatory",
            "signatory_title": signatory_title or "Director",
            "signatory_email": signatory_email,
            "vat_number": vat_number or "N/A",
            "plan_id": plan_id or "—",
            "plan_name": plan_name or "ShiftSwift HR Subscription",
            "plan_price_gbp_ex_vat": f"{plan_price_gbp_ex_vat:.2f}" if plan_price_gbp_ex_vat is not None else "—",
            "max_employees": str(max_employees or "—"),
            "billing_interval": billing_interval or "month",
            "payroll_plan_id": payroll_plan_id or "—",
            "payroll_plan_name": payroll_plan_name or "Not selected",
            "payroll_price_gbp_ex_vat": (
                f"{payroll_price_gbp_ex_vat:.2f}" if payroll_price_gbp_ex_vat is not None else "—"
            ),
            "effective_date": (effective_date or date.today()).isoformat(),
            "generated_at": datetime.now(timezone.utc).strftime("%d %B %Y %H:%M UTC"),
        }
    )
    return ctx


def create_contract(
    conn: Any,
    *,
    tenant_id: int,
    template_id: str,
    customer_legal_name: str,
    signatory_email: str,
    created_by: str | None = None,
    customer_trading_name: str | None = None,
    signatory_name: str | None = None,
    signatory_title: str | None = None,
    company_number: str | None = None,
    registered_address: str | None = None,
    vat_number: str | None = None,
    plan_id: str | None = None,
    plan_name: str | None = None,
    plan_price_gbp_ex_vat: float | None = None,
    max_employees: int | None = None,
    billing_interval: str | None = None,
    payroll_plan_id: str | None = None,
    payroll_plan_name: str | None = None,
    payroll_price_gbp_ex_vat: float | None = None,
    effective_date: date | None = None,
    msa_contract_number: str | None = None,
) -> dict[str, Any]:
    contract_number = _contract_number(tenant_id, template_id)
    context = build_context(
        tenant_id=tenant_id,
        template_id=template_id,
        customer_legal_name=customer_legal_name,
        signatory_email=signatory_email,
        contract_number=contract_number,
        customer_trading_name=customer_trading_name,
        signatory_name=signatory_name,
        signatory_title=signatory_title,
        company_number=company_number,
        registered_address=registered_address,
        vat_number=vat_number,
        plan_id=plan_id,
        plan_name=plan_name,
        plan_price_gbp_ex_vat=plan_price_gbp_ex_vat,
        max_employees=max_employees,
        billing_interval=billing_interval,
        payroll_plan_id=payroll_plan_id,
        payroll_plan_name=payroll_plan_name,
        payroll_price_gbp_ex_vat=payroll_price_gbp_ex_vat,
        effective_date=effective_date,
        msa_contract_number=msa_contract_number,
    )
    html = _render_template(template_id, context)

    tenant_dir = STORAGE_DIR / str(tenant_id)
    tenant_dir.mkdir(parents=True, exist_ok=True)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tenant_contracts (
              tenant_id, template_id, contract_number, status,
              customer_legal_name, customer_trading_name, company_number, registered_address,
              signatory_name, signatory_title, signatory_email, vat_number,
              plan_id, plan_name, plan_price_gbp_ex_vat, effective_date,
              generated_html, created_by
            )
            VALUES (%s,%s,%s,'generated',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id, contract_number, template_id, status, created_at
            """,
            (
                tenant_id,
                template_id,
                contract_number,
                customer_legal_name,
                customer_trading_name,
                company_number,
                registered_address,
                signatory_name,
                signatory_title,
                signatory_email,
                vat_number,
                plan_id,
                plan_name,
                plan_price_gbp_ex_vat,
                effective_date or date.today(),
                html,
                created_by,
            ),
        )
        row = cur.fetchone()
        contract_id = int(row[0])
        html_path = tenant_dir / f"{contract_id}_{template_id}.html"
        html_path.write_text(html, encoding="utf-8")
        cur.execute(
            "UPDATE tenant_contracts SET generated_html = %s WHERE id = %s",
            (html, contract_id),
        )
        _log_event(cur, contract_id, tenant_id, "generated", created_by, template_id)
    return {
        "id": contract_id,
        "contract_number": row[1],
        "template_id": row[2],
        "status": row[3],
        "html": html,
    }


def generate_contract_pack(
    conn: Any,
    *,
    tenant_id: int,
    customer_legal_name: str,
    signatory_email: str,
    signatory_name: str | None = None,
    signatory_title: str | None = None,
    customer_trading_name: str | None = None,
    company_number: str | None = None,
    registered_address: str | None = None,
    vat_number: str | None = None,
    plan_id: str | None = None,
    plan_name: str | None = None,
    plan_price_gbp_ex_vat: float | None = None,
    max_employees: int | None = None,
    billing_interval: str | None = None,
    payroll_plan_id: str | None = None,
    payroll_plan_name: str | None = None,
    payroll_price_gbp_ex_vat: float | None = None,
    effective_date: date | None = None,
    created_by: str | None = "system",
) -> list[dict[str, Any]]:
    common = {
        "customer_legal_name": customer_legal_name,
        "signatory_email": signatory_email,
        "signatory_name": signatory_name,
        "signatory_title": signatory_title,
        "customer_trading_name": customer_trading_name,
        "company_number": company_number,
        "registered_address": registered_address,
        "vat_number": vat_number,
        "plan_id": plan_id,
        "plan_name": plan_name,
        "plan_price_gbp_ex_vat": plan_price_gbp_ex_vat,
        "max_employees": max_employees,
        "billing_interval": billing_interval,
        "payroll_plan_id": payroll_plan_id,
        "payroll_plan_name": payroll_plan_name,
        "payroll_price_gbp_ex_vat": payroll_price_gbp_ex_vat,
        "effective_date": effective_date,
    }
    msa = create_contract(conn, tenant_id=tenant_id, template_id="msa", created_by=created_by, **common)
    dpa = create_contract(
        conn,
        tenant_id=tenant_id,
        template_id="dpa",
        created_by=created_by,
        msa_contract_number=msa["contract_number"],
        **common,
    )
    order = create_contract(
        conn,
        tenant_id=tenant_id,
        template_id="subscription_order",
        created_by=created_by,
        **common,
    )
    return [msa, dpa, order]


def send_contract_for_signature(
    conn: Any,
    *,
    contract_id: int,
    tenant_id: int,
    actor: str | None = None,
    frontend_base: str = "http://localhost:5173",
) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=30)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT signatory_email, signatory_name, contract_number, template_id
            FROM tenant_contracts
            WHERE id = %s AND tenant_id = %s
            """,
            (contract_id, tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Contract not found")
        signatory_email, signatory_name, contract_number, template_id = row

        cur.execute(
            """
            UPDATE tenant_contracts
            SET status = 'sent', sent_at = NOW(), signing_token = %s,
                signing_token_expires_at = %s, updated_at = NOW()
            WHERE id = %s AND tenant_id = %s
            RETURNING id, status, sent_at
            """,
            (token, expires, contract_id, tenant_id),
        )

        signing_url = f"{frontend_base.rstrip('/')}/sign-contract.html?token={token}"
        contract_label = TEMPLATE_REGISTRY.get(template_id, {}).get("name", "contract")
        from core.email_templates import contract_signing_email

        content = contract_signing_email(
            signatory_name=signatory_name,
            contract_name=contract_label,
            contract_number=contract_number,
            signing_url=signing_url,
        )
        _log_event(cur, contract_id, tenant_id, "sent", actor, signing_url)

    from core.notifications import queue_email_notification

    audience = "hr"
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT role FROM app_users
            WHERE lower(username) = lower(%s) AND tenant_id = %s
            LIMIT 1
            """,
            (signatory_email, tenant_id),
        )
        role_row = cur.fetchone()
        if role_row and role_row[0] == "employee":
            audience = "employee"

    queue_email_notification(
        conn=conn,
        tenant_id=tenant_id,
        subject=content.subject,
        body=content.text,
        purpose="contract",
        to=signatory_email,
        payload={
            "contract_id": contract_id,
            "signing_url": signing_url,
            "type": "contract_signing",
            "audience": audience,
            "html_body": content.html,
        },
        commit=False,
    )

    return {
        "contract_id": contract_id,
        "status": "sent",
        "signatory_email": signatory_email,
        "signing_url": signing_url,
        "expires_at": expires.isoformat(),
    }


def get_contract_by_token(conn: Any, token: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, tenant_id, template_id, contract_number, status, customer_legal_name,
                   signatory_name, signatory_email, generated_html, signing_token_expires_at, signed_at
            FROM tenant_contracts
            WHERE signing_token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("Invalid signing link")
        expires = row[9]
        if expires and expires < datetime.now(timezone.utc):
            raise ValueError("Signing link expired")
        if row[10]:
            raise ValueError("Contract already signed")
        return {
            "id": row[0],
            "tenant_id": row[1],
            "template_id": row[2],
            "contract_number": row[3],
            "status": row[4],
            "customer_legal_name": row[5],
            "signatory_name": row[6],
            "signatory_email": row[7],
            "html": row[8],
        }


def sign_contract(
    conn: Any,
    *,
    token: str,
    signature_name: str,
    signature_title: str | None,
    ip_address: str | None,
) -> dict[str, Any]:
    contract = get_contract_by_token(conn, token)
    signed_block = (
        f'<section style="margin-top:2rem;padding:1rem;border:2px solid #0F6E56;">'
        f"<h2>Electronic signature</h2>"
        f"<p>Signed by: <strong>{signature_name}</strong>"
        f"{f' ({signature_title})' if signature_title else ''}</p>"
        f"<p>Date: {datetime.now(timezone.utc).strftime('%d %B %Y %H:%M UTC')}</p>"
        f"<p>IP: {ip_address or 'recorded'}</p></section>"
    )
    signed_html = (contract["html"] or "") + signed_block
    tenant_dir = STORAGE_DIR / str(contract["tenant_id"])
    tenant_dir.mkdir(parents=True, exist_ok=True)
    signed_path = tenant_dir / f"{contract['id']}_signed.html"
    signed_path.write_text(signed_html, encoding="utf-8")

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenant_contracts
            SET status = 'signed', signature_name = %s, signature_ip = %s,
                signed_at = NOW(), generated_html = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, contract_number, status, signed_at
            """,
            (signature_name, ip_address, signed_html, contract["id"]),
        )
        row = cur.fetchone()
        _log_event(cur, contract["id"], contract["tenant_id"], "signed", signature_name, signed_path.name)

    return {
        "contract_id": row[0],
        "contract_number": row[1],
        "status": row[2],
        "signed_at": row[3].isoformat() if row[3] else None,
    }


def list_contract_events(conn: Any, *, contract_id: int, tenant_id: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT event_type, actor, detail, created_at
            FROM contract_events
            WHERE contract_id = %s AND tenant_id = %s
            ORDER BY created_at ASC
            """,
            (contract_id, tenant_id),
        )
        rows = cur.fetchall()
    return [
        {
            "event_type": row[0],
            "actor": row[1],
            "detail": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
        }
        for row in rows
    ]


def get_contract_detail(
    conn: Any,
    *,
    contract_id: int,
    tenant_id: int,
    tenant_portal: bool = False,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.template_id, t.name, c.contract_number, c.status,
                   c.customer_legal_name, c.signatory_email, c.signatory_name,
                   c.signatory_title, c.generated_html, c.sent_at, c.signed_at,
                   c.effective_date, c.created_at, c.signing_token_expires_at
            FROM tenant_contracts c
            JOIN contract_templates t ON t.id = c.template_id
            WHERE c.id = %s AND c.tenant_id = %s
            """,
            (contract_id, tenant_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("contract not found")
    if tenant_portal and row[4] not in TENANT_PORTAL_CONTRACT_STATUSES:
        raise LookupError("contract not found")
    events = list_contract_events(conn, contract_id=contract_id, tenant_id=tenant_id)
    return {
        "id": row[0],
        "template_id": row[1],
        "template_name": row[2],
        "contract_number": row[3],
        "status": row[4],
        "customer_legal_name": row[5],
        "signatory_email": row[6],
        "signatory_name": row[7],
        "signatory_title": row[8],
        "html": row[9],
        "sent_at": row[10].isoformat() if row[10] else None,
        "signed_at": row[11].isoformat() if row[11] else None,
        "effective_date": row[12].isoformat() if row[12] else None,
        "created_at": row[13].isoformat() if row[13] else None,
        "signing_token_expires_at": row[14].isoformat() if row[14] else None,
        "events": events,
    }


def list_contracts(conn: Any, tenant_id: int, *, tenant_portal: bool = False) -> list[dict[str, Any]]:
    portal_filter = " AND c.status IN ('sent', 'signed', 'declined', 'expired')" if tenant_portal else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT c.id, c.template_id, t.name, c.contract_number, c.status,
                   c.customer_legal_name, c.signatory_email, c.sent_at, c.signed_at, c.created_at
            FROM tenant_contracts c
            JOIN contract_templates t ON t.id = c.template_id
            WHERE c.tenant_id = %s{portal_filter}
            ORDER BY c.created_at DESC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": r[0],
            "template_id": r[1],
            "template_name": r[2],
            "contract_number": r[3],
            "status": r[4],
            "customer_legal_name": r[5],
            "signatory_email": r[6],
            "sent_at": r[7].isoformat() if r[7] else None,
            "signed_at": r[8].isoformat() if r[8] else None,
            "created_at": r[9].isoformat() if r[9] else None,
        }
        for r in rows
    ]
