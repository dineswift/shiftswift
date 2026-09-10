"""SwiftHelp store — IT helpdesk: people, assets, tickets, updates."""

from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(os.environ.get("SWIFTHELP_DB") or (Path(__file__).resolve().parent / "data" / "swifthelp.db"))
SCHEMA_VERSION = "1"

DEMO_EMAIL = "it@swifthelp.local"
DEMO_PASSWORD = "Helpdesk-Demo-2026"
DEMO_TOKEN = "swifthelp-demo-agent-token"
REQUEST_PORTAL_PASSWORD = "Request-Demo-2026"

PRIORITIES = ("p1", "p2", "p3")
TICKET_STATUSES = ("open", "waiting", "in_progress", "resolved", "closed")
ASSET_KINDS = ("laptop", "phone", "printer", "monitor", "other")
ASSET_STATUSES = ("in_use", "spare", "repair", "retired")
SLA_HOURS = {"p1": 4, "p2": 24, "p3": 72}


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 120_000
    )
    return hmac.compare_digest(digest.hex(), digest_hex)


def sla_due(priority: str, from_when: datetime | None = None) -> str:
    start = from_when or datetime.now(timezone.utc)
    hours = SLA_HOURS.get(priority, 72)
    return (start + timedelta(hours=hours)).replace(microsecond=0).isoformat()


def sla_state(due_at: str | None, status: str) -> str:
    if not due_at or status in ("resolved", "closed"):
        return "ok"
    due = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    remaining = due - datetime.now(timezone.utc)
    if remaining.total_seconds() < 0:
        return "breached"
    if remaining.total_seconds() < 4 * 3600:
        return "due_soon"
    return "ok"


def rows(query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connect() as conn:
        cur = conn.execute(query, params)
        return [dict(r) for r in cur.fetchall()]


def row(query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    found = rows(query, params)
    return found[0] if found else None


def execute(query: str, params: tuple[Any, ...] = ()) -> int:
    with connect() as conn:
        cur = conn.execute(query, params)
        conn.commit()
        return int(cur.lastrowid)


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orgs (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              phone TEXT
            );
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              name TEXT NOT NULL,
              role TEXT NOT NULL,
              person_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS people (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT,
              phone TEXT,
              role TEXT NOT NULL,
              department TEXT,
              notes TEXT
            );
            CREATE TABLE IF NOT EXISTS assets (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              status TEXT NOT NULL,
              serial TEXT,
              owner_id INTEGER,
              notes TEXT
            );
            CREATE TABLE IF NOT EXISTS tickets (
              id INTEGER PRIMARY KEY,
              number TEXT NOT NULL,
              title TEXT NOT NULL,
              detail TEXT,
              status TEXT NOT NULL,
              priority TEXT NOT NULL,
              requester_id INTEGER NOT NULL,
              asset_id INTEGER,
              assignee TEXT,
              created_at TEXT NOT NULL,
              due_at TEXT,
              sla TEXT
            );
            CREATE TABLE IF NOT EXISTS updates (
              id INTEGER PRIMARY KEY,
              created_at TEXT NOT NULL,
              ticket_id INTEGER NOT NULL,
              author_role TEXT NOT NULL,
              author_name TEXT NOT NULL,
              audience TEXT NOT NULL,
              body TEXT NOT NULL
            );
            """
        )
        version = conn.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()
        if not version:
            _seed(conn)
            conn.execute("INSERT INTO meta (key, value) VALUES ('schema', ?)", (SCHEMA_VERSION,))
        conn.commit()


def _seed(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO orgs (id, name, phone) VALUES (1, 'Northgate Office IT', '0115 000 2000')"
    )
    people = [
        (1, "Jordan Hale", "it@swifthelp.local", "07700 800100", "agent", "IT", "Helpdesk lead."),
        (2, "Amira Khan", "amira.khan@northgate.example", "07700 800111", "requester", "Finance", "MacBook user."),
        (3, "Sam Okonkwo", "sam.okonkwo@northgate.example", "07700 800112", "requester", "Operations", "VPN account on the firewall."),
        (4, "Priya Chen", "priya.chen@northgate.example", "07700 800113", "requester", "People", "Starts Monday — needs a laptop."),
    ]
    conn.executemany(
        "INSERT INTO people (id, name, email, phone, role, department, notes) VALUES (?,?,?,?,?,?,?)",
        people,
    )
    conn.execute(
        "INSERT INTO users (email, password_hash, name, role, person_id) VALUES (?,?,?,?,?)",
        (DEMO_EMAIL, hash_password(DEMO_PASSWORD), "Jordan Hale", "agent", 1),
    )
    assets = [
        (1, "MacBook Pro 14 — Amira", "laptop", "in_use", "C02-AMIRA-14", 2, "Battery swelling reported."),
        (2, "ThinkPad T14 — Sam", "laptop", "in_use", "LEN-SAM-T14", 3, None),
        (3, "iPhone 15 — Amira", "phone", "in_use", "IMEI-100111", 2, None),
        (4, "3rd floor HP LaserJet", "printer", "repair", "HP-3F-01", None, "Paper jam, tray 2."),
        (5, "Spare Dell Latitude", "laptop", "spare", "DELL-SPARE-02", None, "Imaged, ready for Priya."),
    ]
    conn.executemany(
        "INSERT INTO assets (id, name, kind, status, serial, owner_id, notes) VALUES (?,?,?,?,?,?,?)",
        assets,
    )
    created = datetime.now(timezone.utc).replace(microsecond=0)
    tickets = [
        (
            1,
            "HD-1041",
            "VPN drops every 10 minutes",
            "Sam cannot stay on the finance share. Started this morning.",
            "open",
            "p1",
            3,
            2,
            "Jordan Hale",
            (created - timedelta(hours=2)).isoformat(),
            sla_due("p1", created - timedelta(hours=2)),
            "breached",
        ),
        (
            2,
            "HD-1042",
            "MacBook battery swelling",
            "Trackpad is lifting. Needs a swap, not a repair on-site.",
            "in_progress",
            "p2",
            2,
            1,
            "Jordan Hale",
            (created - timedelta(hours=20)).isoformat(),
            sla_due("p2", created - timedelta(hours=20)),
            "due_soon",
        ),
        (
            3,
            "HD-1043",
            "3rd floor printer jammed",
            "Tray 2. People are walking to 2nd floor.",
            "waiting",
            "p3",
            2,
            4,
            "Jordan Hale",
            (created - timedelta(days=1)).isoformat(),
            sla_due("p3", created - timedelta(days=1)),
            "ok",
        ),
        (
            4,
            "HD-1044",
            "New starter laptop — Priya Chen",
            "Starts Monday. Spare Dell is imaged. Needs account + bag.",
            "waiting",
            "p2",
            4,
            5,
            "Jordan Hale",
            created.isoformat(),
            sla_due("p2", created),
            "ok",
        ),
    ]
    conn.executemany(
        """INSERT INTO tickets
           (id, number, title, detail, status, priority, requester_id, asset_id, assignee, created_at, due_at, sla)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        tickets,
    )
    updates = [
        (created.isoformat(), 1, "requester", "Sam Okonkwo", "requester", "VPN drops on the ThinkPad. I have restarted twice."),
        ((created - timedelta(hours=1)).isoformat(), 1, "agent", "Jordan Hale", "requester", "Checking the firewall session limit. Stay on this ticket."),
        ((created - timedelta(hours=18)).isoformat(), 2, "requester", "Amira Khan", "requester", "The trackpad clicks without me touching it."),
        ((created - timedelta(hours=6)).isoformat(), 2, "agent", "Jordan Hale", "requester", "Replacement ordered. I will swap Thursday."),
        ((created - timedelta(hours=20)).isoformat(), 3, "requester", "Amira Khan", "requester", "Printer on 3rd floor will not clear tray 2."),
        (created.isoformat(), 4, "agent", "Jordan Hale", "requester", "Spare Dell is imaged. Waiting on People for start date confirm."),
    ]
    conn.executemany(
        """INSERT INTO updates (created_at, ticket_id, author_role, author_name, audience, body)
           VALUES (?,?,?,?,?,?)""",
        updates,
    )
    # Refresh SLA flags from due_at so seed stays honest after the clock moves.
    for item in conn.execute("SELECT id, due_at, status FROM tickets").fetchall():
        conn.execute(
            "UPDATE tickets SET sla = ? WHERE id = ?",
            (sla_state(item["due_at"], item["status"]), item["id"]),
        )
