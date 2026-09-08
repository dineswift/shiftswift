"""SwiftCRM seed data and SQLite store — lettings domain (not ShiftSwift HR)."""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent / "data" / "swiftcrm.db"

# Occupier / landlord demo password is only used at login (not stored hashed in v1).
DEMO_EMAIL = "agency@swiftcrm.local"
DEMO_PASSWORD = "Lettings-Demo-2026"
DEMO_TOKEN = "swiftcrm-demo-agency-token"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS properties (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              address_line TEXT NOT NULL,
              city TEXT NOT NULL,
              postcode TEXT NOT NULL,
              beds INTEGER NOT NULL,
              property_type TEXT NOT NULL,
              status TEXT NOT NULL,
              rent_pcm INTEGER NOT NULL,
              landlord_id INTEGER,
              notes TEXT
            );
            CREATE TABLE IF NOT EXISTS contacts (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT,
              phone TEXT,
              role TEXT NOT NULL,
              notes TEXT
            );
            CREATE TABLE IF NOT EXISTS tenancies (
              id INTEGER PRIMARY KEY,
              property_id INTEGER NOT NULL,
              occupier_id INTEGER NOT NULL,
              landlord_id INTEGER NOT NULL,
              start_date TEXT NOT NULL,
              end_date TEXT,
              rent_pcm INTEGER NOT NULL,
              deposit INTEGER NOT NULL,
              status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invoices (
              id INTEGER PRIMARY KEY,
              number TEXT NOT NULL,
              tenancy_id INTEGER,
              property_id INTEGER NOT NULL,
              contact_id INTEGER NOT NULL,
              issued_on TEXT NOT NULL,
              due_on TEXT NOT NULL,
              amount_pence INTEGER NOT NULL,
              status TEXT NOT NULL,
              description TEXT NOT NULL,
              xero_status TEXT NOT NULL DEFAULT 'not_synced'
            );
            CREATE TABLE IF NOT EXISTS payments (
              id INTEGER PRIMARY KEY,
              invoice_id INTEGER NOT NULL,
              amount_pence INTEGER NOT NULL,
              paid_on TEXT NOT NULL,
              method TEXT NOT NULL,
              reference TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS deals (
              id INTEGER PRIMARY KEY,
              title TEXT NOT NULL,
              contact_id INTEGER NOT NULL,
              property_id INTEGER,
              stage TEXT NOT NULL,
              value_pcm INTEGER,
              notes TEXT
            );
            """
        )
        seeded = conn.execute("SELECT value FROM meta WHERE key = 'seeded'").fetchone()
        if seeded:
            return
        _seed(conn)
        conn.execute("INSERT INTO meta (key, value) VALUES ('seeded', '1')")
        conn.commit()


def _seed(conn: sqlite3.Connection) -> None:
    landlords = [
        (1, "Priya Sharma", "priya@mapperleyholdings.example", "0115 000 1401", "landlord", "Owns Mapperley Park flat and Long Eaton studio."),
        (2, "James Okafor", "james@okaforlets.example", "0115 000 1402", "landlord", "Beeston family house and Lenton HMO."),
    ]
    occupiers = [
        (3, "Hannah Reid", "hannah.reid@example.com", "07700 900111", "occupier", "AST on Mapperley Park."),
        (4, "Tom & Elise Ward", "wards@example.com", "07700 900112", "occupier", "Family tenancy, Beeston."),
        (5, "Luca Bianchi", "luca.b@example.com", "07700 900113", "occupier", "Arrears on Long Eaton studio — chasing."),
        (6, "Amira Khan", "amira.khan@example.com", "07700 900114", "applicant", "Viewing Lenton HMO room 2."),
        (7, "Ben Cole", "ben.cole@example.com", "07700 900115", "applicant", "Offer accepted, referencing in progress."),
        (8, "Helen Frost", "helen.frost@example.com", "07700 900116", "guarantor", "Guarantor for Luca Bianchi."),
    ]
    for row in landlords + occupiers:
        conn.execute(
            "INSERT INTO contacts (id, name, email, phone, role, notes) VALUES (?,?,?,?,?,?)",
            row,
        )

    properties = [
        (1, "Mapperley Park garden flat", "14 Mapperley Park", "Nottingham", "NG3 5AA", 2, "flat", "let", 95000, 1, "Gas due Oct 2026. EPC C."),
        (2, "Chilwell Lane house", "8 Chilwell Lane", "Beeston", "NG9 1BB", 3, "house", "let", 125000, 2, "Family let. Garden maintained by occupier."),
        (3, "Derby Road HMO", "22 Derby Road", "Lenton", "NG7 1CC", 4, "hmo", "available", 240000, 2, "Room 2 vacant. Licence in date."),
        (4, "Station Street studio", "3 Station Street", "Long Eaton", "NG10 1DD", 1, "studio", "let", 72500, 1, "Arrears — occupier on payment plan."),
    ]
    conn.executemany(
        """INSERT INTO properties
           (id, name, address_line, city, postcode, beds, property_type, status, rent_pcm, landlord_id, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        properties,
    )

    today = date.today()
    tenancies = [
        (1, 1, 3, 1, "2025-03-01", "2026-02-28", 95000, 95000, "active"),
        (2, 2, 4, 2, "2024-09-14", "2026-09-13", 125000, 144000, "active"),
        (3, 4, 5, 1, "2025-11-01", "2026-10-31", 72500, 72500, "active"),
    ]
    conn.executemany(
        """INSERT INTO tenancies
           (id, property_id, occupier_id, landlord_id, start_date, end_date, rent_pcm, deposit, status)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        tenancies,
    )

    invoices = [
        (1, "INV-2026-0041", 1, 1, 3, (today - timedelta(days=40)).isoformat(), (today - timedelta(days=32)).isoformat(), 95000, "paid", "Rent — Mapperley Park garden flat", "synced"),
        (2, "INV-2026-0048", 1, 1, 3, (today - timedelta(days=10)).isoformat(), (today - timedelta(days=2)).isoformat(), 95000, "due", "Rent — Mapperley Park garden flat", "queued"),
        (3, "INV-2026-0039", 2, 2, 4, (today - timedelta(days=12)).isoformat(), (today - timedelta(days=5)).isoformat(), 125000, "paid", "Rent — Chilwell Lane house", "synced"),
        (4, "INV-2026-0050", 3, 4, 5, (today - timedelta(days=35)).isoformat(), (today - timedelta(days=28)).isoformat(), 72500, "overdue", "Rent — Station Street studio", "not_synced"),
        (5, "INV-2026-0051", 3, 4, 5, (today - timedelta(days=5)).isoformat(), (today + timedelta(days=2)).isoformat(), 72500, "due", "Rent — Station Street studio", "not_synced"),
        (6, "INV-2026-0044", None, 3, 2, (today - timedelta(days=20)).isoformat(), (today - timedelta(days=13)).isoformat(), 18000, "paid", "Management fee — Derby Road HMO", "synced"),
    ]
    conn.executemany(
        """INSERT INTO invoices
           (id, number, tenancy_id, property_id, contact_id, issued_on, due_on, amount_pence, status, description, xero_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        invoices,
    )

    payments = [
        (1, 1, 95000, (today - timedelta(days=33)).isoformat(), "bacs", "GC-MAP-0041"),
        (2, 3, 125000, (today - timedelta(days=6)).isoformat(), "bacs", "GC-CHL-0039"),
        (3, 6, 18000, (today - timedelta(days=14)).isoformat(), "card", "ST-FEE-0044"),
    ]
    conn.executemany(
        "INSERT INTO payments (id, invoice_id, amount_pence, paid_on, method, reference) VALUES (?,?,?,?,?,?)",
        payments,
    )

    deals = [
        (1, "Lenton HMO — room 2 enquiry", 6, 3, "viewing", 60000, "Viewing Friday 4pm."),
        (2, "Chilwell — next AST", 7, 2, "referencing", 125000, "Offer accepted. Credit & RTB checks."),
        (3, "New landlord instruction — West Bridgford", 1, None, "enquiry", None, "Two-bed from October. Valuation booked."),
        (4, "Station Street — arrears plan", 5, 4, "offer", 72500, "Occupier proposed £100/wk catch-up."),
    ]
    conn.executemany(
        "INSERT INTO deals (id, title, contact_id, property_id, stage, value_pcm, notes) VALUES (?,?,?,?,?,?,?)",
        deals,
    )


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


def dumps_pretty(data: Any) -> str:
    return json.dumps(data, indent=2, default=str)
