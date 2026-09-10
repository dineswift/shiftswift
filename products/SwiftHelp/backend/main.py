"""SwiftHelp API — IT helpdesk (tickets, assets, people)."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from data import (
    ASSET_KINDS,
    ASSET_STATUSES,
    DEMO_EMAIL,
    DEMO_PASSWORD,
    DEMO_TOKEN,
    PRIORITIES,
    REQUEST_PORTAL_PASSWORD,
    TICKET_STATUSES,
    execute,
    init_db,
    now_iso,
    row,
    rows,
    sla_due,
    sla_state,
    verify_password,
)

app = FastAPI(title="SwiftHelp", version="0.1.0", description="IT helpdesk")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5380",
        "http://127.0.0.1:5380",
        "http://localhost:5280",
        "http://127.0.0.1:5280",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


def parse_actor(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in required")
    token = authorization.split(" ", 1)[1].strip()
    if token == DEMO_TOKEN:
        return {"role": "agent", "id": 1, "name": "Jordan Hale", "email": DEMO_EMAIL}
    if token.startswith("swifthelp-portal-"):
        parts = token.split("-")
        if len(parts) >= 3:
            try:
                pid = int(parts[-1])
            except ValueError as exc:
                raise HTTPException(status_code=401, detail="Invalid session") from exc
            person = row("SELECT * FROM people WHERE id = ? AND role = 'requester'", (pid,))
            if person:
                return {"role": "requester", "id": pid, "name": person["name"], "email": person["email"]}
    raise HTTPException(status_code=401, detail="Invalid session")


def require_agent(authorization: str | None) -> dict[str, Any]:
    actor = parse_actor(authorization)
    if actor["role"] != "agent":
        raise HTTPException(status_code=403, detail="Helpdesk only")
    return actor


def decorate_ticket(item: dict[str, Any]) -> dict[str, Any]:
    requester = row("SELECT id, name, email, department FROM people WHERE id = ?", (item["requester_id"],))
    asset = row("SELECT id, name, kind, status, serial FROM assets WHERE id = ?", (item["asset_id"],)) if item.get("asset_id") else None
    sla = sla_state(item.get("due_at"), item["status"])
    return {**item, "requester": requester, "asset": asset, "sla": sla}


def decorate_asset(item: dict[str, Any]) -> dict[str, Any]:
    owner = row("SELECT id, name, email FROM people WHERE id = ?", (item["owner_id"],)) if item.get("owner_id") else None
    open_tickets = rows(
        "SELECT id, number, title, status, priority FROM tickets WHERE asset_id = ? AND status NOT IN ('resolved','closed')",
        (item["id"],),
    )
    return {**item, "owner": owner, "open_tickets": open_tickets}


class LoginBody(BaseModel):
    email: str
    password: str


class TicketCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    detail: str | None = None
    priority: str = "p3"
    requester_id: int
    asset_id: int | None = None


class TicketPatch(BaseModel):
    status: str | None = None
    priority: str | None = None
    asset_id: int | None = None
    assignee: str | None = None
    title: str | None = None


class UpdateCreate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    audience: str = "requester"


class PersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: str | None = None
    phone: str | None = None
    role: str = "requester"
    department: str | None = None
    notes: str | None = None


class AssetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: str = "laptop"
    status: str = "in_use"
    serial: str | None = None
    owner_id: int | None = None
    notes: str | None = None


class AssetPatch(BaseModel):
    status: str | None = None
    owner_id: int | None = None
    notes: str | None = None


@app.post("/auth/login")
def login(body: LoginBody) -> dict[str, Any]:
    email = body.email.strip().lower()
    user = row("SELECT * FROM users WHERE email = ?", (email,))
    if user and verify_password(body.password, user["password_hash"]):
        return {
            "token": DEMO_TOKEN,
            "user": {"role": "agent", "name": user["name"], "email": user["email"]},
        }
    if email == DEMO_EMAIL and body.password == DEMO_PASSWORD:
        return {
            "token": DEMO_TOKEN,
            "user": {"role": "agent", "name": "Jordan Hale", "email": DEMO_EMAIL},
        }
    person = row("SELECT * FROM people WHERE lower(email) = ? AND role = 'requester'", (email,))
    if person and body.password == REQUEST_PORTAL_PASSWORD:
        return {
            "token": f"swifthelp-portal-{person['id']}",
            "user": {"role": "requester", "name": person["name"], "email": person["email"], "id": person["id"]},
        }
    raise HTTPException(status_code=401, detail="Unknown email or password")


@app.get("/me")
def me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = parse_actor(authorization)
    org = row("SELECT * FROM orgs WHERE id = 1")
    return {**actor, "org": org["name"] if org else "Northgate Office IT"}


@app.get("/overview")
def overview(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    tickets = [decorate_ticket(t) for t in rows("SELECT * FROM tickets ORDER BY id DESC")]
    open_ones = [t for t in tickets if t["status"] not in ("resolved", "closed")]
    p1 = [t for t in open_ones if t["priority"] == "p1"]
    waiting = [t for t in open_ones if t["status"] == "waiting"]
    sla = [t for t in open_ones if t["sla"] in ("breached", "due_soon")]
    latest = rows("SELECT * FROM updates ORDER BY id DESC LIMIT 6")
    return {
        "open": len(open_ones),
        "p1": len(p1),
        "waiting": len(waiting),
        "sla_due": len(sla),
        "p1_list": p1[:6],
        "sla_list": sla[:6],
        "waiting_list": waiting[:6],
        "latest": latest,
    }


@app.get("/tickets")
def list_tickets(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = parse_actor(authorization)
    if actor["role"] == "requester":
        items = rows("SELECT * FROM tickets WHERE requester_id = ? ORDER BY id DESC", (actor["id"],))
    else:
        items = rows("SELECT * FROM tickets ORDER BY id DESC")
    return {"tickets": [decorate_ticket(t) for t in items]}


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = parse_actor(authorization)
    item = row("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    if not item:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if actor["role"] == "requester" and item["requester_id"] != actor["id"]:
        raise HTTPException(status_code=403, detail="Not your ticket")
    comments = rows("SELECT * FROM updates WHERE ticket_id = ? ORDER BY id DESC", (ticket_id,))
    if actor["role"] == "requester":
        comments = [c for c in comments if c["audience"] in ("requester", "both")]
    return {**decorate_ticket(item), "updates": comments}


@app.post("/tickets")
def create_ticket(body: TicketCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = parse_actor(authorization)
    if body.priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Unknown priority")
    requester_id = actor["id"] if actor["role"] == "requester" else body.requester_id
    if not row("SELECT id FROM people WHERE id = ?", (requester_id,)):
        raise HTTPException(status_code=400, detail="Unknown requester")
    if body.asset_id and not row("SELECT id FROM assets WHERE id = ?", (body.asset_id,)):
        raise HTTPException(status_code=400, detail="Unknown asset")
    n = row("SELECT COUNT(*) AS n FROM tickets")
    number = f"HD-{1045 + int(n['n'])}"
    created = now_iso()
    due = sla_due(body.priority)
    new_id = execute(
        """INSERT INTO tickets
           (number, title, detail, status, priority, requester_id, asset_id, assignee, created_at, due_at, sla)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            number,
            body.title,
            body.detail,
            "open",
            body.priority,
            requester_id,
            body.asset_id,
            "Jordan Hale" if actor["role"] == "agent" else None,
            created,
            due,
            sla_state(due, "open"),
        ),
    )
    execute(
        "INSERT INTO updates (created_at, ticket_id, author_role, author_name, audience, body) VALUES (?,?,?,?,?,?)",
        (created, new_id, actor["role"], actor["name"], "requester", body.detail or body.title),
    )
    return decorate_ticket(row("SELECT * FROM tickets WHERE id = ?", (new_id,)) or {})


@app.patch("/tickets/{ticket_id}")
def patch_ticket(ticket_id: int, body: TicketPatch, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    item = row("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    if not item:
        raise HTTPException(status_code=404, detail="Ticket not found")
    payload = body.model_dump(exclude_unset=True)
    if "status" in payload and payload["status"] not in TICKET_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    if "priority" in payload and payload["priority"] not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Unknown priority")
    fields = {k: v for k, v in payload.items() if v is not None or k == "asset_id"}
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        execute(f"UPDATE tickets SET {sets} WHERE id = ?", (*fields.values(), ticket_id))
    updated = row("SELECT * FROM tickets WHERE id = ?", (ticket_id,)) or item
    execute("UPDATE tickets SET sla = ? WHERE id = ?", (sla_state(updated.get("due_at"), updated["status"]), ticket_id))
    return decorate_ticket(row("SELECT * FROM tickets WHERE id = ?", (ticket_id,)) or {})


@app.post("/tickets/{ticket_id}/updates")
def add_update(ticket_id: int, body: UpdateCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = parse_actor(authorization)
    item = row("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    if not item:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if actor["role"] == "requester" and item["requester_id"] != actor["id"]:
        raise HTTPException(status_code=403, detail="Not your ticket")
    audience = "requester" if actor["role"] == "requester" else body.audience
    execute(
        "INSERT INTO updates (created_at, ticket_id, author_role, author_name, audience, body) VALUES (?,?,?,?,?,?)",
        (now_iso(), ticket_id, actor["role"], actor["name"], audience, body.body),
    )
    return get_ticket(ticket_id, authorization)


@app.get("/updates")
def list_updates(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    items = rows(
        """SELECT u.*, t.number, t.title FROM updates u
           JOIN tickets t ON t.id = u.ticket_id
           ORDER BY u.id DESC"""
    )
    return {"updates": items}


@app.get("/people")
def list_people(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    return {"people": rows("SELECT * FROM people ORDER BY name")}


@app.post("/people")
def create_person(body: PersonCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    if body.role not in ("requester", "agent"):
        raise HTTPException(status_code=400, detail="Unknown role")
    new_id = execute(
        "INSERT INTO people (name, email, phone, role, department, notes) VALUES (?,?,?,?,?,?)",
        (body.name, body.email, body.phone, body.role, body.department, body.notes),
    )
    return row("SELECT * FROM people WHERE id = ?", (new_id,)) or {}


@app.get("/assets")
def list_assets(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    return {"assets": [decorate_asset(a) for a in rows("SELECT * FROM assets ORDER BY name")]}


@app.get("/assets/{asset_id}")
def get_asset(asset_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    item = row("SELECT * FROM assets WHERE id = ?", (asset_id,))
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found")
    tickets = [decorate_ticket(t) for t in rows("SELECT * FROM tickets WHERE asset_id = ? ORDER BY id DESC", (asset_id,))]
    return {**decorate_asset(item), "tickets": tickets}


@app.post("/assets")
def create_asset(body: AssetCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    if body.kind not in ASSET_KINDS:
        raise HTTPException(status_code=400, detail="Unknown asset type")
    if body.status not in ASSET_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    new_id = execute(
        "INSERT INTO assets (name, kind, status, serial, owner_id, notes) VALUES (?,?,?,?,?,?)",
        (body.name, body.kind, body.status, body.serial, body.owner_id, body.notes),
    )
    return decorate_asset(row("SELECT * FROM assets WHERE id = ?", (new_id,)) or {})


@app.patch("/assets/{asset_id}")
def patch_asset(asset_id: int, body: AssetPatch, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_agent(authorization)
    if not row("SELECT id FROM assets WHERE id = ?", (asset_id,)):
        raise HTTPException(status_code=404, detail="Asset not found")
    payload = body.model_dump(exclude_unset=True)
    if "status" in payload and payload["status"] not in ASSET_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    if payload:
        sets = ", ".join(f"{k} = ?" for k in payload)
        execute(f"UPDATE assets SET {sets} WHERE id = ?", (*payload.values(), asset_id))
    return decorate_asset(row("SELECT * FROM assets WHERE id = ?", (asset_id,)) or {})
