"""Agency extra routes: lettings detail, tax, inbox, portals."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from data import execute, row, rows

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
                for t in rows(
                    """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                              p.council_tax_band, p.council_tax_authority, p.council_tax_liable,
                              l.name AS landlord_name
                       FROM tenancies t
                       JOIN properties p ON p.id = t.property_id
                       JOIN contacts l ON l.id = t.landlord_id
                       WHERE t.occupier_id = ? ORDER BY t.start_date DESC""",
                    (contact_id,),
                )
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
        return {
            **decorate_tenancy(item),
            "communications": [decorate_message(m) for m in messages],
            "invoices": invoices,
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
                datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
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
                for t in rows(
                    """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                              p.council_tax_band, p.council_tax_authority, p.council_tax_liable,
                              l.name AS landlord_name
                       FROM tenancies t
                       JOIN properties p ON p.id = t.property_id
                       JOIN contacts l ON l.id = t.landlord_id
                       WHERE t.occupier_id = ? ORDER BY t.start_date DESC""",
                    (cid,),
                )
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

    return router
