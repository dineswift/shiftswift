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
SCHEMA_VERSION = "4"

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
            _seed_v4(conn)
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                (SCHEMA_VERSION,),
            )
        elif version["value"] != SCHEMA_VERSION:
            _seed_v3(conn)
            _seed_v4(conn)
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
    _add_column(conn, "communications", "supplier_id", "INTEGER")

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
        CREATE TABLE IF NOT EXISTS suppliers (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          contact_name TEXT,
          email TEXT,
          phone TEXT,
          phone_e164 TEXT,
          account_ref TEXT,
          notes TEXT,
          preferred_channel TEXT
        );
        CREATE TABLE IF NOT EXISTS property_suppliers (
          property_id INTEGER NOT NULL,
          supplier_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          account_ref TEXT,
          notes TEXT,
          PRIMARY KEY (property_id, supplier_id, role)
        );
        CREATE TABLE IF NOT EXISTS policies (
          id INTEGER PRIMARY KEY,
          property_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          insurer TEXT NOT NULL,
          policy_number TEXT,
          broker_id INTEGER,
          start_on TEXT,
          end_on TEXT,
          excess_pence INTEGER,
          notes TEXT
        );
        CREATE TABLE IF NOT EXISTS compliance_items (
          id INTEGER PRIMARY KEY,
          property_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          reference TEXT,
          issued_on TEXT,
          due_on TEXT,
          status TEXT NOT NULL,
          supplier_id INTEGER,
          notes TEXT
        );
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL,
          property_id INTEGER,
          tenancy_id INTEGER,
          supplier_id INTEGER,
          compliance_id INTEGER,
          policy_id INTEGER,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          filename TEXT NOT NULL,
          mime TEXT,
          size_bytes INTEGER,
          stored_name TEXT NOT NULL,
          signed_status TEXT
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


def upload_dir() -> Path:
    folder = DB_PATH.parent / "uploads"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def diary_status(due_on: str | None, booked: bool = False) -> str:
    if booked:
        return "booked"
    if not due_on:
        return "current"
    due = date.fromisoformat(due_on)
    today = date.today()
    if due < today:
        return "overdue"
    if due <= today + timedelta(days=42):
        return "due_soon"
    return "current"


def _write_seed_file(stored_name: str, title: str, body: str) -> tuple[str, int]:
    path = upload_dir() / stored_name
    text = f"{title}\nCharlbury Lettings demo file\n\n{body}\n"
    path.write_text(text, encoding="utf-8")
    return stored_name, path.stat().st_size


def _seed_v4(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT 1 FROM suppliers LIMIT 1").fetchone():
        return

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    suppliers = [
        (
            1,
            "British Gas HomeCare",
            "gas",
            "Duty engineer",
            "engineers@britishgas.example",
            "0333 000 2211",
            to_e164("0333 000 2211"),
            "BG-CL-4401",
            "Gas safety and boiler call-outs for the Nottingham book.",
            "email",
        ),
        (
            2,
            "E.ON Next",
            "electricity",
            "Landlord supply desk",
            "landlords@eonnext.example",
            "0345 052 0000",
            to_e164("0345 052 0000"),
            "EON-8812",
            "Void and HMO electricity accounts.",
            "email",
        ),
        (
            3,
            "Mapperley Maintenance Ltd",
            "maintenance",
            "Chris Patel",
            "jobs@mapperleymaint.example",
            "0115 000 2288",
            to_e164("0115 000 2288"),
            "MM-14",
            "General repairs, damp, and out-of-hours.",
            "phone",
        ),
        (
            4,
            "NFU Mutual Nottingham",
            "insurance",
            "Sarah Quinn",
            "nottingham@nfumutual.example",
            "0115 000 3301",
            to_e164("0115 000 3301"),
            "NFU-CL-19",
            "Buildings and landlord liability broker.",
            "email",
        ),
        (
            5,
            "Nottingham City Licensing",
            "other",
            "HMO team",
            "hmo@nottinghamcity.example",
            "0115 876 1400",
            to_e164("0115 876 1400"),
            "NCC-HMO-22",
            "HMO licence authority for Derby Road.",
            "email",
        ),
    ]
    conn.executemany(
        """INSERT INTO suppliers
           (id, name, kind, contact_name, email, phone, phone_e164, account_ref, notes, preferred_channel)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        suppliers,
    )
    conn.executemany(
        "INSERT INTO property_suppliers (property_id, supplier_id, role, account_ref, notes) VALUES (?,?,?,?,?)",
        [
            (1, 1, "gas", "MP-GAS-14", "Annual LGSR booked with British Gas."),
            (1, 2, "electricity", "MP-ELEC-14", "Occupier pays; agency holds void account."),
            (1, 3, "maintenance", "MP-JOBS", "First call for boiler and leaks."),
            (1, 4, "insurance", "NFU-MP-14", "Buildings cover for Mapperley Holdings."),
            (2, 1, "gas", "CH-GAS-8", None),
            (2, 2, "electricity", "CH-ELEC-8", None),
            (2, 3, "maintenance", "CH-JOBS", "Garden and gutters with occupier."),
            (2, 4, "insurance", "NFU-CH-8", None),
            (3, 1, "gas", "DR-GAS-22", "HMO communal boiler."),
            (3, 2, "electricity", "DR-ELEC-22", "Landlord account while room 2 is void."),
            (3, 5, "other", "HMO-22-DERBY", "Licence in date."),
            (3, 4, "insurance", "NFU-DR-22", None),
            (4, 1, "gas", "SS-GAS-3", None),
            (4, 2, "electricity", "SS-ELEC-3", None),
            (4, 3, "maintenance", "SS-JOBS", "Damp around rear window — open job."),
            (4, 4, "insurance", "NFU-SS-3", None),
        ],
    )
    conn.executemany(
        """INSERT INTO policies
           (id, property_id, kind, insurer, policy_number, broker_id, start_on, end_on, excess_pence, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        [
            (1, 1, "buildings", "NFU Mutual", "NFU-BLD-1401", 4, "2026-01-01", "2026-12-31", 25000, "Rebuild £220k."),
            (2, 1, "landlord", "NFU Mutual", "NFU-LL-1401", 4, "2026-01-01", "2026-12-31", 25000, "Public liability £5m."),
            (3, 2, "buildings", "NFU Mutual", "NFU-BLD-0802", 4, "2025-10-01", "2026-09-30", 50000, "Renewal in window."),
            (4, 3, "buildings", "NFU Mutual", "NFU-BLD-2203", 4, "2026-03-01", "2027-02-28", 50000, "HMO wording."),
            (5, 4, "buildings", "NFU Mutual", "NFU-BLD-0304", 4, "2025-06-01", "2026-05-31", 25000, "Expired — chase broker."),
            (6, 4, "rent_guarantee", "NFU Mutual", "NFU-RG-0304", 4, "2025-11-01", "2026-10-31", 0, "On arrears plan with Luca."),
        ],
    )

    items = [
        (1, 1, "gas_safety", "Gas safety (LGSR)", "GS-14-2025", "2025-10-12", "2026-10-12", 1, "British Gas booked 12 Oct."),
        (2, 1, "eicr", "EICR", "EICR-14-2022", "2022-02-01", "2027-02-01", None, None),
        (3, 1, "epc", "EPC", "EPC-C-14", "2023-04-01", "2033-04-01", None, "Rating C."),
        (4, 1, "smoke_alarms", "Smoke and CO alarms", None, "2025-03-01", "2026-03-01", 3, "Check at next inspection."),
        (5, 1, "insurance", "Buildings insurance", "NFU-BLD-1401", "2026-01-01", "2026-12-31", 4, None),
        (6, 1, "ast", "Assured shorthold tenancy", "AST-HANNAH-2025", "2025-03-01", "2026-02-28", None, "Signed on file."),
        (7, 1, "inventory", "Check-in inventory", "INV-14-2025", "2025-03-01", None, 3, "Signed by Hannah."),
        (8, 2, "gas_safety", "Gas safety (LGSR)", "GS-8-2025", "2025-08-20", "2026-08-20", 1, "Due soon."),
        (9, 2, "eicr", "EICR", "EICR-8-2021", "2021-12-15", "2026-12-15", None, None),
        (10, 2, "epc", "EPC", "EPC-C-8", "2022-09-01", "2032-09-01", None, "Rating C."),
        (11, 2, "insurance", "Buildings insurance", "NFU-BLD-0802", "2025-10-01", "2026-09-30", 4, "Renewal this month."),
        (12, 2, "ast", "Assured shorthold tenancy", "AST-WARD-2024", "2024-09-14", "2026-09-13", None, "Joint tenants Tom and Elise."),
        (13, 3, "gas_safety", "Gas safety (LGSR)", "GS-22-2025", "2025-11-04", "2026-11-04", 1, None),
        (14, 3, "eicr", "EICR", "EICR-22-2022", "2022-01-18", "2027-01-18", None, None),
        (15, 3, "epc", "EPC", "EPC-D-22", "2021-06-01", "2031-06-01", None, "Rating D."),
        (16, 3, "hmo_licence", "HMO licence", "NCC-HMO-22", "2024-04-01", "2029-03-31", 5, None),
        (17, 3, "legionella", "Legionella risk assessment", "LEG-22-2025", "2025-05-01", "2027-05-01", 3, None),
        (18, 4, "gas_safety", "Gas safety (LGSR)", "GS-3-2026", "2026-01-09", "2027-01-09", 1, None),
        (19, 4, "eicr", "EICR", "EICR-3-2022", "2022-03-22", "2027-03-22", None, None),
        (20, 4, "epc", "EPC", "EPC-E-3", "2019-08-01", "2029-08-01", None, "Rating E — advise landlord."),
        (21, 4, "insurance", "Buildings insurance", "NFU-BLD-0304", "2025-06-01", "2026-05-31", 4, "Policy lapsed — chase NFU."),
        (22, 4, "ast", "Assured shorthold tenancy", "AST-LUCA-2025", "2025-11-01", "2026-10-31", None, None),
        (23, 4, "inventory", "Check-in inventory", "INV-3-2025", "2025-11-01", None, 3, "Sent; Luca has not signed back."),
    ]
    for item in items:
        cid, pid, kind, title, ref, issued, due, sid, notes = item
        booked = kind == "gas_safety" and pid == 1
        status = diary_status(due, booked=booked)
        if kind in {"ast", "inventory"} and due is None:
            status = "current"
        if kind == "smoke_alarms":
            status = diary_status(due)
        conn.execute(
            """INSERT INTO compliance_items
               (id, property_id, kind, title, reference, issued_on, due_on, status, supplier_id, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (cid, pid, kind, title, ref, issued, due, status, sid, notes),
        )

    docs = [
        (1, 1, 1, 1, None, "gas", "Gas safety certificate — Mapperley Park", "lgsr-mapperley.txt", "n/a"),
        (1, 1, None, 6, None, "ast", "AST — Hannah Reid", "ast-hannah.txt", "signed"),
        (1, 1, 3, 7, None, "inventory", "Check-in inventory — Mapperley Park", "inventory-mapperley.txt", "signed"),
        (1, None, 4, 5, 1, "insurance", "Buildings schedule — Mapperley Park", "insurance-mapperley.txt", "n/a"),
        (2, None, 4, 11, 3, "insurance", "Buildings schedule — Chilwell Lane", "insurance-chilwell.txt", "n/a"),
        (4, 3, 3, 23, None, "inventory", "Check-in inventory — Station Street", "inventory-station.txt", "sent"),
        (3, None, 5, 16, None, "licence", "HMO licence — Derby Road", "hmo-derby-road.txt", "n/a"),
    ]
    for prop_id, tenancy_id, supplier_id, compliance_id, policy_id, kind, title, filename, signed in docs:
        stored, size = _write_seed_file(filename, title, f"Property {prop_id}. Demo document for the lettings desk.")
        conn.execute(
            """INSERT INTO documents
               (created_at, property_id, tenancy_id, supplier_id, compliance_id, policy_id, kind, title, filename, mime, size_bytes, stored_name, signed_status)
               VALUES (?,?,?,?,?,?,?,?,?,'text/plain',?,?,?)""",
            (now, prop_id, tenancy_id, supplier_id, compliance_id, policy_id, kind, title, filename, size, stored, signed),
        )

    conn.execute(
        """INSERT INTO communications
           (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, supplier_id, subject, body)
           VALUES (?, 'agency', 'Alex Morgan', 'supplier', 'email', 1, 1, NULL, 1, 'Gas service booked',
                   'Please attend Mapperley Park garden flat Thursday 10:00. Tenant Hannah Reid will be in. LGSR required after the visit.')""",
        (now,),
    )
    conn.execute(
        """INSERT INTO communications
           (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, supplier_id, subject, body)
           VALUES (?, 'agency', 'Alex Morgan', 'supplier', 'email', 4, 3, NULL, 4, 'Buildings cover lapsed — Station Street',
                   'NFU-BLD-0304 ended 31 May 2026. Please quote renewal for 3 Station Street, Long Eaton NG10 1DD.')""",
        (now,),
    )
    conn.execute(
        """INSERT INTO communications
           (created_at, author_role, author_name, audience, channel, property_id, tenancy_id, contact_id, supplier_id, subject, body)
           VALUES (?, 'agency', 'Alex Morgan', 'supplier', 'phone', 4, 3, NULL, 3, 'Damp around rear window',
                   'Asked Mapperley Maintenance to inspect condensation at Station Street. Job already on the desk.')""",
        (now,),
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
