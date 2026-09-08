"""SwiftCRM store — lettings desk: properties, tenants, landlords, tax, communications."""

from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from phones import to_e164

DB_PATH = Path(os.environ.get("SWIFTCRM_DB") or (Path(__file__).resolve().parent / "data" / "swiftcrm.db"))
SCHEMA_VERSION = "3"

DEMO_EMAIL = "agency@swiftcrm.local"
DEMO_PASSWORD = "Lettings-Demo-2026"
DEMO_TOKEN = "swiftcrm-demo-agency-token"
TENANT_PORTAL_PASSWORD = "Tenant-Demo-2026"
LANDLORD_PORTAL_PASSWORD = "Landlord-Demo-2026"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(r[1]) for r in conn.execute(f"PRAGMA table_info({table})")}


def _add_column(conn: sqlite3.Connection, table: str, name: str, ddl: str) -> None:
    if name not in _columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


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
            CREATE TABLE IF NOT EXISTS communications (
              id INTEGER PRIMARY KEY,
              created_at TEXT NOT NULL,
              author_role TEXT NOT NULL,
              author_name TEXT NOT NULL,
              audience TEXT NOT NULL,
              channel TEXT NOT NULL,
              property_id INTEGER,
              tenancy_id INTEGER,
              contact_id INTEGER,
              subject TEXT NOT NULL,
              body TEXT NOT NULL
            );
            """
        )
        _migrate(conn)
        seeded = conn.execute("SELECT value FROM meta WHERE key = 'seeded'").fetchone()
        if not seeded:
            _seed(conn)
            conn.execute("INSERT INTO meta (key, value) VALUES ('seeded', '1')")
        version = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        if not version:
            _seed_tax_and_comms(conn)
            _seed_v3(conn)
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                (SCHEMA_VERSION,),
            )
        elif version["value"] != SCHEMA_VERSION:
            _seed_v3(conn)
            conn.execute(
                "UPDATE meta SET value = ? WHERE key = 'schema_version'",
                (SCHEMA_VERSION,),
            )
        conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    for name, ddl in [
        ("address_line", "TEXT"),
        ("city", "TEXT"),
        ("postcode", "TEXT"),
        ("date_of_birth", "TEXT"),
        ("utr", "TEXT"),
        ("nrl_status", "TEXT"),
        ("nrl_ref", "TEXT"),
        ("preferred_channel", "TEXT"),
    ]:
        _add_column(conn, "contacts", name, ddl)

    for name, ddl in [
        ("council_tax_band", "TEXT"),
        ("council_tax_authority", "TEXT"),
        ("council_tax_account", "TEXT"),
        ("council_tax_liable", "TEXT"),
        ("epc_rating", "TEXT"),
        ("gas_due", "TEXT"),
        ("eicr_due", "TEXT"),
    ]:
        _add_column(conn, "properties", name, ddl)

    for name, ddl in [
        ("rent_due_day", "INTEGER"),
        ("deposit_scheme", "TEXT"),
        ("deposit_ref", "TEXT"),
        ("furnished", "TEXT"),
    ]:
        _add_column(conn, "tenancies", name, ddl)

    _add_column(conn, "contacts", "phone_e164", "TEXT")
    _add_column(conn, "communications", "call_id", "INTEGER")
    _add_column(conn, "communications", "direction", "TEXT")
    _add_column(conn, "invoices", "period_month", "TEXT")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS agencies (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT,
          phone_e164 TEXT
        );
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          contact_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS tenancy_occupiers (
          tenancy_id INTEGER NOT NULL,
          contact_id INTEGER NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (tenancy_id, contact_id)
        );
        CREATE TABLE IF NOT EXISTS calls (
          id INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL,
          direction TEXT NOT NULL,
          from_e164 TEXT,
          to_e164 TEXT,
          from_raw TEXT,
          contact_id INTEGER,
          property_id INTEGER,
          tenancy_id INTEGER,
          status TEXT NOT NULL,
          duration_sec INTEGER,
          provider_sid TEXT,
          notes TEXT
        );
        CREATE TABLE IF NOT EXISTS jobs (
          id INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL,
          property_id INTEGER,
          tenancy_id INTEGER,
          contact_id INTEGER,
          call_id INTEGER,
          title TEXT NOT NULL,
          detail TEXT,
          status TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'normal',
          reported_via TEXT
        );
        CREATE TABLE IF NOT EXISTS mail_outbox (
          id INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL,
          to_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL,
          communication_id INTEGER,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS xero_export (
          id INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL,
          invoice_id INTEGER NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL
        );
        """
    )


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
    for item in landlords + occupiers:
        conn.execute(
            "INSERT INTO contacts (id, name, email, phone, role, notes) VALUES (?,?,?,?,?,?)",
            item,
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

    today = date.today()
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
    conn.executemany(
        "INSERT INTO payments (id, invoice_id, amount_pence, paid_on, method, reference) VALUES (?,?,?,?,?,?)",
        [
            (1, 1, 95000, (today - timedelta(days=33)).isoformat(), "bacs", "GC-MAP-0041"),
            (2, 3, 125000, (today - timedelta(days=6)).isoformat(), "bacs", "GC-CHL-0039"),
            (3, 6, 18000, (today - timedelta(days=14)).isoformat(), "card", "ST-FEE-0044"),
        ],
    )
    conn.executemany(
        "INSERT INTO deals (id, title, contact_id, property_id, stage, value_pcm, notes) VALUES (?,?,?,?,?,?,?)",
        [
            (1, "Lenton HMO — room 2 enquiry", 6, 3, "viewing", 60000, "Viewing Friday 4pm."),
            (2, "Chilwell — next AST", 7, 2, "referencing", 125000, "Offer accepted. Credit & RTB checks."),
            (3, "New landlord instruction — West Bridgford", 1, None, "enquiry", None, "Two-bed from October. Valuation booked."),
            (4, "Station Street — arrears plan", 5, 4, "offer", 72500, "Occupier proposed £100/wk catch-up."),
        ],
    )


def _seed_tax_and_comms(conn: sqlite3.Connection) -> None:
    conn.executemany(
        """UPDATE contacts SET address_line=?, city=?, postcode=?, date_of_birth=?, utr=?, nrl_status=?, nrl_ref=?, preferred_channel=?
           WHERE id=?""",
        [
            ("12 Huntingdon Drive", "Nottingham", "NG3 5AU", None, "1234567890", "uk_resident", None, "email", 1),
            ("88 Derby Road", "Nottingham", "NG1 5FB", None, "5556677889", "nrl_applied", "NRL-2026-441", "email", 2),
            ("14 Mapperley Park", "Nottingham", "NG3 5AA", "1994-06-12", None, None, None, "sms", 3),
            ("8 Chilwell Lane", "Beeston", "NG9 1BB", None, None, None, None, "email", 4),
            ("3 Station Street", "Long Eaton", "NG10 1DD", "1990-01-20", None, None, None, "phone", 5),
            ("22 Derby Road", "Lenton", "NG7 1CC", "1998-03-03", None, None, None, "email", 6),
            ("4 Abbey Street", "Dunkirk", "NG7 2NZ", "1996-11-08", None, None, None, "email", 7),
            ("19 Wollaton Vale", "Nottingham", "NG8 2PE", None, None, None, None, "email", 8),
        ],
    )
    conn.executemany(
        """UPDATE properties SET council_tax_band=?, council_tax_authority=?, council_tax_account=?, council_tax_liable=?, epc_rating=?, gas_due=?, eicr_due=?
           WHERE id=?""",
        [
            ("B", "Nottingham City Council", "NCC-88421", "occupier", "C", "2026-10-12", "2027-02-01", 1),
            ("D", "Broxtowe Borough Council", "BBC-10293", "occupier", "C", "2026-08-20", "2026-12-15", 2),
            ("C", "Nottingham City Council", "NCC-66102", "landlord", "D", "2026-11-04", "2027-01-18", 3),
            ("A", "Erewash Borough Council", "EBC-44019", "occupier", "E", "2027-01-09", "2027-03-22", 4),
        ],
    )
    conn.executemany(
        "UPDATE tenancies SET rent_due_day=?, deposit_scheme=?, deposit_ref=?, furnished=? WHERE id=?",
        [
            (1, "TDS", "TDS-889201", "part", 1),
            (14, "DPS", "DPS-441882", "unfurnished", 2),
            (1, "MyDeposits", "MD-220194", "furnished", 3),
        ],
    )

    now = datetime.now(timezone.utc)

    def stamp(days: int) -> str:
        return (now - timedelta(days=days)).replace(microsecond=0).isoformat()

    existing = conn.execute("SELECT COUNT(*) FROM communications").fetchone()[0]
    if existing:
        return

    messages = [
        (stamp(18), "agency", "Alex Morgan", "occupier", "email", 1, 1, 3, "Welcome to Mapperley Park", "Hannah — keys, meter readings and the AST pack are in your portal. Council tax is in your name with Nottingham City (band B)."),
        (stamp(9), "agency", "Alex Morgan", "landlord", "email", 1, 1, 1, "Gas service booked", "Priya — British Gas booked 12 Oct for Mapperley Park. Tenant Hannah has been told."),
        (stamp(8), "occupier", "Hannah Reid", "occupier", "portal", 1, 1, 3, "Boiler making a noise", "The boiler kicks in loudly overnight. Happy for an engineer any weekday after 9am."),
        (stamp(7), "agency", "Alex Morgan", "both", "email", 1, 1, 3, "Engineer arranged", "An engineer will attend Thursday 10:00. Landlord Priya and tenant Hannah are both copied."),
        (stamp(5), "agency", "Alex Morgan", "occupier", "sms", 4, 3, 5, "Rent arrears — payment plan", "Luca — INV-2026-0050 is overdue. We can take £100/week by Bacs until you are current. Reply if that works."),
        (stamp(4), "occupier", "Luca Bianchi", "occupier", "portal", 4, 3, 5, "Re: payment plan", "£100 a week is ok from Friday. Please confirm the reference."),
        (stamp(3), "agency", "Alex Morgan", "landlord", "email", 4, 3, 1, "Arrears update — Station Street", "Priya — Luca has agreed £100/week catch-up. We will collect and report weekly."),
        (stamp(2), "agency", "Alex Morgan", "landlord", "email", 3, None, 2, "HMO licence and council tax", "James — Derby Road remains landlord-liable for council tax while room 2 is void. NRL application NRL-2026-441 is on file; we are not withholding yet."),
        (stamp(1), "landlord", "James Okafor", "landlord", "portal", 3, None, 2, "Room 2 viewing", "Please go ahead with Amira Khan viewing on Friday. Keep me posted on referencing."),
    ]
    conn.executemany(
        """INSERT INTO communications
           (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, subject, body)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        messages,
    )


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


def _seed_v3(conn: sqlite3.Connection) -> None:
    if not conn.execute("SELECT 1 FROM agencies LIMIT 1").fetchone():
        conn.execute(
            "INSERT INTO agencies (id, name, phone, phone_e164) VALUES (1, 'Charlbury Lettings', '0115 000 1000', '+441150001000')"
        )

    people = conn.execute("SELECT id, phone FROM contacts").fetchall()
    for person in people:
        e164 = to_e164(person["phone"])
        if e164:
            conn.execute("UPDATE contacts SET phone_e164 = ? WHERE id = ?", (e164, person["id"]))

    if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        conn.executemany(
            "INSERT INTO users (email, password_hash, name, role, contact_id) VALUES (?,?,?,?,?)",
            [
                (DEMO_EMAIL, hash_password(DEMO_PASSWORD), "Alex Morgan", "agency", None),
                ("hannah.reid@example.com", hash_password(TENANT_PORTAL_PASSWORD), "Hannah Reid", "occupier", 3),
                ("priya@mapperleyholdings.example", hash_password(LANDLORD_PORTAL_PASSWORD), "Priya Sharma", "landlord", 1),
                ("james@okaforlets.example", hash_password(LANDLORD_PORTAL_PASSWORD), "James Okafor", "landlord", 2),
                ("luca.b@example.com", hash_password(TENANT_PORTAL_PASSWORD), "Luca Bianchi", "occupier", 5),
                ("wards@example.com", hash_password(TENANT_PORTAL_PASSWORD), "Tom Ward", "occupier", 4),
            ],
        )

    if not conn.execute("SELECT 1 FROM tenancy_occupiers LIMIT 1").fetchone():
        conn.executemany(
            "INSERT INTO tenancy_occupiers (tenancy_id, contact_id, is_primary) VALUES (?,?,?)",
            [(1, 3, 1), (2, 4, 1), (3, 5, 1)],
        )
        conn.execute(
            """INSERT INTO contacts (name, email, phone, phone_e164, role, notes, preferred_channel)
               VALUES ('Elise Ward', 'elise.ward@example.com', '07700 900117', '+447700900117', 'occupier',
                       'Joint tenant with Tom at Chilwell Lane.', 'email')"""
        )
        elise_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO tenancy_occupiers (tenancy_id, contact_id, is_primary) VALUES (2, ?, 0)",
            (elise_id,),
        )
        conn.execute(
            "INSERT INTO users (email, password_hash, name, role, contact_id) VALUES (?,?,?,?,?)",
            ("elise.ward@example.com", hash_password(TENANT_PORTAL_PASSWORD), "Elise Ward", "occupier", elise_id),
        )

    if not conn.execute("SELECT 1 FROM jobs LIMIT 1").fetchone():
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        conn.execute(
            """INSERT INTO jobs (created_at, property_id, tenancy_id, contact_id, title, detail, status, priority, reported_via)
               VALUES (?, 1, 1, 3, 'Boiler noise overnight', 'Tenant reported loud ignition. Engineer Thursday 10:00.', 'booked', 'high', 'portal')""",
            (now,),
        )
        conn.execute(
            """INSERT INTO jobs (created_at, property_id, tenancy_id, contact_id, title, detail, status, priority, reported_via)
               VALUES (?, 4, 3, 5, 'Damp around window', 'Luca reported condensation on the rear window.', 'open', 'normal', 'phone')""",
            (now,),
        )

    if not conn.execute("SELECT 1 FROM calls LIMIT 1").fetchone():
        past = (datetime.now(timezone.utc) - timedelta(hours=5)).replace(microsecond=0).isoformat()
        conn.execute(
            """INSERT INTO calls (created_at, direction, from_e164, to_e164, from_raw, contact_id, property_id, tenancy_id, status, duration_sec, notes)
               VALUES (?, 'in', '+447700900111', '+441150001000', '07700 900111', 3, 1, 1, 'ended', 184, 'Hannah called about boiler.')""",
            (past,),
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
