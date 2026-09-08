"""Agency extra routes: lettings detail, tax, inbox, portals."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from data import execute, row, rows
from phones import to_e164

router = APIRouter()

AUDIENCES = ("landlord", "occupier", "both", "internal")
CHANNELS = ("note", "email", "sms", "phone", "portal")


def gbp(pence: int | None) -> float | None:
    if pence is None:
        return None
    return round(pence / 100, 2)


def decorate_property(item: dict[str, Any]) -> dict[str, Any]:
    landlord = (
        row(
            "SELECT id, name, email, phone, nrl_status, utr FROM contacts WHERE id = ?",
            (item["landlord_id"],),
        )
        if item.get("landlord_id")
        else None
    )
    tenancy = row(
        """SELECT t.*, c.name AS occupier_name, c.id AS occupier_contact_id
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


def decorate_tenancy(item: dict[str, Any]) -> dict[str, Any]:
    return {**item, "rent_pcm": gbp(item["rent_pcm"]), "deposit": gbp(item["deposit"])}


def decorate_message(item: dict[str, Any]) -> dict[str, Any]:
    prop = (
        row("SELECT id, name FROM properties WHERE id = ?", (item["property_id"],))
        if item.get("property_id")
        else None
    )
    contact = (
        row("SELECT id, name, role FROM contacts WHERE id = ?", (item["contact_id"],))
        if item.get("contact_id")
        else None
    )
    return {**item, "property": prop, "contact": contact}


class TenancyCreate(BaseModel):
    property_id: int
    occupier_id: int
    landlord_id: int
    start_date: str
    end_date: str | None = None
    rent_pcm: float = Field(gt=0)
    deposit: float = Field(ge=0)
    rent_due_day: int = Field(default=1, ge=1, le=28)
    deposit_scheme: str | None = None
    deposit_ref: str | None = None
    furnished: str | None = None


class MessageCreate(BaseModel):
    audience: str = Field(pattern="^(landlord|occupier|both|internal)$")
    channel: str = Field(default="note", pattern="^(note|email|sms|phone|portal)$")
    property_id: int | None = None
    tenancy_id: int | None = None
    contact_id: int | None = None
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)


class PortalMessageCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    property_id: int | None = None
    tenancy_id: int | None = None


class ContactPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    address_line: str | None = None
    city: str | None = None
    postcode: str | None = None
    utr: str | None = None
    nrl_status: str | None = None
    nrl_ref: str | None = None
    preferred_channel: str | None = None


class PropertyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    address_line: str | None = None
    city: str | None = None
    postcode: str | None = None
    notes: str | None = None
    council_tax_band: str | None = None
    council_tax_authority: str | None = None
    council_tax_account: str | None = None
    council_tax_liable: str | None = None
    epc_rating: str | None = None
    gas_due: str | None = None
    eicr_due: str | None = None
    rent_pcm: float | None = Field(default=None, gt=0)
    status: str | None = None


class TenancyPatch(BaseModel):
    rent_pcm: float | None = Field(default=None, gt=0)
    deposit: float | None = Field(default=None, ge=0)
    end_date: str | None = None
    rent_due_day: int | None = Field(default=None, ge=1, le=28)
    deposit_scheme: str | None = None
    deposit_ref: str | None = None
    furnished: str | None = None
    status: str | None = None


class JobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str | None = None
    property_id: int | None = None
    tenancy_id: int | None = None
    contact_id: int | None = None
    call_id: int | None = None
    priority: str = Field(default="normal", pattern="^(low|normal|high|urgent)$")
    reported_via: str | None = None


class JobPatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(open|booked|in_progress|done|cancelled)$")
    title: str | None = None
    detail: str | None = None
    priority: str | None = Field(default=None, pattern="^(low|normal|high|urgent)$")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def occupier_lettings_sql() -> str:
    return """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                     p.council_tax_band, p.council_tax_authority, p.council_tax_liable,
                     l.name AS landlord_name
              FROM tenancies t
              JOIN properties p ON p.id = t.property_id
              JOIN contacts l ON l.id = t.landlord_id
              WHERE t.occupier_id = ? OR t.id IN (
                SELECT tenancy_id FROM tenancy_occupiers WHERE contact_id = ?
              )
              ORDER BY t.start_date DESC"""


def tenancy_occupiers(tenancy_id: int) -> list[dict[str, Any]]:
    return rows(
        """SELECT c.id, c.name, c.email, c.phone, c.phone_e164, x.is_primary
           FROM tenancy_occupiers x
           JOIN contacts c ON c.id = x.contact_id
           WHERE x.tenancy_id = ?
           ORDER BY x.is_primary DESC, c.name""",
        (tenancy_id,),
    )


def apply_patch(table: str, item_id: int, allowed: dict[str, Any]) -> None:
    fields = {k: v for k, v in allowed.items() if v is not None}
    if not fields:
        return
    sets = ", ".join(f"{key} = ?" for key in fields)
    execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*fields.values(), item_id))


def queue_mail_for_message(comm_id: int, audience: str, contact_id: int | None, property_id: int | None, subject: str, body: str) -> None:
    recipients: list[str] = []
    if contact_id:
        person = row("SELECT email FROM contacts WHERE id = ?", (contact_id,))
        if person and person.get("email"):
            recipients.append(person["email"])
    if audience in {"landlord", "both"} and property_id:
        landlord = row(
            """SELECT c.email FROM properties p JOIN contacts c ON c.id = p.landlord_id
               WHERE p.id = ?""",
            (property_id,),
        )
        if landlord and landlord.get("email"):
            recipients.append(landlord["email"])
    seen: set[str] = set()
    for email in recipients:
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        execute(
            """INSERT INTO mail_outbox (created_at, to_email, subject, body, status, communication_id)
               VALUES (?, ?, ?, ?, 'queued', ?)""",
            (now_iso(), email, subject, body, comm_id),
        )


def bind(require_agency, parse_actor):  # wired from main to avoid circular imports
    @router.get("/properties/{property_id}")
    def get_property(property_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        item = row("SELECT * FROM properties WHERE id = ?", (property_id,))
        if not item:
            raise HTTPException(status_code=404, detail="Property not found")
        messages = rows(
            "SELECT * FROM communications WHERE property_id = ? ORDER BY created_at DESC",
            (property_id,),
        )
        return {**decorate_property(item), "communications": [decorate_message(m) for m in messages]}

    @router.get("/contacts/{contact_id}")
    def get_contact(contact_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        person = row("SELECT * FROM contacts WHERE id = ?", (contact_id,))
        if not person:
            raise HTTPException(status_code=404, detail="Person not found")
        props = []
        lettings = []
        if person["role"] == "landlord":
            props = [
                decorate_property(p)
                for p in rows("SELECT * FROM properties WHERE landlord_id = ?", (contact_id,))
            ]
            lettings = [
                decorate_tenancy(t)
                for t in rows(
                    """SELECT t.*, p.name AS property_name, o.name AS occupier_name
                       FROM tenancies t
                       JOIN properties p ON p.id = t.property_id
                       JOIN contacts o ON o.id = t.occupier_id
                       WHERE t.landlord_id = ? ORDER BY t.start_date DESC""",
                    (contact_id,),
                )
            ]
        if person["role"] == "occupier":
            lettings = [
                decorate_tenancy(t)
                for t in rows(occupier_lettings_sql(), (contact_id, contact_id))
            ]
        messages = rows(
            """SELECT * FROM communications
               WHERE contact_id = ? OR property_id IN (SELECT id FROM properties WHERE landlord_id = ?)
               ORDER BY created_at DESC LIMIT 20""",
            (contact_id, contact_id),
        )
        return {
            "contact": person,
            "properties": props,
            "lettings": lettings,
            "communications": [decorate_message(m) for m in messages],
        }

    @router.get("/tenancies/{tenancy_id}")
    def get_tenancy(tenancy_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        item = row(
            """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                      p.council_tax_band, p.council_tax_authority, p.council_tax_account, p.council_tax_liable,
                      o.name AS occupier_name, o.email AS occupier_email, o.phone AS occupier_phone,
                      l.name AS landlord_name, l.email AS landlord_email, l.nrl_status
               FROM tenancies t
               JOIN properties p ON p.id = t.property_id
               JOIN contacts o ON o.id = t.occupier_id
               JOIN contacts l ON l.id = t.landlord_id
               WHERE t.id = ?""",
            (tenancy_id,),
        )
        if not item:
            raise HTTPException(status_code=404, detail="Letting not found")
        messages = rows(
            "SELECT * FROM communications WHERE tenancy_id = ? ORDER BY created_at DESC",
            (tenancy_id,),
        )
        invoices = [
            decorate_invoice(i)
            for i in rows("SELECT * FROM invoices WHERE tenancy_id = ? ORDER BY due_on DESC", (tenancy_id,))
        ]
        jobs = rows("SELECT * FROM jobs WHERE tenancy_id = ? ORDER BY id DESC", (tenancy_id,))
        return {
            **decorate_tenancy(item),
            "occupiers": tenancy_occupiers(tenancy_id),
            "communications": [decorate_message(m) for m in messages],
            "invoices": invoices,
            "jobs": jobs,
        }

    @router.post("/tenancies")
    def create_tenancy(body: TenancyCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        prop = row("SELECT * FROM properties WHERE id = ?", (body.property_id,))
        occupier = row("SELECT id FROM contacts WHERE id = ? AND role = 'occupier'", (body.occupier_id,))
        landlord = row("SELECT id FROM contacts WHERE id = ? AND role = 'landlord'", (body.landlord_id,))
        if not prop or not occupier or not landlord:
            raise HTTPException(status_code=400, detail="Property, tenant and landlord are required")
        new_id = execute(
            """INSERT INTO tenancies
               (property_id, occupier_id, landlord_id, start_date, end_date, rent_pcm, deposit, status,
                rent_due_day, deposit_scheme, deposit_ref, furnished)
               VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)""",
            (
                body.property_id,
                body.occupier_id,
                body.landlord_id,
                body.start_date,
                body.end_date,
                int(round(body.rent_pcm * 100)),
                int(round(body.deposit * 100)),
                body.rent_due_day,
                body.deposit_scheme,
                body.deposit_ref,
                body.furnished,
            ),
        )
        execute(
            "UPDATE properties SET status = 'let', landlord_id = ? WHERE id = ?",
            (body.landlord_id, body.property_id),
        )
        execute(
            "INSERT INTO tenancy_occupiers (tenancy_id, contact_id, is_primary) VALUES (?, ?, 1)",
            (new_id, body.occupier_id),
        )
        created = row("SELECT * FROM tenancies WHERE id = ?", (new_id,))
        return decorate_tenancy(created or {})

    @router.get("/communications")
    def list_communications(
        audience: str | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if audience:
            items = rows(
                "SELECT * FROM communications WHERE audience = ? ORDER BY created_at DESC",
                (audience,),
            )
        else:
            items = rows("SELECT * FROM communications ORDER BY created_at DESC")
        return {"communications": [decorate_message(m) for m in items]}

    @router.post("/communications")
    def create_communication(
        body: MessageCreate,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        actor = require_agency(authorization)
        if body.audience not in AUDIENCES or body.channel not in CHANNELS:
            raise HTTPException(status_code=400, detail="Unknown audience or channel")
        new_id = execute(
            """INSERT INTO communications
               (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, subject, body)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                now_iso(),
                "agency",
                actor["name"],
                body.audience,
                body.channel,
                body.property_id,
                body.tenancy_id,
                body.contact_id,
                body.subject,
                body.body,
            ),
        )
        if body.channel == "email":
            queue_mail_for_message(
                new_id, body.audience, body.contact_id, body.property_id, body.subject, body.body
            )
        created = row("SELECT * FROM communications WHERE id = ?", (new_id,))
        return decorate_message(created or {})

    @router.get("/tax")
    def tax_overview(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        council = rows(
            """SELECT p.id, p.name, p.address_line, p.city, p.postcode, p.status,
                      p.council_tax_band, p.council_tax_authority, p.council_tax_account, p.council_tax_liable,
                      l.name AS landlord_name, o.name AS occupier_name
               FROM properties p
               LEFT JOIN contacts l ON l.id = p.landlord_id
               LEFT JOIN tenancies t ON t.property_id = p.id AND t.status = 'active'
               LEFT JOIN contacts o ON o.id = t.occupier_id
               ORDER BY p.city, p.name"""
        )
        landlords = rows(
            "SELECT id, name, email, utr, nrl_status, nrl_ref FROM contacts WHERE role = 'landlord' ORDER BY name"
        )
        return {
            "council_tax": council,
            "landlords": landlords,
            "notes": [
                "Council tax is local billing-authority tax — band, account and who is liable (tenant, landlord, or void).",
                "NRL is HMRC non-resident landlord withholding on UK rent. Record status here; this is not a tax filing product.",
            ],
        }

    @router.get("/portal/home")
    def portal_home(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        actor = parse_actor(authorization)
        if actor["role"] not in {"occupier", "landlord"}:
            raise HTTPException(status_code=403, detail="Use the tenant or landlord app")
        cid = actor["id"]
        if actor["role"] == "occupier":
            lettings = [
                decorate_tenancy(t)
                for t in rows(occupier_lettings_sql(), (cid, cid))
            ]
            invoices = [
                decorate_invoice(i)
                for i in rows("SELECT * FROM invoices WHERE contact_id = ? ORDER BY due_on DESC", (cid,))
            ]
            vis = "audience IN ('occupier', 'both')"
        else:
            lettings = [
                decorate_tenancy(t)
                for t in rows(
                    """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                              p.council_tax_band, p.council_tax_liable, o.name AS occupier_name
                       FROM tenancies t
                       JOIN properties p ON p.id = t.property_id
                       JOIN contacts o ON o.id = t.occupier_id
                       WHERE t.landlord_id = ? ORDER BY t.start_date DESC""",
                    (cid,),
                )
            ]
            invoices = [
                decorate_invoice(i)
                for i in rows(
                    """SELECT i.* FROM invoices i JOIN properties p ON p.id = i.property_id
                       WHERE p.landlord_id = ? AND i.contact_id = ? ORDER BY i.due_on DESC""",
                    (cid, cid),
                )
            ]
            vis = "audience IN ('landlord', 'both')"
        messages = rows(
            f"""SELECT * FROM communications
                WHERE ({vis}) AND (
                  contact_id = ? OR property_id IN (
                    SELECT property_id FROM tenancies WHERE occupier_id = ? OR landlord_id = ?
                  ) OR property_id IN (SELECT id FROM properties WHERE landlord_id = ?)
                )
                ORDER BY created_at DESC""",
            (cid, cid, cid, cid),
        )
        person = row("SELECT * FROM contacts WHERE id = ?", (cid,))
        return {
            "user": actor,
            "profile": person,
            "lettings": lettings,
            "invoices": invoices,
            "communications": [decorate_message(m) for m in messages],
        }

    @router.post("/portal/messages")
    def portal_message(
        body: PortalMessageCreate,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        actor = parse_actor(authorization)
        if actor["role"] not in {"occupier", "landlord"}:
            raise HTTPException(status_code=403, detail="Portal only")
        audience = "occupier" if actor["role"] == "occupier" else "landlord"
        new_id = execute(
            """INSERT INTO communications
               (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, subject, body)
               VALUES (?,?,?,?, 'portal', ?,?,?,?,?)""",
            (
                datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                actor["role"],
                actor["name"],
                audience,
                body.property_id,
                body.tenancy_id,
                actor["id"],
                body.subject,
                body.body,
            ),
        )
        created = row("SELECT * FROM communications WHERE id = ?", (new_id,))
        return decorate_message(created or {})

    @router.patch("/contacts/{contact_id}")
    def patch_contact(
        contact_id: int,
        body: ContactPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM contacts WHERE id = ?", (contact_id,)):
            raise HTTPException(status_code=404, detail="Person not found")
        payload = body.model_dump(exclude_unset=True)
        if "phone" in payload:
            payload["phone_e164"] = to_e164(payload.get("phone"))
        apply_patch("contacts", contact_id, payload)
        return row("SELECT * FROM contacts WHERE id = ?", (contact_id,)) or {}

    @router.patch("/properties/{property_id}")
    def patch_property(
        property_id: int,
        body: PropertyPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM properties WHERE id = ?", (property_id,)):
            raise HTTPException(status_code=404, detail="Property not found")
        payload = body.model_dump(exclude_unset=True)
        if "rent_pcm" in payload and payload["rent_pcm"] is not None:
            payload["rent_pcm"] = int(round(float(payload["rent_pcm"]) * 100))
        if "postcode" in payload and payload["postcode"]:
            payload["postcode"] = str(payload["postcode"]).upper()
        apply_patch("properties", property_id, payload)
        item = row("SELECT * FROM properties WHERE id = ?", (property_id,))
        return decorate_property(item or {})

    @router.patch("/tenancies/{tenancy_id}")
    def patch_tenancy(
        tenancy_id: int,
        body: TenancyPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM tenancies WHERE id = ?", (tenancy_id,)):
            raise HTTPException(status_code=404, detail="Letting not found")
        payload = body.model_dump(exclude_unset=True)
        if "rent_pcm" in payload and payload["rent_pcm"] is not None:
            payload["rent_pcm"] = int(round(float(payload["rent_pcm"]) * 100))
        if "deposit" in payload and payload["deposit"] is not None:
            payload["deposit"] = int(round(float(payload["deposit"]) * 100))
        apply_patch("tenancies", tenancy_id, payload)
        return decorate_tenancy(row("SELECT * FROM tenancies WHERE id = ?", (tenancy_id,)) or {})

    @router.post("/tenancies/{tenancy_id}/end")
    def end_tenancy(tenancy_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        item = row("SELECT * FROM tenancies WHERE id = ?", (tenancy_id,))
        if not item:
            raise HTTPException(status_code=404, detail="Letting not found")
        execute(
            "UPDATE tenancies SET status = 'ended', end_date = COALESCE(end_date, ?) WHERE id = ?",
            (date.today().isoformat(), tenancy_id),
        )
        other = row(
            "SELECT id FROM tenancies WHERE property_id = ? AND status = 'active' AND id != ?",
            (item["property_id"], tenancy_id),
        )
        if not other:
            execute("UPDATE properties SET status = 'available' WHERE id = ?", (item["property_id"],))
        return decorate_tenancy(row("SELECT * FROM tenancies WHERE id = ?", (tenancy_id,)) or {})

    @router.get("/jobs")
    def list_jobs(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        items = rows(
            """SELECT j.*, p.name AS property_name, c.name AS contact_name
               FROM jobs j
               LEFT JOIN properties p ON p.id = j.property_id
               LEFT JOIN contacts c ON c.id = j.contact_id
               ORDER BY CASE j.status WHEN 'open' THEN 0 WHEN 'booked' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END, j.id DESC"""
        )
        return {"jobs": items}

    @router.post("/jobs")
    def create_job(body: JobCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        new_id = execute(
            """INSERT INTO jobs (created_at, property_id, tenancy_id, contact_id, call_id, title, detail, status, priority, reported_via)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)""",
            (
                now_iso(),
                body.property_id,
                body.tenancy_id,
                body.contact_id,
                body.call_id,
                body.title,
                body.detail,
                body.priority,
                body.reported_via or ("phone" if body.call_id else "desk"),
            ),
        )
        return row("SELECT * FROM jobs WHERE id = ?", (new_id,)) or {}

    @router.patch("/jobs/{job_id}")
    def patch_job(
        job_id: int,
        body: JobPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM jobs WHERE id = ?", (job_id,)):
            raise HTTPException(status_code=404, detail="Job not found")
        apply_patch("jobs", job_id, body.model_dump(exclude_unset=True))
        return row("SELECT * FROM jobs WHERE id = ?", (job_id,)) or {}

    @router.get("/mail/outbox")
    def mail_outbox(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        return {"messages": rows("SELECT * FROM mail_outbox ORDER BY id DESC LIMIT 50")}

    @router.post("/mail/flush")
    def mail_flush(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        pending = rows("SELECT * FROM mail_outbox WHERE status = 'queued'")
        host = os.environ.get("SWIFTCRM_SMTP_HOST")
        if not host:
            return {
                "flushed": 0,
                "queued": len(pending),
                "note": "No SMTP host configured. Messages stay in the outbox until SWIFTCRM_SMTP_HOST is set.",
            }
        return {
            "flushed": 0,
            "queued": len(pending),
            "note": f"SMTP host {host} is set; wire a sender in production. Outbox unchanged.",
        }

    @router.post("/xero/sync")
    def xero_sync(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        invoices = rows("SELECT * FROM invoices WHERE xero_status != 'synced'")
        exported = 0
        for inv in invoices:
            payload = json.dumps(
                {
                    "number": inv["number"],
                    "contact_id": inv["contact_id"],
                    "amount_pence": inv["amount_pence"],
                    "due_on": inv["due_on"],
                    "description": inv["description"],
                }
            )
            execute(
                "INSERT INTO xero_export (created_at, invoice_id, payload, status) VALUES (?, ?, ?, 'queued')",
                (now_iso(), inv["id"], payload),
            )
            execute("UPDATE invoices SET xero_status = 'synced' WHERE id = ?", (inv["id"],))
            exported += 1
        return {"exported": exported, "note": "Copied to the Xero export queue. Live OAuth is not connected."}

    @router.get("/xero/export")
    def xero_export(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        return {"items": rows("SELECT * FROM xero_export ORDER BY id DESC LIMIT 40")}

    return router
