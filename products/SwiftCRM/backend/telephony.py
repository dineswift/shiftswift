"""Inbound caller-ID matching and desk screen-pop (Twilio-shaped webhook + demo simulate)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from data import execute, row, rows
from phones import to_e164

router = APIRouter()

AGENCY_E164 = "+441150001000"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def gbp(pence: int | None) -> float | None:
    if pence is None:
        return None
    return round(pence / 100, 2)


def match_contact(from_raw: str | None) -> dict[str, Any] | None:
    e164 = to_e164(from_raw)
    if e164:
        found = row("SELECT * FROM contacts WHERE phone_e164 = ?", (e164,))
        if found:
            return found
        tail = e164[-10:]
        if len(tail) >= 10:
            found = row("SELECT * FROM contacts WHERE phone_e164 LIKE ?", (f"%{tail}",))
            if found:
                return found
    return None


def active_letting_for(contact_id: int) -> dict[str, Any] | None:
    return row(
        """SELECT t.*, p.name AS property_name, p.address_line, p.city, p.postcode,
                  p.council_tax_band, p.council_tax_liable
           FROM tenancies t
           JOIN properties p ON p.id = t.property_id
           WHERE t.status = 'active' AND (
             t.occupier_id = ? OR t.landlord_id = ?
             OR t.id IN (SELECT tenancy_id FROM tenancy_occupiers WHERE contact_id = ?)
           )
           ORDER BY t.id DESC LIMIT 1""",
        (contact_id, contact_id, contact_id),
    )


def arrears_gbp(contact_id: int) -> float:
    found = row(
        "SELECT COALESCE(SUM(amount_pence), 0) AS total FROM invoices WHERE contact_id = ? AND status = 'overdue'",
        (contact_id,),
    )
    return gbp(int(found["total"]) if found else 0) or 0.0


def decorate_call(call: dict[str, Any]) -> dict[str, Any]:
    contact = row("SELECT * FROM contacts WHERE id = ?", (call["contact_id"],)) if call.get("contact_id") else None
    letting = None
    jobs: list[dict[str, Any]] = []
    arrears = 0.0
    if contact:
        letting = active_letting_for(contact["id"])
        arrears = arrears_gbp(contact["id"])
        if letting:
            jobs = rows(
                """SELECT * FROM jobs WHERE tenancy_id = ? AND status NOT IN ('done', 'cancelled')
                   ORDER BY id DESC LIMIT 5""",
                (letting["id"],),
            )
            letting = {
                **letting,
                "rent_pcm": gbp(letting["rent_pcm"]),
                "deposit": gbp(letting["deposit"]),
            }
    return {
        "call": call,
        "matched": bool(contact),
        "contact": contact,
        "letting": letting,
        "arrears_gbp": arrears,
        "open_jobs": jobs,
    }


def create_inbound_call(
    from_raw: str,
    to_raw: str | None = None,
    provider_sid: str | None = None,
) -> dict[str, Any]:
    from_e164 = to_e164(from_raw)
    to_e164_num = to_e164(to_raw) or AGENCY_E164
    contact = match_contact(from_raw)
    letting = active_letting_for(contact["id"]) if contact else None
    execute("UPDATE calls SET status = 'missed' WHERE status = 'ringing'")
    new_id = execute(
        """INSERT INTO calls
           (created_at, direction, from_e164, to_e164, from_raw, contact_id, property_id, tenancy_id, status, provider_sid)
           VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'ringing', ?)""",
        (
            now_iso(),
            from_e164,
            to_e164_num,
            from_raw,
            contact["id"] if contact else None,
            letting["property_id"] if letting else None,
            letting["id"] if letting else None,
            provider_sid,
        ),
    )
    call = row("SELECT * FROM calls WHERE id = ?", (new_id,)) or {}
    return decorate_call(call)


def log_phone_note(actor_name: str, call: dict[str, Any], subject: str, body: str, direction: str) -> None:
    execute(
        """INSERT INTO communications
           (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, subject, body, call_id, direction)
           VALUES (?, 'agency', ?, 'occupier', 'phone', ?, ?, ?, ?, ?, ?, ?)""",
        (
            now_iso(),
            actor_name,
            call.get("property_id"),
            call.get("tenancy_id"),
            call.get("contact_id"),
            subject,
            body,
            call.get("id"),
            direction,
        ),
    )


class SimulateBody(BaseModel):
    from_number: str = Field(min_length=3, max_length=32)
    to_number: str | None = None


class OutboundBody(BaseModel):
    contact_id: int
    notes: str | None = None


class CallNoteBody(BaseModel):
    notes: str | None = None


def bind(require_agency):
    @router.post("/telephony/inbound")
    async def inbound(request: Request) -> dict[str, Any]:
        """Twilio-style webhook: From / To / CallSid as JSON or form fields. No desk session required."""
        payload: dict[str, Any] = {}
        ctype = request.headers.get("content-type", "")
        if "json" in ctype:
            payload = await request.json()
        else:
            raw = (await request.body()).decode("utf-8", errors="replace")
            if raw.strip().startswith("{"):
                import json

                payload = json.loads(raw)
            else:
                parsed = parse_qs(raw, keep_blank_values=True)
                payload = {k: (v[0] if v else "") for k, v in parsed.items()}
            if not payload:
                payload = dict(request.query_params)

        from_raw = payload.get("From") or payload.get("from_number") or payload.get("from") or ""
        to_raw = payload.get("To") or payload.get("to_number") or payload.get("to")
        sid = payload.get("CallSid") or payload.get("call_sid")
        if not from_raw:
            raise HTTPException(status_code=400, detail="From number required")
        pop = create_inbound_call(str(from_raw), str(to_raw) if to_raw else None, str(sid) if sid else None)
        return {"ok": True, **pop}

    @router.post("/telephony/simulate")
    def simulate(body: SimulateBody, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        return create_inbound_call(body.from_number, body.to_number)

    @router.get("/telephony/active")
    def active(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        call = row(
            """SELECT * FROM calls WHERE status IN ('ringing', 'answered')
               ORDER BY id DESC LIMIT 1"""
        )
        if not call:
            return {"call": None, "matched": False}
        return decorate_call(call)

    @router.get("/telephony/calls")
    def list_calls(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        items = rows("SELECT * FROM calls ORDER BY id DESC LIMIT 40")
        return {"calls": items}

    @router.post("/telephony/calls/{call_id}/answer")
    def answer_call(
        call_id: int,
        body: CallNoteBody | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        actor = require_agency(authorization)
        call = row("SELECT * FROM calls WHERE id = ?", (call_id,))
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        execute("UPDATE calls SET status = 'answered' WHERE id = ?", (call_id,))
        call = row("SELECT * FROM calls WHERE id = ?", (call_id,)) or call
        who = (row("SELECT name FROM contacts WHERE id = ?", (call["contact_id"],)) or {}).get("name") or call.get("from_raw")
        log_phone_note(
            actor["name"],
            call,
            f"Inbound call answered — {who}",
            (body.notes if body and body.notes else f"Answered inbound call from {call.get('from_raw') or who}."),
            "in",
        )
        return decorate_call(call)

    @router.post("/telephony/calls/{call_id}/hangup")
    def hangup_call(
        call_id: int,
        body: CallNoteBody | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        actor = require_agency(authorization)
        call = row("SELECT * FROM calls WHERE id = ?", (call_id,))
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        next_status = "ended" if call["status"] == "answered" else "missed"
        execute("UPDATE calls SET status = ? WHERE id = ?", (next_status, call_id))
        call = row("SELECT * FROM calls WHERE id = ?", (call_id,)) or call
        if next_status == "ended":
            log_phone_note(
                actor["name"],
                call,
                "Call ended",
                body.notes if body and body.notes else "Call finished.",
                call.get("direction") or "in",
            )
        return decorate_call(call)

    @router.post("/telephony/outbound")
    def outbound(body: OutboundBody, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        actor = require_agency(authorization)
        person = row("SELECT * FROM contacts WHERE id = ?", (body.contact_id,))
        if not person:
            raise HTTPException(status_code=404, detail="Person not found")
        letting = active_letting_for(person["id"])
        new_id = execute(
            """INSERT INTO calls
               (created_at, direction, from_e164, to_e164, from_raw, contact_id, property_id, tenancy_id, status, notes)
               VALUES (?, 'out', ?, ?, ?, ?, ?, ?, 'answered', ?)""",
            (
                now_iso(),
                AGENCY_E164,
                person.get("phone_e164") or to_e164(person.get("phone")),
                person.get("phone"),
                person["id"],
                letting["property_id"] if letting else None,
                letting["id"] if letting else None,
                body.notes,
            ),
        )
        call = row("SELECT * FROM calls WHERE id = ?", (new_id,)) or {}
        log_phone_note(
            actor["name"],
            call,
            f"Outbound call — {person['name']}",
            body.notes or f"Click-to-call {person.get('phone') or person['name']}.",
            "out",
        )
        return {
            **decorate_call(call),
            "tel": f"tel:{person.get('phone_e164') or person.get('phone') or ''}",
        }

    return router
