"""SwiftCRM API — lettings desk (properties, occupiers, invoices, payments)."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from data import (
    DEMO_EMAIL,
    DEMO_PASSWORD,
    DEMO_TOKEN,
    LANDLORD_PORTAL_PASSWORD,
    TENANT_PORTAL_PASSWORD,
    execute,
    init_db,
    row,
    rows,
    verify_password,
)
from desk import bind as bind_desk_routes
from phones import to_e164
from records import bind as bind_record_routes
from telephony import bind as bind_telephony

app = FastAPI(title="SwiftCRM", version="0.1.0", description="Lettings & housing CRM")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5280", "http://127.0.0.1:5280", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PIPELINE_STAGES = ("enquiry", "viewing", "offer", "referencing", "move_in", "lost")


@app.on_event("startup")
def startup() -> None:
    init_db()


def parse_actor(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in required")
    token = authorization.split(" ", 1)[1].strip()
    if token == DEMO_TOKEN:
        return {"role": "agency", "id": 0, "name": "Alex Morgan", "email": DEMO_EMAIL}
    if token.startswith("swiftcrm-portal-"):
        parts = token.split("-")
        if len(parts) >= 4:
            role = parts[2]
            try:
                cid = int(parts[3])
            except ValueError as exc:
                raise HTTPException(status_code=401, detail="Invalid session") from exc
            person = row("SELECT * FROM contacts WHERE id = ? AND role = ?", (cid, role))
            if person:
                return {"role": role, "id": cid, "name": person["name"], "email": person["email"]}
    raise HTTPException(status_code=401, detail="Invalid session")


def require_agency(authorization: str | None) -> dict[str, Any]:
    actor = parse_actor(authorization)
    if actor["role"] != "agency":
        raise HTTPException(status_code=403, detail="Agency desk only")
    return actor


def require_auth(authorization: str | None) -> None:
    require_agency(authorization)


def gbp(pence: int | None) -> float | None:
    if pence is None:
        return None
    return round(pence / 100, 2)


def decorate_property(item: dict[str, Any]) -> dict[str, Any]:
    landlord = row("SELECT id, name, email, phone FROM contacts WHERE id = ?", (item["landlord_id"],)) if item.get("landlord_id") else None
    tenancy = row(
        """SELECT t.*, c.name AS occupier_name
           FROM tenancies t JOIN contacts c ON c.id = t.occupier_id
           WHERE t.property_id = ? AND t.status = 'active'""",
        (item["id"],),
    )
    return {
        **item,
        "rent_pcm": gbp(item["rent_pcm"]),
        "landlord": landlord,
        "current_tenancy": (
            {
                **tenancy,
                "rent_pcm": gbp(tenancy["rent_pcm"]),
                "deposit": gbp(tenancy["deposit"]),
            }
            if tenancy
            else None
        ),
    }


def decorate_invoice(item: dict[str, Any]) -> dict[str, Any]:
    prop = row("SELECT name, address_line, city FROM properties WHERE id = ?", (item["property_id"],))
    contact = row("SELECT id, name, email, role FROM contacts WHERE id = ?", (item["contact_id"],))
    paid = row(
        "SELECT COALESCE(SUM(amount_pence), 0) AS total FROM payments WHERE invoice_id = ?",
        (item["id"],),
    )
    paid_pence = int(paid["total"]) if paid else 0
    return {
        **item,
        "amount": gbp(item["amount_pence"]),
        "paid": gbp(paid_pence),
        "balance": gbp(item["amount_pence"] - paid_pence),
        "property": prop,
        "contact": contact,
    }


class LoginBody(BaseModel):
    email: str
    password: str
    portal: str | None = None


class PropertyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    address_line: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=80)
    postcode: str = Field(min_length=2, max_length=12)
    beds: int = Field(ge=0, le=20)
    property_type: str = Field(pattern="^(flat|house|hmo|studio|other)$")
    rent_pcm: float = Field(gt=0)
    landlord_id: int | None = None
    notes: str | None = None
    council_tax_band: str | None = None
    council_tax_authority: str | None = None
    council_tax_account: str | None = None
    council_tax_liable: str | None = None
    epc_rating: str | None = None


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: str | None = None
    phone: str | None = None
    role: str = Field(pattern="^(landlord|occupier|applicant|guarantor)$")
    notes: str | None = None
    address_line: str | None = None
    city: str | None = None
    postcode: str | None = None
    utr: str | None = None
    nrl_status: str | None = None
    nrl_ref: str | None = None
    preferred_channel: str | None = None


class InvoiceCreate(BaseModel):
    property_id: int
    contact_id: int
    tenancy_id: int | None = None
    amount: float = Field(gt=0)
    due_on: str
    description: str = Field(min_length=1, max_length=240)


class CollectBody(BaseModel):
    method: str = Field(default="bacs", pattern="^(bacs|card|bank)$")


class DealPatch(BaseModel):
    stage: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "swiftcrm", "product": "SwiftCRM"}


@app.post("/auth/login")
def login(body: LoginBody) -> dict[str, Any]:
    email = body.email.strip().lower()
    portal = (body.portal or "agency").lower()
    user = row("SELECT * FROM users WHERE lower(email) = ?", (email,))
    password_ok = bool(user and verify_password(body.password, user["password_hash"]))
    if portal == "agency":
        demo_ok = email == DEMO_EMAIL and body.password == DEMO_PASSWORD
        if not ((user and user["role"] == "agency" and password_ok) or demo_ok):
            raise HTTPException(status_code=401, detail="Check email and password")
        return {
            "token": DEMO_TOKEN,
            "user": {
                "name": user["name"] if user else "Alex Morgan",
                "email": DEMO_EMAIL,
                "role": "agency_admin",
                "agency": "Charlbury Lettings",
            },
        }
    role = "occupier" if portal in {"tenant", "occupier"} else "landlord"
    expected = TENANT_PORTAL_PASSWORD if role == "occupier" else LANDLORD_PORTAL_PASSWORD
    if user and password_ok and user["role"] == role and user.get("contact_id"):
        person = row("SELECT * FROM contacts WHERE id = ?", (user["contact_id"],))
    elif body.password == expected:
        person = row("SELECT * FROM contacts WHERE lower(email) = ? AND role = ?", (email, role))
    else:
        person = None
    if not person:
        raise HTTPException(status_code=401, detail="No portal account for that email")
    return {
        "token": f"swiftcrm-portal-{role}-{person['id']}",
        "user": {
            "id": person["id"],
            "name": person["name"],
            "email": person["email"],
            "role": role,
            "agency": "Charlbury Lettings",
        },
    }


@app.get("/me")
def me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = require_agency(authorization)
    queued = row("SELECT COUNT(*) AS n FROM mail_outbox WHERE status = 'queued'") or {"n": 0}
    xero_n = row("SELECT COUNT(*) AS n FROM xero_export") or {"n": 0}
    return {
        "name": actor["name"],
        "email": actor.get("email") or DEMO_EMAIL,
        "role": "agency_admin",
        "agency": "Charlbury Lettings",
        "phone": "0115 000 1000",
        "accounting": {
            "xero": "export_queue" if int(xero_n["n"]) else "not_connected",
            "freeagent": "not_connected",
            "xero_export_rows": int(xero_n["n"]),
        },
        "mail_queued": int(queued["n"]),
    }


@app.get("/overview")
def overview(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    props = rows("SELECT status, COUNT(*) AS n FROM properties GROUP BY status")
    invoices = rows("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_pence),0) AS total FROM invoices GROUP BY status")
    arrears = row(
        "SELECT COALESCE(SUM(amount_pence),0) AS total FROM invoices WHERE status = 'overdue'"
    )
    lettings = row("SELECT COUNT(*) AS n FROM tenancies WHERE status = 'active'")
    inbox = row("SELECT COUNT(*) AS n FROM communications")
    pipeline = row("SELECT COUNT(*) AS n FROM deals WHERE stage NOT IN ('lost','move_in')")
    jobs = row("SELECT COUNT(*) AS n FROM jobs WHERE status NOT IN ('done','cancelled')")
    ringing = row("SELECT COUNT(*) AS n FROM calls WHERE status = 'ringing'")
    compliance_due = row(
        """SELECT COUNT(*) AS n FROM compliance_items
           WHERE status IN ('overdue', 'due_soon', 'booked')
              OR (due_on IS NOT NULL AND due_on <= date('now', '+42 days'))"""
    )
    by_status = {r["status"]: r["n"] for r in props}
    inv = {r["status"]: {"count": r["n"], "amount": gbp(r["total"])} for r in invoices}
    due_soon = rows(
        """SELECT i.*, p.name AS property_name, c.name AS contact_name
           FROM invoices i
           JOIN properties p ON p.id = i.property_id
           JOIN contacts c ON c.id = i.contact_id
           WHERE i.status IN ('due','overdue')
           ORDER BY i.due_on ASC LIMIT 6"""
    )
    latest = rows(
        """SELECT c.*, p.name AS property_name
           FROM communications c
           LEFT JOIN properties p ON p.id = c.property_id
           ORDER BY c.created_at DESC LIMIT 5"""
    )
    compliance_attention = rows(
        """SELECT c.id, c.kind, c.title, c.due_on, c.status, p.name AS property_name
           FROM compliance_items c
           JOIN properties p ON p.id = c.property_id
           WHERE c.status IN ('overdue', 'due_soon', 'booked')
           ORDER BY c.due_on IS NULL, c.due_on ASC LIMIT 6"""
    )
    return {
        "portfolio": {
            "properties": sum(by_status.values()),
            "let": by_status.get("let", 0),
            "available": by_status.get("available", 0),
            "lettings": int(lettings["n"]) if lettings else 0,
        },
        "arrears_gbp": gbp(int(arrears["total"]) if arrears else 0),
        "open_pipeline": int(pipeline["n"]) if pipeline else 0,
        "inbox": int(inbox["n"]) if inbox else 0,
        "open_jobs": int(jobs["n"]) if jobs else 0,
        "ringing": int(ringing["n"]) if ringing else 0,
        "compliance_due": int(compliance_due["n"]) if compliance_due else 0,
        "invoices": inv,
        "attention": [
            {
                "id": r["id"],
                "number": r["number"],
                "status": r["status"],
                "due_on": r["due_on"],
                "amount": gbp(r["amount_pence"]),
                "property_name": r["property_name"],
                "contact_name": r["contact_name"],
            }
            for r in due_soon
        ],
        "latest_updates": latest,
        "compliance_attention": compliance_attention,
    }


@app.get("/properties")
def list_properties(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    items = [decorate_property(p) for p in rows("SELECT * FROM properties ORDER BY city, name")]
    return {"properties": items}


@app.post("/properties")
def create_property(body: PropertyCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    new_id = execute(
        """INSERT INTO properties
           (name, address_line, city, postcode, beds, property_type, status, rent_pcm, landlord_id, notes,
            council_tax_band, council_tax_authority, council_tax_account, council_tax_liable, epc_rating)
           VALUES (?,?,?,?,?,?, 'available',?,?,?,?,?,?,?,?)""",
        (
            body.name,
            body.address_line,
            body.city,
            body.postcode.upper(),
            body.beds,
            body.property_type,
            int(round(body.rent_pcm * 100)),
            body.landlord_id,
            body.notes,
            body.council_tax_band,
            body.council_tax_authority,
            body.council_tax_account,
            body.council_tax_liable or "occupier",
            body.epc_rating,
        ),
    )
    created = row("SELECT * FROM properties WHERE id = ?", (new_id,))
    return decorate_property(created or {})


@app.get("/contacts")
def list_contacts(
    role: str | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_auth(authorization)
    if role:
        items = rows("SELECT * FROM contacts WHERE role = ? ORDER BY name", (role,))
    else:
        items = rows("SELECT * FROM contacts ORDER BY role, name")
    return {"contacts": items}


@app.post("/contacts")
def create_contact(body: ContactCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    new_id = execute(
        """INSERT INTO contacts
           (name, email, phone, phone_e164, role, notes, address_line, city, postcode, utr, nrl_status, nrl_ref, preferred_channel)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            body.name,
            body.email,
            body.phone,
            to_e164(body.phone),
            body.role,
            body.notes,
            body.address_line,
            body.city,
            body.postcode,
            body.utr,
            body.nrl_status,
            body.nrl_ref,
            body.preferred_channel or "email",
        ),
    )
    return row("SELECT * FROM contacts WHERE id = ?", (new_id,)) or {}


@app.get("/tenancies")
def list_tenancies(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    items = rows(
        """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                  p.council_tax_band, p.council_tax_liable,
                  o.name AS occupier_name, l.name AS landlord_name
           FROM tenancies t
           JOIN properties p ON p.id = t.property_id
           JOIN contacts o ON o.id = t.occupier_id
           JOIN contacts l ON l.id = t.landlord_id
           ORDER BY t.start_date DESC"""
    )
    out = []
    for item in items:
        out.append({**item, "rent_pcm": gbp(item["rent_pcm"]), "deposit": gbp(item["deposit"])})
    return {"tenancies": out}


@app.get("/invoices")
def list_invoices(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    items = [decorate_invoice(i) for i in rows("SELECT * FROM invoices ORDER BY due_on DESC")]
    return {"invoices": items}


@app.post("/invoices")
def create_invoice(body: InvoiceCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    if not row("SELECT id FROM properties WHERE id = ?", (body.property_id,)):
        raise HTTPException(status_code=400, detail="Unknown property")
    if not row("SELECT id FROM contacts WHERE id = ?", (body.contact_id,)):
        raise HTTPException(status_code=400, detail="Unknown contact")
    count = row("SELECT COUNT(*) AS n FROM invoices") or {"n": 0}
    number = f"INV-2026-{int(count['n']) + 60:04d}"
    new_id = execute(
        """INSERT INTO invoices
           (number, tenancy_id, property_id, contact_id, issued_on, due_on, amount_pence, status, description, xero_status)
           VALUES (?,?,?,?,?,?,?,'due',?,'not_synced')""",
        (
            number,
            body.tenancy_id,
            body.property_id,
            body.contact_id,
            date.today().isoformat(),
            body.due_on,
            int(round(body.amount * 100)),
            body.description,
        ),
    )
    created = row("SELECT * FROM invoices WHERE id = ?", (new_id,))
    return decorate_invoice(created or {})


@app.post("/invoices/generate-rent")
def generate_rent(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    period = date.today().strftime("%Y-%m")
    lettings = rows("SELECT * FROM tenancies WHERE status = 'active'")
    created_ids: list[int] = []
    skipped = 0
    count = row("SELECT COUNT(*) AS n FROM invoices") or {"n": 0}
    seq = int(count["n"]) + 60
    for letting in lettings:
        existing = row(
            "SELECT id FROM invoices WHERE tenancy_id = ? AND period_month = ?",
            (letting["id"], period),
        )
        if existing:
            skipped += 1
            continue
        seq += 1
        number = f"INV-2026-{seq:04d}"
        prop = row("SELECT name FROM properties WHERE id = ?", (letting["property_id"],))
        due_day = int(letting["rent_due_day"] or 1)
        due_on = f"{period}-{due_day:02d}"
        new_id = execute(
            """INSERT INTO invoices
               (number, tenancy_id, property_id, contact_id, issued_on, due_on, amount_pence, status, description, xero_status, period_month)
               VALUES (?,?,?,?,?,?,?,'due',?,'not_synced',?)""",
            (
                number,
                letting["id"],
                letting["property_id"],
                letting["occupier_id"],
                date.today().isoformat(),
                due_on,
                letting["rent_pcm"],
                f"Rent {period} — {(prop or {}).get('name') or 'letting'}",
                period,
            ),
        )
        created_ids.append(new_id)
    return {"created": len(created_ids), "skipped": skipped, "period": period, "invoice_ids": created_ids}


@app.post("/invoices/{invoice_id}/collect")
def collect_invoice(
    invoice_id: int,
    body: CollectBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_auth(authorization)
    invoice = row("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice["status"] == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    paid = row("SELECT COALESCE(SUM(amount_pence),0) AS total FROM payments WHERE invoice_id = ?", (invoice_id,))
    remaining = invoice["amount_pence"] - int(paid["total"] if paid else 0)
    if remaining <= 0:
        execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,))
        return decorate_invoice(row("SELECT * FROM invoices WHERE id = ?", (invoice_id,)) or invoice)
    ref = f"PAY-{invoice['number'][-4:]}-{body.method[:2].upper()}"
    execute(
        "INSERT INTO payments (invoice_id, amount_pence, paid_on, method, reference) VALUES (?,?,?,?,?)",
        (invoice_id, remaining, date.today().isoformat(), body.method, ref),
    )
    execute("UPDATE invoices SET status = 'paid', xero_status = 'queued' WHERE id = ?", (invoice_id,))
    return decorate_invoice(row("SELECT * FROM invoices WHERE id = ?", (invoice_id,)) or invoice)


@app.get("/payments")
def list_payments(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    items = rows(
        """SELECT p.*, i.number AS invoice_number, c.name AS contact_name, pr.name AS property_name
           FROM payments p
           JOIN invoices i ON i.id = p.invoice_id
           JOIN contacts c ON c.id = i.contact_id
           JOIN properties pr ON pr.id = i.property_id
           ORDER BY p.paid_on DESC"""
    )
    return {
        "payments": [
            {**item, "amount": gbp(item["amount_pence"])}
            for item in items
        ]
    }


@app.get("/pipeline")
def pipeline(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    deals = rows(
        """SELECT d.*, c.name AS contact_name, c.role AS contact_role, p.name AS property_name
           FROM deals d
           JOIN contacts c ON c.id = d.contact_id
           LEFT JOIN properties p ON p.id = d.property_id
           ORDER BY d.id"""
    )
    columns = {stage: [] for stage in PIPELINE_STAGES}
    for deal in deals:
        item = {**deal, "value_pcm": gbp(deal["value_pcm"]) if deal["value_pcm"] is not None else None}
        columns.setdefault(deal["stage"], []).append(item)
    return {
        "stages": [
            {"key": stage, "label": stage.replace("_", " ").title(), "deals": columns.get(stage, [])}
            for stage in PIPELINE_STAGES
            if stage != "lost" or columns.get(stage)
        ]
    }


@app.patch("/pipeline/deals/{deal_id}")
def patch_deal(
    deal_id: int,
    body: DealPatch,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_auth(authorization)
    if body.stage not in PIPELINE_STAGES:
        raise HTTPException(status_code=400, detail="Unknown stage")
    if not row("SELECT id FROM deals WHERE id = ?", (deal_id,)):
        raise HTTPException(status_code=404, detail="Deal not found")
    execute("UPDATE deals SET stage = ? WHERE id = ?", (body.stage, deal_id))
    return row("SELECT * FROM deals WHERE id = ?", (deal_id,)) or {}


app.include_router(bind_desk_routes(require_agency, parse_actor))
app.include_router(bind_telephony(require_agency))
app.include_router(bind_record_routes(require_agency))
